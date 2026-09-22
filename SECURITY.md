# Security Policy

## Supported Versions

**None.** Railroad Network mobile is pre-release, research-stage software. The
client is feature-complete for a single-community pilot and has had an internal
AI-assisted security review (see
[Audit status](README.md#audit-status)), but no independent professional
audit. There are no supported releases; the signed APK is for pilots with play
stakes, and nothing here should be used to hold, transfer, or represent
anything of real value.

## Reporting a Vulnerability

If you believe you've found a security vulnerability in this app, in the
[`station`](https://github.com/railroad-network/station) daemon it pairs with,
or in the documentation site, please **do not open a public GitHub issue, pull
request, or discussion**. Instead, email:

**security@railroad-network.org**

Please include:

- A description of the vulnerability and its potential impact
- Steps to reproduce, or a proof of concept if available
- The commit hash or app version you tested against, and the phone model if
  it matters

### What to expect

- We aim to acknowledge reports within **5 business days**.
- We will work with you to understand and confirm the issue, and will let you
  know our intended timeline for a fix.
- Please give us a reasonable amount of time to address the issue before any
  public disclosure.

### What is already public

Every audit report is published, and the threat model states plainly what is
*not* mitigated:

- [`docs/security/audit-2026-08.md`](docs/security/audit-2026-08.md): the
  August 2026 review of this client.
- The station repo's
  [threat model](https://github.com/railroad-network/station/blob/main/docs/threat-model.md),
  whose **Mobile client** section and **Known limitations** cover the phone:
  no forward secrecy on the sealed channel, a TOFU pairing bond secured by the
  in-person code comparison, and the opt-in background-sync credential being a
  full-power signing wallet while the device is unlocked.

Thank you for helping keep Railroad Network and its users safe.
