# Railroad Network — mobile

[![CI](https://github.com/railroad-network/mobile/actions/workflows/ci.yml/badge.svg)](https://github.com/railroad-network/mobile/actions/workflows/ci.yml)

> **Status:** Phase 1 — M1.1–M1.11 complete: the full client is in place and a
> signed, sideloadable Android release is available for pilots. An internal
> AI-assisted security review has been completed (no High-severity findings; see
> [Audit status](#audit-status)); an independent professional audit is still
> pending. **Do not use with real value.**

**Railroad Network** is a federated platform for self-organizing communities: a
mutual-credit economy denominated in a single unit (the "Common"),
decentralized identity with social vouching and Shamir-based social recovery,
a tiered oracle and dispute system for adjudicating real-world transactions,
and a federation protocol between communities.

This repository, **`mobile`**, is the React Native + TypeScript client. It is
one of several repos in the Railroad Network project — see the
[`railroad-network`](https://github.com/railroad-network) org for the full
list, and in particular [`station`](https://github.com/railroad-network/station),
the canonical Rust implementation that this app pairs with as a local backend.

Per [ADR-0006](https://github.com/railroad-network/station/blob/main/docs/adr/0006-m1-client-architecture.md),
mobile is the authoritative key-holder: it holds its own keypair and signs
every request, while `station` is a local backend it pairs with for ledger
replication, peer gossip, and remote-of-record state. Rust crypto
(`rrn-crypto`, `rrn-identity`) runs on-device via [uniffi-rs bindings](https://github.com/railroad-network/station/blob/main/docs/adr/0007-rust-mobile-ffi-uniffi.md)
(see ADR-0007).

> This is research-stage software. It has had an internal AI-assisted security
> review, but the cryptography has **not** yet been independently audited by a
> professional security firm (see [Audit status](#audit-status)). Do not use it
> to hold, transfer, or represent anything of real value.

## Phase 1 status

Built on React Native's New Architecture (Fabric + TurboModules), with CI
wired up. What's implemented so far:

- **On-device crypto (M1.1).** `rrn-crypto` / `rrn-identity` run natively via
  [uniffi-rs bindings](https://github.com/railroad-network/station/blob/main/docs/adr/0007-rust-mobile-ffi-uniffi.md)
  — the app holds its own keypair and signs every request.
- **Wallet (M1.2).** Onboarding, passphrase- and biometric-gated unlock,
  Shamir-based social recovery (split, distribute, held shards, reconstruct),
  home balance, send / receive, and transaction history.
- **Station transport (M1.3).** QR pairing to a local `station`, sealed-envelope
  RPC, long-poll push updates, and background sync with local notifications.
- **Vouching (M1.4).** Browse the community, vouch for identities, and manage
  device-local nicknames.
- **Reputation (M1.5).** A Standing screen backed by the station's reputation
  read path.
- **Marketplace (M1.6–M1.7).** Browse and create listings, announce needs,
  open inquiries with counter-offers, sign recurring service contracts, and
  pay for an agreed inquiry, with the transaction linked to the listing it
  settles.
- **Oracle tiers (M1.8).** Tiered settlement surfaced in the transaction
  flows, plus a banner while the community is in bootstrap grace.
- **Governance (M1.9).** A Governance hub: read the Charter and statutes,
  author and co-sign proposals, and vote — plus signing the *founding*
  Charter on-device, so a phone-held founder can take part in the genesis
  ceremony without their key leaving the phone.
- **Disputes (M1.10).** Contest a confirmed transaction, respond as the
  other party, and rule as a seated juror, with escalation and appeal.
- **Pilot readiness (M1.11).** Guided join-your-community onboarding (mDNS
  discovery → in-person pairing-code ceremony), station backup participation
  ("Shards you hold" / "Help someone recover" for ADR-0016 station key
  recovery), a crash-safe error boundary with a Diagnostics screen, and a
  signed arm64 release APK for sideloading.

The app pairs with a local [`station`](https://github.com/railroad-network/station)
daemon as its backend, and every milestone above has been exercised end-to-end
on a physical Android device. An internal AI-assisted security review is
complete; an independent professional audit is still pending (see
[Audit status](#audit-status)) — do not use with real value.

## Installing (sideload)

There is no app-store distribution: pilot users install a signed release APK
directly. [`SIDELOAD.md`](SIDELOAD.md) covers both halves — building and
signing the APK as a maintainer, and installing/updating it as a user
(including the battery-optimization exemption some phones need for background
sync). For standing up a whole community around it — station, pairing,
founding Charter, backups — see the steward's runbook in the station repo:
[`docs/community-setup.md`](https://github.com/railroad-network/station/blob/main/docs/community-setup.md).
Keeping members' phones syncing reliably in the background (the per-vendor
battery quirks, and a verification drill) has its own runbook:
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

## Audit status

**Internal AI-assisted review complete; independent professional audit
pending.** A security review of the mobile client was performed on 2026-08-25 at
commit [`b32f2ca`](https://github.com/railroad-network/mobile/commit/b32f2ca),
covering on-device key custody, the transport and pairing envelope as the phone
builds them, the QR ceremony surfaces, background execution, and the Android/iOS
platform configuration. (The Rust cryptographic core is reviewed in the
[`station` audit](https://github.com/railroad-network/station/blob/main/docs/security/audit-2026-08.md).)
It reported **no High-severity findings** — the client keeps the wallet secret
inside the Rust core, holds the unlocked wallet only in memory and drops it on
background, binds the sealed envelope's recipient inside the signed bytes,
serializes monotonic transport nonces, and domain-separates every signed record
— with **2 Medium, 4 Low, and 4 Info** findings concentrated at the pairing and
recovery ceremony surfaces and at platform exposure (clipboard, screen capture,
keychain accessibility). The full report, with each finding's failure scenario
and a remediation order, is at
[`docs/security/audit-2026-08.md`](docs/security/audit-2026-08.md).

Important: this was a **code review performed by an AI model** operated by the
maintainer, **not** a penetration test or an attestation by a professional
security firm. It is intended to raise the floor, not to clear the stack for
production. Absence of a finding is not evidence of absence, and an independent
professional audit remains warranted before any deployment where real people
depend on this software's guarantees. The client stays experimental until that
review lands. Per the project's open-source posture, all audit reports are
public.

## Design documents

The full design overview and Architecture Decision Records live in the
[`station`](https://github.com/railroad-network/station) repo, under
[`docs/design/`](https://github.com/railroad-network/station/tree/main/docs/design)
and [`docs/adr/`](https://github.com/railroad-network/station/tree/main/docs/adr).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the current contribution policy.

## License

Licensed under either of [Apache License, Version 2.0](LICENSE-APACHE) or
[MIT license](LICENSE-MIT) at your option. Contributions are accepted under
the same dual license, per [CONTRIBUTING.md](CONTRIBUTING.md).
