# Verification

Verified locally on 24 October 2026, on macOS Apple silicon. These checks establish the local runtime and interface behavior below; they do not establish full Grok Bot parity, live provider entitlement, a hosted service, or production security isolation.

## Results

| Check                              | Result                                  | What it proves                                                                                               |
| ---------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| TypeScript strict checking         | Passed                                  | Application, server, tests and acceptance script typecheck                                                   |
| Production build                   | Passed                                  | Vite client and bundled Node backend compile                                                                 |
| Store/API/native integration tests | 10 passed; VM test opts in separately   | Persistence, input boundaries, native agent execution and both inference protocols                           |
| Compiled browser acceptance        | Passed at 1440×1050 and 390×844         | Actual UI interactions and responsive rendering                                                              |
| Electron development shell         | Passed                                  | Native window loads the compiled backend and connects to Hermes                                              |
| Unpacked macOS application         | Passed                                  | Packaged asar backend/static assets, native Hermes detection and routine bridge work                         |
| Apple VM/native MCP integration    | Passed with explicit opt-in             | Separate VM homes, no provider environment, persistence, takeover fence, actual native MCP tools and restart |
| Computer browser and packaged UI   | Passed                                  | Live pixels, manual browser navigation, hand-back, sleep/wake, reload and narrow-screen layout               |
| Dependency audit                   | 0 known vulnerabilities at verification | npm's current advisory database for the locked dependency tree                                               |
| GitHub Actions                     | See hosted workflow runs                | Portable Ubuntu build/tests; native Hermes/browser/VM checks remain local                                    |

