import Foundation
import NitroModules
import dnssd

// The `dns_sd.h` constants arrive from C as `Int`, while the functions take
// `Int32`/`UInt32`. Convert once here rather than at every use site.
private extension DNSServiceErrorType {
  static let ok = DNSServiceErrorType(kDNSServiceErr_NoError)
}

private let anyInterface = UInt32(bitPattern: kDNSServiceInterfaceIndexAny)
private let addFlag = DNSServiceFlags(kDNSServiceFlagsAdd)

/// Browses for stations using `<dns_sd.h>` — the same API `dns-sd(1)` uses, and
/// the one proven against the station's responder.
///
/// Not NWBrowser: it deliberately withholds host/port, expecting you to connect
/// to an opaque `NWEndpoint.service`. ADR-0008's transport is `fetch`, which
/// needs a URL, so we need the host and port as strings. Not NetService either:
/// deprecated.
///
/// `dns_sd` is a callback-driven C API with no run loop of its own. The shape
/// below is the standard one: every operation owns a socket, and a
/// `DispatchSourceRead` on that socket pumps replies into
/// `DNSServiceProcessResult`, which in turn fires the C callbacks.
final class HybridStationDiscovery: HybridStationDiscoverySpec {
  /// Everything — refs, sources, the resolver table, and every C callback —
  /// lives on this one serial queue. That is what makes the unsynchronised
  /// mutable state below safe, and it is why a resolver can be torn down from
  /// inside its own callback without racing its cancellation.
  private let queue = DispatchQueue(label: "network.railroad.discovery")

  private var browseRef: DNSServiceRef?
  private var browseSource: DispatchSourceRead?

  /// In-flight and completed resolvers, keyed by `fullKey`. Holds the only
  /// strong reference to each, so removal from this table deallocates it.
  private var resolvers: [String: Resolver] = [:]

  private var onFound: ((DiscoveredStation) -> Void)?
  private var onLost: ((String) -> Void)?
  private var onError: ((String) -> Void)?

  // MARK: - Spec

  func start(
    serviceType: String,
    onFound: @escaping (DiscoveredStation) -> Void,
    onLost: @escaping (String) -> Void,
    onError: @escaping (String) -> Void
  ) throws {
    queue.sync {
      // Documented behaviour: starting while started restarts the browse.
      teardown()

      self.onFound = onFound
      self.onLost = onLost
      self.onError = onError

      var ref: DNSServiceRef?
      let err = DNSServiceBrowse(
        &ref,
        0,
        anyInterface,
        serviceType,
        nil,  // default domain — `local.`
        browseReply,
        Unmanaged.passUnretained(self).toOpaque()
      )
      guard err == .ok, let ref else {
        // No browse started, so no permission prompt and no replies ever. This
        // is fatal to discovery, unlike the per-reply errors below.
        onError("Could not browse for \(serviceType): \(Self.describe(err))")
        return
      }

      browseRef = ref
      browseSource = makeSource(for: ref) { [weak self] in
        // A dead browse socket would otherwise spin the source hot forever.
        self?.emitError("Browsing stopped: \(Self.describe($0))")
        self?.teardown()
      }
    }
  }

  func stop() throws {
    queue.sync { teardown() }
  }

  deinit {
    // The C callbacks hold an unretained pointer to `self`; they must not
    // outlive it.
    queue.sync { teardown() }
  }

  // MARK: - Browse

  /// Called on `queue` for every appearance/disappearance the daemon reports.
  fileprivate func handleBrowse(
    flags: DNSServiceFlags,
    interfaceIndex: UInt32,
    name: String,
    type: String,
    domain: String
  ) {
    let key = Self.fullKey(name: name, type: type, domain: domain)

    guard flags & addFlag != 0 else {
      // Drop any resolve still in flight for it — nothing wants the answer now.
      resolvers.removeValue(forKey: key)?.cancel()
      onLost?(name)
      return
    }

    // The same instance can be re-announced (and appears once per interface, so
    // a station on both Wi-Fi and Ethernet arrives twice). First resolve wins;
    // the JS seam keys by name and would dedupe anyway, but there is no reason
    // to open a second socket for an answer we already have.
    guard resolvers[key] == nil else { return }

    let resolver = Resolver(key: key, owner: self)
    resolvers[key] = resolver

    var ref: DNSServiceRef?
    let err = DNSServiceResolve(
      &ref,
      0,
      interfaceIndex,
      name,
      type,
      domain,
      resolveReply,
      Unmanaged.passUnretained(resolver).toOpaque()
    )
    guard err == .ok, let ref else {
      resolvers.removeValue(forKey: key)
      // One station failing to resolve is not fatal; the browse continues.
      emitError("Could not resolve \(name): \(Self.describe(err))")
      return
    }

    resolver.ref = ref
    resolver.source = makeSource(for: ref) { [weak self, weak resolver] err in
      guard let self, let resolver else { return }
      self.resolvers.removeValue(forKey: resolver.key)?.cancel()
      self.emitError("Could not resolve \(name): \(Self.describe(err))")
    }
  }

