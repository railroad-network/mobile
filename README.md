# Railroad Network — mobile

[![CI](https://github.com/railroad-network/mobile/actions/workflows/ci.yml/badge.svg)](https://github.com/railroad-network/mobile/actions/workflows/ci.yml)

> **Status:** the full Phase 1 client is in place (wallet, pairing, payments,
> vouching, standing, marketplace, governance, disputes) plus member key
> recovery, and a signed, sideloadable Android release is available for
> pilots. The app is **online-only for signing**: the Phase 2 offline features
> (outbox, headroom certificates, paper export) exist in the Rust core and in
> the command-line wallet, not yet as screens here. An internal AI-assisted
> security review found no High-severity issues (see
> [Audit status](#audit-status)); an independent professional audit is still
> pending. **Do not use with real value.**

**Railroad Network** is a platform for self-organizing communities: a
mutual-credit economy denominated in a single unit (the "Common"),
decentralized identity with social vouching and Shamir-based social recovery,
a tiered oracle and dispute system for adjudicating real-world transactions,
community governance, and, eventually, a federation protocol between
communities. The plain-language documentation for members, organizers, and
operators is at **<https://railroad-network.github.io>**.

This repository, **`mobile`**, is the React Native + TypeScript client. It
pairs with a local [`station`](https://github.com/railroad-network/station),
the canonical Rust implementation, which holds the community's ledger. Per
[ADR-0006](https://github.com/railroad-network/station/blob/main/docs/adr/0006-m1-client-architecture.md),
the phone is the authoritative key-holder: it generates its own keypair,
never hands the secret to anyone, and signs every request; the station is a
local backend that records what members sign. Rust crypto (`rrn-crypto`,
`rrn-identity`) runs on-device through
[uniffi-rs bindings](https://github.com/railroad-network/station/blob/main/docs/adr/0007-rust-mobile-ffi-uniffi.md)
(ADR-0007), and every message between phone and station is a sealed envelope
(ADR-0008) so the plain-HTTP transport needs no TLS.

> This is research-stage software. It has had an internal AI-assisted security
> review, but the cryptography has **not** been independently audited by a
> professional security firm. Do not use it to hold, transfer, or represent
> anything of real value.

## What the app does

Built on React Native's New Architecture (Fabric + TurboModules), exercised
end to end on a physical Android device against a real station:

- **On-device crypto.** `rrn-crypto` / `rrn-identity` run natively; the app
  holds its own keypair and signs every request.
- **Wallet.** Guided onboarding, passphrase- and biometric-gated unlock, home
  balance, send and receive, transaction history, wallet export, change
  passphrase, factory reset.
- **Joining a community.** mDNS discovery of the station, or add by address,
  then the in-person pairing ceremony: an 8-character code compared aloud
  with the operator. Background sync with local notifications, opt-in for
  when the app is closed.
- **Vouching and standing.** Browse the community, vouch for people you know,
  device-local nicknames, and a Standing screen backed by the station's
  reputation read path, with a banner while the community is in bootstrap
  grace.
- **Marketplace.** Browse and create listings, announce needs, open inquiries
  with counter-offers, sign recurring service contracts, and pay for an agreed
  inquiry with the payment linked to the listing.
- **Governance.** Read the Charter and statutes, author, co-sign, and vote on
  proposals, and sign the *founding* Charter on-device so a phone-held founder
  takes part in the genesis ceremony without the key leaving the phone. An
  emergency banner when one is active.
- **Disputes.** Contest a confirmed payment, respond as the other party, rule
  as a seated juror, escalate and appeal.
- **Social recovery, both directions.** Split your key into shards sealed to
  a circle of 3 to 7 holders (any 3 rebuild it); hold shards for others;
  answer a recovery request. On a new phone, **Recover an existing identity**
  rebuilds your key from your circle (request QR, ceremony fingerprint read
  aloud, holder responses scanned in) or restores a saved wallet export, then
  sets a fresh passphrase and re-pairs. Reconstruction runs entirely on the
  member's device; the station never sees the key.
- **Pilot readiness.** A crash-safe error boundary with a Diagnostics screen
  members can copy from, and a signed arm64 release APK for sideloading.

## What the app does not do yet

- **Sign while the station is unreachable.** A payment, confirmation, vote, or
  dispute that cannot reach the station is refused with a clear message and
  retried later; nothing is queued. The delay-tolerant outbox, headroom
  certificates for offline spending, courier bundles, and paper export are
  implemented in the station repo's `rrn-mobile-ffi` crate and shipped today
  in the `rrn wallet` command-line client; the screens that would use them on
  the phone are not written.
- **Compose SMS.** The station's SMS carrier has no modem gateway yet, so
  there is nothing to text to.
- **Run on iOS** beyond development builds. The pilot fleet is Android,
  sideloaded.
- **Talk to more than one community.** Federation is Phase 3.

## Installing (sideload)

There is no app-store distribution: pilot users install a signed release APK
directly. [`SIDELOAD.md`](SIDELOAD.md) covers both halves: building and
signing the APK as a maintainer, and installing or updating it as a user,
including the battery-optimization exemption some phones need for background
sync. The member-facing version is
[Install the app](https://railroad-network.github.io/members/install-the-app.html)
on the docs site. Standing up a whole community around it (station, pairing,
founding Charter, backups) is the operator's runbook in the station repo,
[`docs/community-setup.md`](https://github.com/railroad-network/station/blob/main/docs/community-setup.md);
keeping phones syncing in the background, per vendor, is
[`docs/background-reliability.md`](https://github.com/railroad-network/station/blob/main/docs/background-reliability.md).

## Building

Requires [Xcode](https://developer.apple.com/xcode/) (iOS) and
[Android Studio](https://developer.android.com/studio) (Android). Follow the
React Native [environment setup guide](https://reactnative.dev/docs/set-up-your-environment)
for platform prerequisites.

The native crypto is compiled from the `rrn-mobile-ffi` crate in the
[`station`](https://github.com/railroad-network/station) repo, which
`ubrn.config.yaml` expects checked out as a sibling directory (`../station`).
[`uniffi-bindgen-react-native`](https://github.com/railroad-network/station/blob/main/docs/adr/0007-rust-mobile-ffi-uniffi.md)
builds the Rust library and emits the JSI/TypeScript glue (this also needs a
Rust toolchain and, for Android, the NDK + `cargo-ndk`).

```sh
# use the pinned Node version (see .nvmrc)
nvm use

yarn install

# generate + build the Rust FFI (from ../station); re-run after FFI changes
yarn ubrn:ios       # iOS (simulator)
yarn ubrn:android   # Android

# iOS: install CocoaPods deps (first run, and after any native dep change)
bundle install
bundle exec pod install --project-directory=ios

yarn ios       # build + launch iOS simulator
yarn android   # build + launch Android emulator

yarn tsc --noEmit   # typecheck
yarn lint           # eslint
yarn test           # unit tests
```

Wire formats are shared with the station: the app verifies its CBOR encodings
against fixtures in the station repo, so a new signed record kind always
lands in both. When the FFI surface changes in `../station`, re-run the
`ubrn:*` step here.

## Audit status

**Internal AI-assisted review complete; independent professional audit
pending.** A security review of the mobile client was performed on 2026-08-25 at
commit [`b32f2ca`](https://github.com/railroad-network/mobile/commit/b32f2ca),
covering on-device key custody, the transport and pairing envelope as the phone
builds them, the QR ceremony surfaces, background execution, and the Android/iOS
platform configuration. (The Rust cryptographic core is reviewed in the
[`station` audit](https://github.com/railroad-network/station/blob/main/docs/security/audit-2026-08.md).)
It reported **no High-severity findings**, with **2 Medium, 4 Low, and 4 Info**
findings concentrated at the pairing and recovery ceremony surfaces and at
platform exposure (clipboard, screen capture, keychain accessibility). The full
report, with each finding's failure scenario and a remediation order, is at
[`docs/security/audit-2026-08.md`](docs/security/audit-2026-08.md). The
recovery-ceremony finding about an unauthenticated request (RRN-M-002) is
closed by the ceremony fingerprint every requester and holder card now shows.

Important: this was a **code review performed by an AI model** operated by the
maintainer, **not** a penetration test or an attestation by a professional
security firm. It is intended to raise the floor, not to clear the stack for
production. Absence of a finding is not evidence of absence, and an independent
professional audit remains warranted before any deployment where real people
depend on this software's guarantees. Per the project's open-source posture,
all audit reports are public.

## Design documents

The design overview, the Architecture Decision Records, the wire specs, and
the threat model live in the
[`station`](https://github.com/railroad-network/station) repo, under
[`docs/`](https://github.com/railroad-network/station/tree/main/docs). The
threat model's **Mobile client** section covers this app.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the current contribution policy.

## License

Licensed under either of [Apache License, Version 2.0](LICENSE-APACHE) or
[MIT license](LICENSE-MIT) at your option. Contributions are accepted under
the same dual license, per [CONTRIBUTING.md](CONTRIBUTING.md).
