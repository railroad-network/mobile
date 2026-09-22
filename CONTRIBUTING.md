# Contributing

Railroad Network mobile is built by a single maintainer, with AI-assisted
review, alongside the [`station`](https://github.com/railroad-network/station)
repo it pairs with. The project is **pre-audit**: the client is feature-complete
for a single-community pilot, but the 90-day pilot and the independent
professional security audit have not happened. Until that audit lands,
**unsolicited code contributions are not being merged**; every line has to be
defensible to the auditors, and the FFI and wire formats are shared with the
station, so most changes land in both repos together.

What is genuinely useful right now:

1. **Run a pilot** and report what confused people. The guides at
   <https://railroad-network.github.io> are the runbook.
2. **Report bugs**: open an issue with the app version (Settings), the phone
   model, and the text from **Settings → Advanced → Diagnostics** if the app
   recorded an error.
3. **Fix the documentation**: the docs site
   ([`railroad-network.github.io`](https://github.com/railroad-network/railroad-network.github.io))
   takes pull requests, and so do this repo's `README.md` and `SIDELOAD.md`.
4. **Security issues**: never a public issue. See [SECURITY.md](SECURITY.md).

If you want to propose a code change anyway, open an issue describing it first.
A change to the FFI surface or a signed record starts in the `station` repo,
with an ADR if it touches a locked decision, and its cross-platform fixture is
what this repo's tests verify against.

## Development workflow

```sh
nvm use && yarn install
yarn ubrn:android        # or ubrn:ios; rebuilds the Rust FFI from ../station
yarn tsc --noEmit        # typecheck
yarn lint                # eslint
yarn test                # jest
```

Conventions:

- **The key never leaves the Rust core.** Screens work with the `Wallet`
  session; nothing in TypeScript sees or logs the secret.
- **Every signed record is domain-separated and canonical.** New record kinds
  get a fixture in the station repo and a test here that reproduces the bytes.
- **Milestone and ticket codes stay out of code, comments, and commits.** Cite
  the ADR or describe the behaviour.
- **Commits are lightweight conventional commits.** No AI session links in
  anything committed.

## Architecture Decision Records

Locked design decisions that affect this repo (client architecture, the Rust
FFI, the transport envelope, key recovery) are recorded as ADRs in the
[`station`](https://github.com/railroad-network/station) repo under
`docs/adr/`. A contribution here that would change or introduce a locked
decision comes with an ADR there.

## DCO sign-off

All commits must carry a `Signed-off-by` line (the
[Developer Certificate of Origin](https://developercertificate.org/)), added
with `git commit -s`. It certifies that you have the right to submit the
contribution under the project's license.

## Code of Conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md).

## License

By contributing, you agree that your contributions will be licensed under the
project's dual [Apache-2.0](LICENSE-APACHE) OR [MIT](LICENSE-MIT) license.