  /// Called on `queue` when a resolve produces a host and port.
  fileprivate func handleResolve(
    key: String,
    name: String,
    host: String,
    port: UInt16,
    txt: [String: String]
  ) {
    // A resolve is a standing subscription — it keeps reporting until cancelled.
    // We want one answer, so retire it here. `onLost` still works: it comes from
    // the browse, which is still running.
    resolvers.removeValue(forKey: key)?.cancel()

    onFound?(
      DiscoveredStation(
        name: name,
        host: host,
        port: Double(port),
        txt: txt
      )
    )
  }

  fileprivate func emitError(_ message: String) {
    onError?(message)
  }

  // MARK: - Plumbing

  /// Bridges a `DNSServiceRef`'s socket onto `queue`.
  ///
  /// The fd belongs to the ref, so the source must not close it — hence no
  /// `close()` in the cancel handler, and `DNSServiceRefDeallocate` only ever
  /// runs after the source is cancelled.
  private func makeSource(
    for ref: DNSServiceRef,
    onFailure: @escaping (DNSServiceErrorType) -> Void
  ) -> DispatchSourceRead {
    let source = DispatchSource.makeReadSource(
      fileDescriptor: DNSServiceRefSockFD(ref),
      queue: queue
    )
    source.setEventHandler {
      let err = DNSServiceProcessResult(ref)
      if err != .ok {
        onFailure(err)
      }
    }
    source.resume()
    return source
  }

  /// Tears the browse and every resolver down. Idempotent — `stop()` is
  /// documented as safe to call twice, and `deinit` may follow it.
  private func teardown() {
    for resolver in resolvers.values {
      resolver.cancel()
    }
    resolvers.removeAll()

    browseSource?.cancel()
    browseSource = nil
    if let browseRef {
      DNSServiceRefDeallocate(browseRef)
      self.browseRef = nil
    }

    onFound = nil
    onLost = nil
    onError = nil
  }

  /// Identifies a service instance. The instance name alone is not unique
  /// across domains, even though in practice we only ever see `local.`.
  private static func fullKey(name: String, type: String, domain: String) -> String {
    "\(name).\(type)\(domain)"
  }

  private static func describe(_ err: DNSServiceErrorType) -> String {
    switch err {
    case .ok: return "no error"
    case DNSServiceErrorType(kDNSServiceErr_NoSuchName): return "no such name"
    case DNSServiceErrorType(kDNSServiceErr_BadParam): return "bad parameter (is the service type valid?)"
    case DNSServiceErrorType(kDNSServiceErr_NameConflict): return "name conflict"
    case DNSServiceErrorType(kDNSServiceErr_Timeout): return "timed out"
    case DNSServiceErrorType(kDNSServiceErr_NoRouter): return "no network route"
    case DNSServiceErrorType(kDNSServiceErr_PolicyDenied): return "denied by policy (is local network access allowed?)"
    case DNSServiceErrorType(kDNSServiceErr_ServiceNotRunning): return "the mDNS daemon is not running"
    default: return "dns_sd error \(err)"
    }
  }
}

/// One in-flight `DNSServiceResolve`.
private final class Resolver {
  let key: String
  /// Unowned: the owner's `resolvers` table owns this, so it cannot outlive it.
  unowned let owner: HybridStationDiscovery
  var ref: DNSServiceRef?
  var source: DispatchSourceRead?

  init(key: String, owner: HybridStationDiscovery) {
    self.key = key
    self.owner = owner
  }

  /// Order matters: cancel the source before deallocating the ref, or the
  /// source can fire on a freed ref.
  func cancel() {
    source?.cancel()
    source = nil
    if let ref {
      DNSServiceRefDeallocate(ref)
      self.ref = nil
    }
  }

  deinit {
    cancel()
  }
}

// MARK: - C callbacks
//
// These are `@convention(c)` and cannot capture, so `self` arrives through the
// context pointer. They run on `queue`, because that is the queue the
// DispatchSource that called `DNSServiceProcessResult` runs on.

