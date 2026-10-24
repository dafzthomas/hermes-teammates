# Get help

Start with the [README](README.md) for setup, model access, computers, app
connections, and website logins. The [verification report](docs/verification.md)
records the tested Hermes version and known integration limits.

For reproducible defects, [open a bug report](https://github.com/dafzthomas/hermes-teammates/issues/new?template=bug_report.yml).
For a new capability, [open a feature request](https://github.com/dafzthomas/hermes-teammates/issues/new?template=feature_request.yml).
For a setup question, [open a question](https://github.com/dafzthomas/hermes-teammates/issues/new?template=question.yml).
Support is community-based, without a promised response time.

Include your app commit, OS and architecture, Node.js version, Hermes version, the
command you ran, and the exact error after redaction. Say whether the problem occurs
in the browser app, Electron, a native tool, or a Bot computer. If relevant, name
the model provider without sharing its key.

Do not attach API keys, vault files or keys, `auth.json`, `.env`, private
transcripts, or unsanitized app data directories. Review screenshots and logs
before uploading them. Report vulnerabilities through the [security policy](SECURITY.md).

## Find the right project

Hermes Teammates owns its interface, loopback API, app-review bridge, and managed
VM integration. Hermes owns inference, native tools, provider authentication,
sessions, and cron execution. If a problem also occurs in Hermes without this app,
include that reproduction and use the
[Hermes issue tracker](https://github.com/NousResearch/hermes-agent/issues).

For provider account access or billing, use the provider's support channel. This
project cannot change provider subscriptions, OAuth entitlements, or account limits.
