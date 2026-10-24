# Local release audit

The requested core is implemented in this checkout as **Hermes Teammates**, an
independent MIT-licensed desktop app. Hermes is the selected backend. The interface
uses original React/CSS/SVG assets inspired by the reference app’s roster, chat,
Bot details and Computer views. It does not require the proprietary Grok bundle.

| Requested outcome            | Implementation                                                                                  | Acceptance evidence                                                                                 |
| ---------------------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Separate persistent Bots     | Dedicated Hermes homes, role/model settings, native Bot Chat                                    | Store/API tests; real Hermes resumed-session and compiled UI workflows                              |
| Own memory and skills        | Native MEMORY.md, USER.md and per-profile SKILL.md editor                                       | Real native memory execution; persisted resources and UI editing                                    |
| Own files and credentials    | Per-profile workspace and API credentials; native encrypted website-login vault                 | Profile isolation tests; native vault restart/isolation tests; compiled private browser-fill flow   |
| Bots communicate visibly     | Native message_agent delivery plus shared group conversations                                   | Recipient transcript and provider ownership tests; two-Bot compiled group flow                      |
| Proactive behavior           | Native cron, Bot Chat delivery, live autonomous questions/steering, outcomes and unread state   | Actual due native routine and delivery; compiled unattended-question and unread acceptance          |
| Hermes runtime               | Persistent native gateway, tools, sessions, callbacks, native scheduler and formats             | Local native integration suite and packaged Electron execution                                      |
| Claude and compatible models | Per-Bot Anthropic or OpenAI-compatible Chat Completions, including configurable local endpoints | Both native inference protocols exercised against controlled transports                             |
| Reference-style desktop      | Original dark three-column UI, details, tools, approvals, live Computer, mobile navigation      | Actual compiled browser interaction and native Electron window                                      |
| Research and alternatives    | Source-backed feature map, differences, runtime choices and limits                              | [Feature audit](research.md), official product/Hermes documentation and supplied reference checkout |
| Redistributable source       | MIT license, third-party notices, original assets, build/test/CI definitions                    | Source tree and unpacked macOS ARM application; no proprietary reference files in package           |

Verification used the installed Hermes runtime with controlled inference, MCP and
password-manager fixtures. Real model credentials, provider OAuth entitlement,
third-party account sign-in and visual model quality were not tested. Per-Bot Apple
VM behavior was verified separately with actual VMs; that integration is an
explicit opt-in test and is skipped by the default suite.

The macOS ARM app is unsigned and not notarized. It needs the separately installed
Hermes runtime and configured model access. Source and package exist locally;
there is no published GitHub repository, release or remotely executed CI run.

The [feature map](research.md) records additional Grok capabilities outside this
first local release, including voice, rich media, event/webhook triggers,
service-specific draft composers, team/cross-device access and OS notifications.
Local routines require an awake backend. Native host tools share the current OS
user’s access; profile separation is not a hostile-agent security sandbox.
API keys retain native plaintext credential storage. The encrypted website vault
uses an adjacent owner-only key and targets the native Hermes browser, separately
from the Computer VM.

Run `npm run desktop` for the native window or `npm start` after `npm run build`
for the loopback web app. Setup and model choices are in the [README](../README.md).
Detailed checks, retained failures and account boundaries are in
[verification](verification.md).