private let browseReply: DNSServiceBrowseReply = {
  _, flags, interfaceIndex, errorCode, serviceName, regtype, replyDomain, context in
  guard let context else { return }
  let this = Unmanaged<HybridStationDiscovery>.fromOpaque(context).takeUnretainedValue()

  guard errorCode == .ok else {
    this.emitError("Browse failed: dns_sd error \(errorCode)")
    return
  }
  guard let serviceName, let regtype, let replyDomain else { return }

  this.handleBrowse(
    flags: flags,
    interfaceIndex: interfaceIndex,
    name: String(cString: serviceName),
    type: String(cString: regtype),
    domain: String(cString: replyDomain)
  )
}

private let resolveReply: DNSServiceResolveReply = {
  _, _, _, errorCode, fullname, hosttarget, port, txtLen, txtRecord, context in
  guard let context else { return }
  let resolver = Unmanaged<Resolver>.fromOpaque(context).takeUnretainedValue()
  let owner = resolver.owner

  guard errorCode == .ok else {
    owner.emitError("Resolve failed: dns_sd error \(errorCode)")
    return
  }
  guard let hosttarget, let fullname else { return }

  owner.handleResolve(
    key: resolver.key,
    // The instance name must match what the browse reported, since `onLost`
    // identifies stations by it. `fullname` is escaped ("Foo\032Bar._x._tcp."),
    // so unescape rather than split.
    name: unescapeInstanceName(String(cString: fullname)),
    host: String(cString: hosttarget),
    // dns_sd reports the port in network byte order.
    port: UInt16(bigEndian: port),
    txt: parseTxt(length: txtLen, bytes: txtRecord)
  )
}

// MARK: - Decoding

/// Extracts the instance name from an escaped DNS-SD `fullname`.
///
/// The daemon escapes it per RFC 6763 §4.3 — `.` becomes `\.`, and bytes
/// outside the printable range become `\DDD` decimal escapes. The station's
/// name contains an em dash, so this path is load-bearing, not theoretical:
/// "Railroad Station — Evening Ridge" arrives as
/// `Railroad\032Station\032\226\128\148\032Evening\032Ridge`.
private func unescapeInstanceName(_ fullname: String) -> String {
  var bytes: [UInt8] = []
  let chars = Array(fullname.utf8)
  var i = 0

  while i < chars.count {
    let byte = chars[i]
    guard byte == UInt8(ascii: "\\") else {
      // An unescaped dot ends the instance name; the service type follows.
      if byte == UInt8(ascii: ".") { break }
      bytes.append(byte)
      i += 1
      continue
    }

    // A `\DDD` decimal escape, or `\x` for a literal x.
    let digits = chars[(i + 1)...].prefix(3)
    if digits.count == 3, digits.allSatisfy({ $0 >= UInt8(ascii: "0") && $0 <= UInt8(ascii: "9") }),
       let value = UInt16(String(decoding: digits, as: UTF8.self)), value <= 255 {
      bytes.append(UInt8(value))
      i += 4
    } else if i + 1 < chars.count {
      bytes.append(chars[i + 1])
      i += 2
    } else {
      i += 1
    }
  }

  // The escapes carry raw bytes, and the name is UTF-8 by RFC 6763 §4.1.1.
  return String(decoding: bytes, as: UTF8.self)
}

/// Decodes a TXT record into key/value pairs.
///
/// TXT records are length-prefixed `key=value` byte strings, not text, so this
/// goes through `TXTRecordGetItemAtIndex` rather than splitting a string.
private func parseTxt(length: UInt16, bytes: UnsafeRawPointer?) -> [String: String] {
  guard let bytes, length > 0 else { return [:] }

  var result: [String: String] = [:]
  let count = TXTRecordGetCount(length, bytes)

  for index in 0..<count {
    // RFC 6763 §6.4 caps a key at 9 characters; 256 is far past any real one.
    var key = [CChar](repeating: 0, count: 256)
    var valueLength: UInt8 = 0
    var value: UnsafeRawPointer?

    let err = TXTRecordGetItemAtIndex(
      length, bytes, index, UInt16(key.count), &key, &valueLength, &value
    )
    guard err == .ok else { continue }

    // A valueless key ("flag" form) is legal and maps to "".
    var decoded = ""
    if let value, valueLength > 0 {
      decoded = String(
        decoding: UnsafeRawBufferPointer(start: value, count: Int(valueLength)),
        as: UTF8.self
      )
    }
    result[String(cString: key)] = decoded
  }

  return result
}
