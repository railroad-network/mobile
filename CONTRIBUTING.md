# Contributing

Railroad Network mobile is currently in **Phase 1**, built by a single
maintainer following the milestone plan shared with the `station` repo.
**External contributions are not yet being accepted** — the client is still
establishing its architecture (crypto FFI, pairing/transport, core screens)
and accepting outside changes before that settles would create rework for
everyone.

Contributions are expected to open up starting in **M2**. This file will be
updated with the process (issue triage, review expectations, etc.) at that
point.

## In the meantime

- **Bug reports and questions**: feel free to open an issue.
- **Security issues**: do not open a public issue — see
  [SECURITY.md](SECURITY.md).

## DCO sign-off

Once contributions open, all commits must include a `Signed-off-by` line
(the [Developer Certificate of Origin](https://developercertificate.org/)),
added automatically with `git commit -s`. This certifies that you have the
right to submit the contribution under the project's license.

## Architecture Decision Records (ADRs)

Locked design decisions that affect this repo (e.g. client architecture,
Rust FFI choice) are recorded as ADRs in the canonical
[`station`](https://github.com/railroad-network/station) repo, under
`docs/adr/`. If a contribution here would change or introduce a locked
decision, it should come with a corresponding ADR there.

## Code of Conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md).

## License

By contributing, you agree that your contributions will be licensed under the
project's dual [Apache-2.0](LICENSE-APACHE) OR [MIT](LICENSE-MIT) license.
