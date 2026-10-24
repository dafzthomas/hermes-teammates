# Security policy

Hermes Teammates is an early, single-user local application. Security fixes target
the current `main` branch. Older snapshots have no separate maintenance guarantee.

## Report a vulnerability privately

Use [GitHub's private vulnerability report form](https://github.com/dafzthomas/hermes-teammates/security/advisories/new).
Do not open a public issue with an exploit, credential, private transcript, or
identifying account data. If the form is unavailable, use a contact method listed
on [the maintainer's profile](https://github.com/dafzthomas) and ask for a private
reporting channel before sending sensitive material.

Include the affected commit, operating system, Hermes version, reproduction steps,
and expected impact. Use synthetic accounts and credentials. Explain whether the
problem crosses a documented boundary, such as the loopback origin checks,
approval ownership, VM takeover fence, or metadata-only credential responses.

The maintainer will assess reports and coordinate a fix and disclosure when
possible. There is no response-time commitment or bug-bounty program.

## Understand the trust model

- Bot profiles separate configuration and data. Host tools still run as the current
  OS user and can reach other files that user can access.
- The HTTP backend binds to loopback. It has browser origin checks but no remote-user
  authentication. Do not publish its port directly to the internet.
- API keys use plaintext native Hermes credential files with owner-only permissions.
  Website passwords use a separate encrypted vault with an adjacent local key.
  Neither provides protection against a hostile process running as the same OS user.
- Connected MCP commands run on the host. HTTP MCP servers receive the credentials
  selected for them. Connect trusted servers with the minimum necessary access.
- Managed app reviews cover those app calls. Native Hermes tools retain their own
  approval policy. Not every tool action requires a decision.
- A per-Bot VM isolates guest files, but it does not sandbox all native host tools.
  Its browser is separate from the native Hermes browser and its login vault.
- Model providers receive prompts and tool results. Do not put secrets in chat.
  Display redaction cannot guarantee removal of transformed or unknown secrets.

These limitations are documented behavior, not assurances of production isolation.
See the [architecture](docs/architecture.md) and [verification report](docs/verification.md)
for the implementation and the boundaries actually tested.
