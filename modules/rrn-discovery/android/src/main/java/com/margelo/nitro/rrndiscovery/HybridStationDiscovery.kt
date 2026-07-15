package com.margelo.nitro.rrndiscovery

import android.annotation.SuppressLint
import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import androidx.annotation.Keep
import com.facebook.proguard.annotations.DoNotStrip
import com.margelo.nitro.NitroModules
import java.net.InetAddress

/**
 * Browses for stations using `NsdManager`, Android's Bonjour/DNS-SD service.
 *
 * The counterpart of the iOS `<dns_sd.h>` implementation, and deliberately the
 * same shape: emit found/lost, hold no state worth testing, and let the JS seam
 * accumulate the list.
 *
 * `NsdManager` has one notorious sharp edge — see [pump]. Discovery reports a
 * service's *name* only; a separate resolve is what yields host, port and TXT,
 * and the platform tolerates exactly one resolve at a time.
 */
@DoNotStrip
@Keep
class HybridStationDiscovery : HybridStationDiscoverySpec() {

  /**
   * Every mutation below happens here.
   *
   * `NsdManager` fires its callbacks on an internal binder thread, so without
   * this the resolve queue would race the discovery callbacks. Same reasoning
   * as the serial `DispatchQueue` on iOS.
   */
  private val thread = HandlerThread("network.railroad.discovery").apply { start() }
  private val handler = Handler(thread.looper)

  private var nsdManager: NsdManager? = null
  private var discoveryListener: NsdManager.DiscoveryListener? = null

  /** Services seen but not yet resolved. */
  private val pending = ArrayDeque<NsdServiceInfo>()
  /** At most one resolve may be in flight; see [pump]. */
  private var resolving = false

  private var onFound: ((DiscoveredStation) -> Unit)? = null
  private var onLost: ((String) -> Unit)? = null
  private var onError: ((String) -> Unit)? = null

  // MARK: - Spec

  override fun start(
    serviceType: String,
    onFound: (station: DiscoveredStation) -> Unit,
    onLost: (name: String) -> Unit,
    onError: (message: String) -> Unit
  ) {
    handler.post {
      // Documented behaviour: starting while started restarts the browse.
      teardown()

      this.onFound = onFound
      this.onLost = onLost
      this.onError = onError

      val context = NitroModules.applicationContext
      if (context == null) {
        onError("Could not look for stations: the app context is not available.")
        return@post
      }

      val manager = context.getSystemService(Context.NSD_SERVICE) as? NsdManager
      if (manager == null) {
        onError("This device does not support finding services on the local network.")
        return@post
      }
      nsdManager = manager

      val listener = object : NsdManager.DiscoveryListener {
        override fun onServiceFound(service: NsdServiceInfo) {
          handler.post { enqueue(service) }
        }

        override fun onServiceLost(service: NsdServiceInfo) {
          handler.post {
            // Drop it from the queue if we never got round to resolving it —
            // nothing wants the answer now. A resolve already in flight is left
            // alone; its reply is discarded on arrival.
            pending.removeAll { it.serviceName == service.serviceName }
            this@HybridStationDiscovery.onLost?.invoke(service.serviceName)
          }
        }

        override fun onDiscoveryStarted(serviceType: String) = Unit

        override fun onDiscoveryStopped(serviceType: String) = Unit

        override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) {
          handler.post {
            emitError("Could not look for stations: ${describe(errorCode)}")
            teardown()
          }
        }

        override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) {
          // Nothing useful to say: we are already tearing down.
        }
      }