The public [Checks workflow](https://github.com/dafzthomas/hermes-teammates/actions/workflows/ci.yml) runs formatting, build, and default tests on Ubuntu with Node.js 24. A runner without Hermes skips native integration tests. Hosted green checks do not replace the local runtime acceptance below.

## Native Hermes test

`npm test` exercises the installed Hermes CLI with a local HTTP model fixture and disposable profiles. The fixture returns controlled tool calls and replies; Hermes itself executes the tools, maintains sessions, performs delivery and runs scheduled work.

Verified behavior:

- Native memory tool saves a fact in the primary profile.
- Native file tool writes an actual workspace file.
- A resumed query uses the same persistent Bot Chat session.
- Native `message_agent` dispatch reaches a specialist's transcript, with an attributed user message and a response from that specialist's own provider profile.
- The recipient does not inherit the sender's saved memory.
- Native cron jobs can be created, paused, resumed and removed.
- A due scheduled job executes, saves its native output, and delivers into canonical Bot Chat through Hermes' native owner.
- An autonomous scheduled delivery asks a real question through the persistent gateway while a user-started question remains open in another thread. It accepts steering and an answer, then retires its own turn while preserving the other thread's request. A second autonomous turn is stopped while waiting, clearing its card without discarding the gateway.
- Read cursors remain separate across Bots and threads, survive reopening and cannot acknowledge a message from another conversation. A late reply stays unread when the client acknowledges an older one. Group cursors never regress.
- Hidden and cron execution sessions do not appear as private conversations; the latest reply remains readable after more than 2,000 transcript messages.
- Hermes sends inference through OpenAI-compatible Chat Completions.
- Hermes also sends inference through native Anthropic Messages after selecting Claude access.
- One native gateway process and Bot Chat session are reused across successive turns.
- A native question pauses work; the supplied answer and queued steering reach the next model request. A batch also returns multiple independent answers, including multiple selected choices.
- Native skill setup requests a masked credential, saves it to the owning profile, and returns only setup status to the model. The synthetic value is absent from inference requests, app metadata and the visible transcript.
- Cross-Bot and mismatched-kind responses are rejected.
- A gated file deletion cannot run before a decision. Deny leaves the owned test directory intact; Allow once removes it.
- Stop withdraws a pending question, interrupts the native turn and permits a new turn in the same gateway without a stale completion race.

No live provider key or Claude login was used by these tests. All keys are synthetic. This does not verify Claude Code OAuth reuse, real OpenAI/Anthropic account billing, Ollama model quality, or external app integrations.

## UI acceptance

After installing Playwright Chromium (`npx playwright install chromium`), run:

```sh
npm run verify:ui
```

The script starts the compiled backend and a controlled model endpoint. It interacts with the real rendered interface to create/edit a Bot, add a masked credential, save memory and a skill, upload a text file, create/pause/resume a native routine, send a real Hermes turn, reload history, restore a pending question after window reload, submit steering and an answer, deny an approval, stop a waiting question, recover a pending legacy question in the main Bot chat, create a group and receive two profile responses. It also schedules an actual due Hermes job while another Bot is selected, opens its native question, answers, switches to Computer and verifies the completed reply stays unread. Reload preserves the badge; opening Chat clears it. Canonical private history and two-member group replies receive independent badges, including group state after reload. It checks narrow-screen navigation and absence of horizontal overflow, then launches the Electron shell. On Mac it asserts the native control presentation handshake. Set `TEAMMATES_NATIVE_INTERACTIVE=1` to wait for actual AppKit input and then answer another real native question. Browser and native input evidence are recorded separately. Temporary data and owned servers are removed afterward. Screenshots are written to ignored `test-artifacts/`.

The expanded conversation check exposed a pending user-message bubble carried from
an interrupted turn into a new empty thread. Conversation switching now clears
that pending display. The new-thread acceptance remains in the compiled flow.
The first expanded fixture also failed to detect a JSON-escaped cron header;
its marker match was corrected before the native question test passed.

The README screenshot shows this compiled interface with controlled fixture content, not a live-provider response or a separate mockup.

T3 collaborative preview was attempted first. Two snapshots on the opened app tab failed with `Preview snapshot failed: Preview automation snapshot timed out after 15000ms.` The available computer-use browser was also unavailable, so standalone Playwright was used for the compiled UI check. A further attempt during interactive-runtime verification also failed twice with `Preview automation navigate timed out after 15000ms.` and `Preview automation navigate timed out after 20000ms.` These failed previews did not count as UI verification.

The packaged application was additionally launched directly from `release/mac-arm64/Hermes Teammates.app`, with a disposable data root. The acceptance script can select it through `TEAMMATES_PACKAGED_EXECUTABLE`; it stops the browser backend before starting Electron so two backends do not own the same data. A native window connects to Hermes, resumes a stored conversation, executes a real native question tool and accepts the answer. This package is unsigned and not notarized. Windows/Linux builds and installation on another machine were not tested.

## Computer acceptance

Install Apple container and start its system service before these explicit tests:

```sh
TEAMMATES_TEST_COMPUTERS=1 npx tsx --test test/computers.integration.test.ts
npm run verify:computer
```

The VM integration uses actual Apple VMs, a local model fixture and the native
Hermes MCP client. It verifies unprivileged commands, absence of provider-variable
names in the guest, separate homes for two Bots, PNG capture, the manual-control
fence, invalid capability rejection, file persistence across sleep and backend
restart, native tool discovery, keyboard navigation to an actual local HTML page,
and an MCP screenshot cached by Hermes as a valid PNG. Hermes returns MCP images
through its `MEDIA:path` convention. Visual reasoning through `vision_analyze`
requires a configured vision model and was not tested with a live provider.

The compiled UI test connects through noVNC, takes control, types a file URL into
the actual guest browser, checks its resulting window title inside the VM, hands
back, sleeps/wakes the computer and reloads the app. It checks 390px layout and
page errors. `TEAMMATES_PACKAGED_EXECUTABLE` selects the unpacked macOS executable;
the same live-computer flow passed from its asar package. Tests delete only their
own VMs, named volumes and disposable data roots.

The first screen check found that TCP connect success did not establish a usable
screen: localhost published ports accepted then reset HTTP/WebSocket traffic in
this environment. The proxy now uses the VM’s private network. Readiness requires
an actual visible Chromium window and an HTTP response from websockify, avoiding
the initial black screenshot. Remote keyboard acceptance waits for the guest
address bar to focus before typing; typing immediately after the shortcut caused
intermittent lost initial characters in automation.

## Runtime compatibility and installation findings

- Installed/tested Hermes: `v0.21.5+3904.g188a1a5`, upstream `188a1a5e`, Python 3.14.7.
- Current upstream source inspected separately: `5894e750c3dba980d43b25aa29e3958149ba2c61`. Upstream research is not a claim that this installed version has every latest feature.
- Reference unGrokBot inspected at `322711285429483a23ac5a00375ebcb677f8c98e`.
- Apple container 1.6.0 on macOS 27.0; Debian trixie desktop, Xvfb, Chromium and noVNC 1.7.0.
- Electron 45.0.0, Node.js 24.18.0 for development checks; the Electron backend uses Electron's bundled Node runtime.

Starting a managed Hermes launcher under a completely fresh HERMES_HOME initially caused it to prepare another dependency environment and republish its shared launcher. The original installation's launcher was restored using Hermes' own launcher publisher. The adapter now disables lazy installs, shares the existing installed dependency generations, and resolves the installed venv interpreter. Using that interpreter also fixes a missing-module failure in native Bot-message delivery workers.

The existing runtime lacked the optional native Anthropic SDK. It was installed through the supported `hermes pm install --extra anthropic` command. The app itself never silently installs provider dependencies during a turn.

The first desktop launch inherited `ELECTRON_RUN_AS_NODE=1` from this agent environment. The development launcher now clears that variable before starting Electron. The backend intentionally sets it only for the child Node server.

## Unverified or absent

Live paid providers and OAuth reuse; rich/binary attachments; service-specific send-draft composers, native credential/sudo prompt execution with a real external service, vault login prompts; webhook triggers; voice; always-on service operation; crash recovery of active runs; multi-user/team access; whole-agent OS isolation; signed distribution and automatic updates. See [the feature audit](research.md) for the planned sequence.

## App connection acceptance

Run `npx tsx --test test/connections.integration.test.ts` for actual installed
Hermes MCP and policy-hook execution with local model and app fixtures. It proves
that the app receives edited recipient/text values only after approval, Deny and
Stop cause no further execution, expired reviews cannot later approve, and the
HTTP transport receives its owning Bot's selected bearer credential. The stdio
fixture checks a hash of its bound key and absence of the model-provider variable;
no real credentials or third-party delivery are used. It also checks wrong-Bot
response rejection, invalid capability rejection, explicit native timeout retention,
and preservation of unrelated MCP, hook and consent entries after disconnect. A malformed native consent file causes the connection change to fail and restores the previous metadata, config and descriptor state.

Run `npm run verify:connections` for the compiled connection form and editable
review card. The Playwright workflow adds a command connection, waits for a real
Hermes MCP action, reloads while waiting, exercises malformed JSON feedback, edits
the actual action, and checks the app fixture received the reviewed parameters.
It checks 390px overflow and page errors. With `TEAMMATES_PACKAGED_EXECUTABLE`
pointing to the unpacked macOS executable, it also stops the browser backend,
launches the package with the same disposable data, and executes another reviewed
MCP action through the packaged Python hook. Screenshots are retained in ignored
`test-artifacts/app-connections.png` and `app-action-review.png`.

Early tests found an unregistered TUI hook and a prefix matcher where Hermes
requires full matching; those first calls bypassed review. After registration was
fixed, the test found different durable and live conversation IDs, then a mistaken
resume RPC for a live ID. The final adapter uses Hermes' native active-session list.
Those failed executions were confined to disposable local fixtures. The compiled
UI script initially expected an empty composer Send button to be enabled; the
acceptance now waits for the completed reply, consistent with the existing UI.
The first packaged acceptance reused a conversation containing the earlier fixture marker, so its deterministic model did not request another tool. The fixture now selects the latest marker, and the packaged flow passed. Live third-party services, OAuth flows and a real external message remain unverified.

## Native website-vault acceptance

```sh
npx tsx --test test/vault.integration.test.ts
npm run verify:vault
```

The storage integration exercises real Hermes `vault.*` handlers in two disposable
profiles. It checks origin normalization, metadata-only responses, encrypted
password/TOTP persistence, 0600 vault/key modes, restart persistence, cross-profile
list/remove isolation, source-toggle isolation, invalid-origin/OTP rejection and
removal. An invalid URL regression caught a thrown URL parser exception in the API validator; malformed URLs now return HTTP 400. Native invalid-OTP errors currently surface as HTTP 500; their text is
scrubbed and the value is not stored.

The compiled UI workflow adds/removes a saved login through real forms and
restores it after reload. It drives real native browser tools against an owned
Chromium CDP session and controlled local login page. Masked login and code cards
fill actual DOM controls; manager unlock traverses the native Bitwarden adapter
through a controlled CLI executable. The CLI checks that the master password
arrives through its dedicated environment variable, never argv, and that the
model provider key is absent. Native source status changes to unlocked, then
locks. The workflow also checks pending-card reload, mismatched response rejection,
Skip, Stop, absence of raw secrets in inference/app metadata/visible transcripts,
page errors and 390px overflow. Screenshots are retained under ignored
`test-artifacts/`. Set `TEAMMATES_PACKAGED_EXECUTABLE` to repeat a real private login
fill from the unpacked Electron app after stopping the browser backend.

This proves native Hermes storage, tool execution and the app’s private-response
path. Model inference and the manager CLI are controlled fixtures. Real website
sign-in, 1Password/Bitwarden accounts, provider keys/OAuth, automatic TOTP fill and
payment/address fills are not verified by this workflow. The native browser and
the per-Bot Computer VM remain separate. The vault key is stored beside the
ciphertext; these checks do not prove OS Keychain or hostile same-user isolation.

The compiled vault flow and actual private login fill also passed from the rebuilt macOS ARM Electron package. Fixture-owned native browser daemons are identified by their temporary working directory and stopped during cleanup.

## Mobile follow-up

Authenticated mobile access and the iOS/Android clients are documented and verified
separately in [mobile verification](mobile-verification.md). The historical desktop
results above do not substitute for device or remote-network acceptance.

## Consumer chat and native controls follow-up — 25 October 2026

The consumer interface now has one canonical private chat per Bot. Groups remain
separate. Completed tool records use shared compact disclosures in both clients;
questions, approvals, failures, and current activity retain their own presentation.
Routine results ask once about that routine's future updates. Never changes delivery
targets while retaining the enabled schedule. Bespoke criteria prepare an editable
message for the Bot rather than claiming an unsupported scheduler filter.

The focused store and parser regressions cover timestamp/ID canonical read cursors,
legacy cursor migration, group isolation, native failure envelopes, ordinary Error
headings, and persistent per-routine preferences. The native resolver fixture checks
all/error/never result and failure targets with real installed Hermes APIs in
temporary homes. These checks do not establish live provider inference or an actual
scheduled run under every preference.

Mac controls use in-process AppKit views and NSGlassEffectView on supported systems;
iOS uses UIKit views inside UIGlassEffect. Both retain opaque native fallbacks for
older systems and Reduce Transparency. The web transcript and settings remain React.
The browser and Android/Windows/Linux controls retain their platform styling.

Interactive acceptance on macOS verified the web conversation alongside native AX
navigation and composer controls, native typing and Shift-Return, Return submission
and a completed Hermes reply, full Researcher title rendering, modal hide/restore,
and explicit contextual routine focus without losing an existing draft. CUA returned
AXError.failure for some native button presses even though the next observed tree
showed the intended action had occurred. Those tool errors were not counted as
failed actions or retried blindly. The earlier content-view wrapper exposed AX but
blanked Chromium rendering; it was removed before this simultaneous rendering/AX
check.

The iPhone simulator acceptance used the authenticated fixture host and native secure
storage. It verified native typing, submission, Stop, native controls after fresh
launch, and the contextual routine action focusing the actual UITextView with its
prepared draft. Keyboard/composer screenshots were inspected. The device tool
reported a text-entry mismatch once despite identical expected and observed strings;
the subsequent native snapshot and submitted request confirmed the entered text.

The full compiled mobile browser journey passed pairing, Bot creation, questions,
steering, approvals, delayed-refresh Stop, response ordering, memory, routine
preference persistence, legacy requests, proactive routine questions, group replies,
revocation, page-error checks, and narrow layout. This browser lane uses a transport
fixture and does not prove UIKit. An initial cleanup error masked a 409 caused by
the journey starting a legacy request before its previous turn completed. The
verifier now records the original failure, waits for backend idleness, and retries
busy-directory cleanup. The corrected journey passed.

Native Mac builds cover arm64, x86_64, and a universal module. iOS simulator builds
cover arm64 and x86_64. The nine CJS bridge security/lifecycle tests run in the default npm test
gate. Apple compiler regressions run separately with
`node electron/test-native-lifecycle.cjs`. Signed distribution, physical iOS devices, older Apple OS fallbacks, native
IME composition, and real paid providers remain separate unverified boundaries.

The full compiled desktop journey passed the canonical-chat, routine-preference,
legacy-request, resource, question/approval, Stop, group, proactive-delivery, unread,
and responsive-layout checks. The connections and vault browser journeys also
passed. Connections initially filled an inert background composer before its save
dialog closed; the corrected journey waits for dialog dismissal before typing.

The unpacked ARM Mac package was built and launched with an isolated copy of the
disposable fixture. Its packaged native module loaded, exposed both web and native
AX content, accepted native Return submission, and completed a real Hermes question
and answer. Window zoom retained the native controls and web conversation. Killing
only that package's renderer removed native navigation and composer controls from
the screen and AX tree. The last lifecycle patches passed independent source review
and focused production-method native regressions. An actual accessibility-setting
change after renderer loss and a WebKit process-termination race were not driven;
the regression tests establish those state transitions separately. Fresh launch
and native presentation on the rebuilt iPhone simulator binary passed after the
pre-Capacitor generation-capture repair.

The final iPhone build also accepted native typing and Send after the queue-fence
patch, and its completed response appeared in the main Bot chat.

The final sidebar places New Bot beside the Teammates heading, with Search and the
workspace avatar at the bottom. The selected Bot has no left stripe. A compiled
1280×800 browser check confirmed that the New Bot and Search controls share the Bot
rows' right edge. The 390×650 layout was also inspected and measured.

Before PR delivery, formatting, desktop and mobile builds, the default test suite,
the explicit composer-focus browser regression, and the Apple lifecycle compiler
regressions passed again. The default suite passed 29 TypeScript tests and nine CJS
bridge tests; its Apple VM integration test remains opt-in and was skipped. The three
native routine resolver tests also passed with Hermes' Python environment and
`HERMES_SOURCE` set to its installed source directory. System Python alone lacks
Hermes' `cron` module and cannot run that fixture.
