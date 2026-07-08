# Railroad Network — mobile

[![CI](https://github.com/railroad-network/mobile/actions/workflows/ci.yml/badge.svg)](https://github.com/railroad-network/mobile/actions/workflows/ci.yml)

> **Status:** Phase 1 — in progress. Skeleton only; no product screens yet.
> **Do not use with real value.**

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

This repo currently holds a bare React Native + TypeScript skeleton (New
Architecture: Fabric + TurboModules) with CI wired up. No custom screens,
authentication, network code, or crypto integration yet — those land in
later Phase 1 milestones (M1.1 – M1.4).

## Building

Requires [Xcode](https://developer.apple.com/xcode/) (iOS) and
[Android Studio](https://developer.android.com/studio) (Android). Follow the
React Native [environment setup guide](https://reactnative.dev/docs/set-up-your-environment)
for platform prerequisites, then:

```sh
# use the pinned Node version (see .nvmrc)
nvm use

yarn install

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
