# Railroad Network — mobile

[![CI](https://github.com/railroad-network/mobile/actions/workflows/ci.yml/badge.svg)](https://github.com/railroad-network/mobile/actions/workflows/ci.yml)

> **Status:** Phase 1 — in progress (M1.1–M1.6 complete, M1.7 underway).
> Pre-audit. **Do not use with real value.**

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

> This is research-stage software. The cryptography has **not** yet been
> independently audited. Do not use it to hold, transfer, or represent anything
> of real value.

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
- **Marketplace (M1.6 → M1.7, in progress).** Browse and create listings,
  make and respond to inquiries, and pay for an agreed inquiry, with the
  transaction linked to the listing it settles.

The app pairs with a local [`station`](https://github.com/railroad-network/station)
daemon as its backend, and has been exercised end-to-end on a physical Android
device. The cryptography is still **pre-audit** — do not use with real value.

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