      try {
        manager.discoverServices(serviceType, NsdManager.PROTOCOL_DNS_SD, listener)
        discoveryListener = listener
      } catch (error: IllegalArgumentException) {
        // Thrown for a malformed service type rather than reported via the
        // listener.
        onError("Could not look for stations: ${error.message}")
      }
    }
  }

  override fun stop() {
    handler.post { teardown() }
  }

  // MARK: - Resolve

  private fun enqueue(service: NsdServiceInfo) {
    // The same instance arrives once per interface (Wi-Fi and Ethernet both), and
    // can be re-announced. First resolve wins.
    if (pending.any { it.serviceName == service.serviceName }) return
    pending.addLast(service)
    pump()
  }

  /**
   * Starts the next resolve, if one is not already running.
   *
   * **This serialisation is the whole point.** `NsdManager` permits exactly one
   * `resolveService` at a time: a second concurrent call fails with
   * `FAILURE_ALREADY_ACTIVE`, and — the part that actually bites — a
   * `ResolveListener` instance may never be reused, so the naive fix of keeping
   * one listener around throws `IllegalArgumentException("listener already in
   * use")`. Hence a queue, and a fresh listener per attempt.
   */
  private fun pump() {
    if (resolving) return
    val service = pending.removeFirstOrNull() ?: return
    resolving = true

    val manager = nsdManager
    if (manager == null) {
      resolving = false
      return
    }

    val listener = object : NsdManager.ResolveListener {
      override fun onServiceResolved(resolved: NsdServiceInfo) {
        handler.post {
          resolving = false
          // Discarded if the browse was stopped, or if the service went away
          // while its resolve was in flight.
          if (discoveryListener != null) {
            deliver(resolved)
          }
          pump()
        }
      }

      override fun onResolveFailed(failed: NsdServiceInfo, errorCode: Int) {
        handler.post {
          resolving = false
          if (errorCode == NsdManager.FAILURE_ALREADY_ACTIVE) {
            // Another resolve was still winding down inside the platform. Put it
            // back rather than dropping the station on the floor.
            pending.addLast(failed)
          } else {
            // One station failing to resolve is not fatal; discovery continues.
            emitError("Could not resolve ${failed.serviceName}: ${describe(errorCode)}")
          }
          pump()
        }
      }
    }

    try {
      @Suppress("DEPRECATION")
      manager.resolveService(service, listener)
    } catch (error: IllegalArgumentException) {
      resolving = false
      emitError("Could not resolve ${service.serviceName}: ${error.message}")
      pump()
    }
  }

  private fun deliver(resolved: NsdServiceInfo) {
    val host = hostOf(resolved)
    if (host == null) {
      emitError("Could not resolve ${resolved.serviceName}: it reported no address.")
      return
    }

    onFound?.invoke(
      DiscoveredStation(
        name = resolved.serviceName,
        host = host,
        port = resolved.port.toDouble(),
        txt = txtOf(resolved)
      )
    )
  }

  /**
   * The address to reach the station on.
   *
   * **This diverges from iOS on purpose, because the platforms differ.** `dns_sd`
   * hands back the `.local.` hostname; `NsdManager` resolves it away and only
   * ever exposes `InetAddress`, so Android yields a bare IP. Both are usable —
   * the transport (T1.3.4) only needs to build a URL — but an IP does not
   * survive the station's DHCP lease changing, so a paired Android device may
   * need to re-discover where an iOS one would not. That is a pairing-storage
   * concern (T1.3.3), not something this layer can fix.
   */
  @SuppressLint("NewApi")
  private fun hostOf(resolved: NsdServiceInfo): String? {
    val address: InetAddress? =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
        resolved.hostAddresses.firstOrNull()
      } else {
        @Suppress("DEPRECATION")
        resolved.host
      }
    return address?.hostAddress
  }

  /** TXT records are bytes, not text; a valueless key is legal and maps to "". */
  private fun txtOf(resolved: NsdServiceInfo): Map<String, String> {
    return resolved.attributes.orEmpty().mapValues { (_, value) ->
      value?.toString(Charsets.UTF_8) ?: ""
    }
  }

  // MARK: - Plumbing

  private fun emitError(message: String) {
    onError?.invoke(message)
  }

  /** Idempotent — `stop()` is documented as safe to call twice. */
  private fun teardown() {
    discoveryListener?.let { listener ->
      try {
        nsdManager?.stopServiceDiscovery(listener)
      } catch (error: IllegalArgumentException) {
        // Already stopped, or never successfully started. Nothing to do.
      }
    }
    discoveryListener = null
    nsdManager = null
    pending.clear()
    // `resolving` is deliberately not cleared: a resolve may still be in flight
    // inside the platform, and starting another before it lands would trip
    // FAILURE_ALREADY_ACTIVE. Its callback resets the flag and finds no
    // listener, so it delivers nothing.

    onFound = null
    onLost = null
    onError = null
  }

  private fun describe(errorCode: Int): String = when (errorCode) {
    NsdManager.FAILURE_ALREADY_ACTIVE -> "already in progress"
    NsdManager.FAILURE_INTERNAL_ERROR -> "internal error"
    NsdManager.FAILURE_MAX_LIMIT -> "too many requests"
    else -> "error $errorCode"
  }
}
