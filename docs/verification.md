# Verification

Verified locally on 24 October 2026, on macOS Apple silicon. These checks establish the local runtime and interface behavior below; they do not establish full Grok Bot parity, live provider entitlement, a hosted service, or production security isolation.

## Results

| Check                              | Result                                  | What it proves                                                                       |
| ---------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------ |
| TypeScript strict checking         | Passed                                  | Application, server, tests and acceptance script typecheck                           |
| Production build                   | Passed                                  | Vite client and bundled Node backend compile                                         |
| Store/API/native integration tests | 5 passed, no skips on this machine      | Persistence, input boundaries, native agent execution and both inference protocols   |
| Compiled browser acceptance        | Passed at 1440×1050 and 390×844         | Actual UI interactions and responsive rendering                                      |
| Electron development shell         | Passed                                  | Native window loads the compiled backend and connects to Hermes                      |
| Unpacked macOS application         | Passed                                  | Packaged asar backend/static assets, native Hermes detection and routine bridge work |
| Dependency audit                   | 0 known vulnerabilities at verification | npm's current advisory database for the locked dependency tree                       |
| GitHub Actions                     | Workflow supplied; not run remotely     | CI definition only; no repository has been published                                 |

## Native Hermes test

`npm test` exercises the installed Hermes CLI with a local HTTP model fixture and disposable profiles. The fixture returns controlled tool calls and replies; Hermes itself executes the tools, maintains sessions, performs delivery and runs scheduled work.

Verified behavior:

- Native memory tool saves a fact in the primary profile.
- Native file tool writes an actual workspace file.
- A resumed query uses the same persistent Bot Chat session.
- Native `message_agent` dispatch reaches a specialist's transcript, with an attributed user message and a response from that specialist's own provider profile.
- The recipient does not inherit the sender's saved memory.
- Native cron jobs can be created, paused, resumed and removed.
- A due scheduled job actually executes and writes a result readable by the app.
- Hermes sends inference through OpenAI-compatible Chat Completions.
- Hermes also sends inference through native Anthropic Messages after selecting Claude access.

No live provider key or Claude login was used by these tests. All keys are synthetic. This does not verify Claude Code OAuth reuse, real OpenAI/Anthropic account billing, Ollama model quality, or external app integrations.

## UI acceptance

After installing Playwright Chromium (`npx playwright install chromium`), run:

```sh
npm run verify:ui
```

The script starts the compiled backend and a controlled model endpoint. It interacts with the real rendered interface to create/edit a Bot, add a masked credential, save memory and a skill, upload a text file, create/pause/resume a native routine, send a real Hermes turn, reload history, open a separate thread, create a group and receive two profile responses. It checks narrow-screen navigation and absence of horizontal overflow, then launches the Electron shell. Temporary data and owned servers are removed afterward. Screenshots are written to ignored `test-artifacts/`.

The README screenshot shows this compiled interface with controlled fixture content, not a live-provider response or a separate mockup.

T3 collaborative preview was attempted first. Two snapshots on the opened app tab failed with `Preview snapshot failed: Preview automation snapshot timed out after 15000ms.` The available computer-use browser was also unavailable, so standalone Playwright was used for the compiled UI check. The failed preview did not count as UI verification.

The packaged application was additionally launched directly from `release/mac-arm64/Hermes Teammates.app`, with a disposable data root. A native window connected to Hermes, loaded the empty Bot conversation and opened routine creation. This package is unsigned and not notarized. Windows/Linux builds and installation on another machine were not tested.

## Runtime compatibility and installation findings

- Installed/tested Hermes: `v0.21.5+3904.g188a1a5`, upstream `188a1a5e`, Python 3.14.7.
- Current upstream source inspected separately: `5894e750c3dba980d43b25aa29e3958149ba2c61`. Upstream research is not a claim that this installed version has every latest feature.
- Reference unGrokBot inspected at `322711285429483a23ac5a00375ebcb677f8c98e`.
- Electron 45.0.0, Node.js 24.18.0 for development checks; the Electron backend uses Electron's bundled Node runtime.

Starting a managed Hermes launcher under a completely fresh HERMES_HOME initially caused it to prepare another dependency environment and republish its shared launcher. The original installation's launcher was restored using Hermes' own launcher publisher. The adapter now disables lazy installs, shares the existing installed dependency generations, and resolves the installed venv interpreter. Using that interpreter also fixes a missing-module failure in native Bot-message delivery workers.

The existing runtime lacked the optional native Anthropic SDK. It was installed through the supported `hermes pm install --extra anthropic` command. The app itself never silently installs provider dependencies during a turn.

The first desktop launch inherited `ELECTRON_RUN_AS_NODE=1` from this agent environment. The development launcher now clears that variable before starting Electron. The backend intentionally sets it only for the child Node server.

## Unverified or absent

Live paid providers and OAuth reuse; rich/binary attachments; computer/browser-control panel; interactive approvals, secret handoff and send-draft controls; webhook triggers; voice; remote authentication and always-on service operation; crash recovery of active runs; multi-user/team access; OS-level isolation; signed distribution and automatic updates. See [the feature audit](research.md) for the planned sequence.
