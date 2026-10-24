# Changelog

This file records user-visible changes. The repository version is `0.1.0`.
A version in `package.json` does not imply a signed binary release or an npm package.

## Unreleased

### Added

- Installable Capacitor iOS/Android clients with phone navigation, Bot and group
  conversations, Activity decisions, steering/Stop, settings, memory and routines.
- Opt-in HTTPS mobile gateway with one-use pairing, expiring revocable devices,
  native secure credential storage and an explicit remote API allowlist.

- Persistent Hermes-backed Bots with separate role, model, memory, skills,
  workspace files, credentials, and conversations.
- Claude through Hermes' Anthropic provider and configurable OpenAI-compatible
  Chat Completions endpoints, including local Ollama.
- Native Bot-to-Bot messaging, shared group conversations, separate threads,
  durable unread state, and reply previews.
- Native cron routines, saved results, Bot Chat delivery, and live autonomous
  questions, approval cards, steering, and Stop.
- Original dark desktop interface, responsive navigation, and an Electron shell.
- Per-Bot Linux desktops on Apple silicon with persistent homes, live screens,
  manual takeover, and native Hermes MCP tools.
- Per-Bot HTTP and stdio MCP app connections with credential bindings and editable
  action reviews.
- Native encrypted website-login vault management, optional authenticator setup
  keys, and masked login, verification-code, and manager-unlock cards.
- Automated store, API, and native integration checks, compiled UI acceptance
  workflows, and an Ubuntu CI workflow.
- Public setup, contribution, support, conduct, security, and architecture docs.

### Current limits

- Local work requires an awake backend. Webhook triggers, voice, rich media and multi-user/team access are not included.
  Mobile device access is single-owner and requires the separate HTTPS gateway.
- Bot computers require Apple silicon and macOS 26 or later. Other desktop
  platforms and signed distribution have not been verified.
- API keys retain native plaintext storage. Host profile separation is not an OS
  sandbox. The encrypted website vault and Computer VM use separate browsers.
- Live provider accounts, OAuth entitlement, and real password-manager accounts
  are not covered by the controlled integration fixtures.

See the [feature audit](docs/research.md) for comparisons and development priorities.
