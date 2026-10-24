# Contribute to Hermes Teammates

Thanks for helping improve Hermes Teammates. Start with an issue for a new feature,
a public API change, or a change to stored data. Small fixes and documentation
improvements can go straight to a pull request.

## Set up a checkout

You need Node.js 24 or later and npm. Agent integration checks also need a working
Hermes installation. Prepare Hermes separately using its
[installation guide](https://hermes-agent.nousresearch.com/docs/getting-started/installation).

```sh
git clone https://github.com/dafzthomas/hermes-teammates.git
cd hermes-teammates
npm ci
npm run dev
```

Open <http://127.0.0.1:4310>. To run the native Electron window, use
`npm run desktop`. Follow the [README](README.md) to configure model access.

Use a disposable data directory for development:

```sh
TEAMMATES_DATA_DIR="$PWD/.local-data" npm run dev
```

That directory is ignored by Git. Do not use production credentials or a personal
Hermes profile as test data. The app's host tools run with your OS user's access.

## Understand the boundaries

Read the [architecture](docs/architecture.md) before changing runtime behavior.
Hermes owns inference, tool execution, native sessions, memory, skills, and cron.
Keep those native formats authoritative. React and the loopback backend present
and coordinate that behavior.

The source is organized as follows:

- `src/` contains the React interface and shared validation schemas.
- `server/` contains the loopback API, native gateway adapters, app connections,
  and computer lifecycle code.
- `electron/` contains the desktop shell.
- `mobile/` contains the phone UI and committed Capacitor iOS/Android projects.
- `server/mobile.ts` contains device pairing and the separate authenticated gateway.
- `test/` contains automated checks and controlled integration fixtures.
- `scripts/` contains desktop launch and compiled interface acceptance workflows.
- `docs/` contains research, design boundaries, and verification evidence.

Preserve unrelated native configuration when updating a profile. Changes to
credential handling, approvals, profile isolation, or computer takeover need
behavioral verification at that boundary. Never add proprietary Grok application
files, extracted interface assets, model credentials, or private transcripts.

## Check a change

Run the following checks before opening a pull request:

```sh
npm run format:check
npm run build
npm test
```

`npm run build` includes strict TypeScript checking. Use `npm run format` to apply
the repository's formatting rules. GitHub Actions runs formatting, build, and
default tests on Ubuntu with Node.js 24.

Without Hermes, native integration tests skip. A green default CI run therefore
does not prove native agent execution. If a change affects the native runtime,
install Hermes and run the relevant integration test locally. The fixtures use
synthetic credentials and controlled model endpoints, without paid provider calls.

For interface changes, install Playwright Chromium and exercise the appropriate
compiled workflow:

```sh
npx playwright install chromium
npm run verify:ui
npm run verify:connections
npm run verify:vault
```

Run the workflows that cover the changed behavior. Vault acceptance also needs
Hermes' native browser prerequisites. Computer acceptance needs Apple silicon,
macOS 26 or later, Apple container, and the Hermes MCP SDK:

```sh
TEAMMATES_TEST_COMPUTERS=1 npx tsx --test test/computers.integration.test.ts
npm run verify:computer
```

See [verification](docs/verification.md) for exact prerequisites, packaged-app
checks, fixture boundaries, and retained failure evidence. Report what you ran and
what you could not verify. A fixture does not prove a real third-party account.

## Mobile changes

Read [mobile setup](docs/mobile.md) and [mobile verification](docs/mobile-verification.md). Run `npm run build:mobile` and the gateway tests alongside the default checks. Use `npm run mobile:sync` after UI/plugin changes. Keep native generated web assets and build outputs out of Git. Exercise a native build on both iOS and Android when changing transport, secure storage, keyboard or lifecycle behavior. Separate browser transport fixtures from actual device proof. Do not commit pairing codes, device tokens, TLS keys, signing material or runtime transcripts.

## Open a pull request

1. Create a branch from `main`.
2. Keep the change focused on one problem.
3. Update the docs when behavior, setup, or limitations change.
4. Explain the problem, resulting behavior, and relevant checks in the pull request.
5. Remove private data from logs, screenshots, and attachments.

For a bug fix, include a reproduction and a regression check when it protects
meaningful behavior. Screenshots help reviewers assess interface changes.
Maintainers review contributions before merging. This early project has no
promised review or release schedule.

Contributions use the [MIT license](LICENSE). Keep third-party notices with any
adapted source and describe new dependencies. See the
[code of conduct](CODE_OF_CONDUCT.md) for community expectations and the
[security policy](SECURITY.md) for private vulnerability reports.
