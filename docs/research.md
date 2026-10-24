# Grok Bot feature audit and runtime choice

Researched 24 October 2026 against official product documentation, the supplied unGrokBot repository, and Hermes source. Product docs can move independently of installed releases. Claims about our app below describe this checkout, not parity with every upstream feature.

## Recommendation

Use **Hermes as the agent runtime**, as requested, and keep the Grok-inspired interface as a replaceable client. Hermes already has a desktop Bot Mode covering named profiles, memory, skills, routines, group discussion and teammate messages. The quickest existing solution is therefore Hermes Desktop itself. Building here is justified by the requested visual experience and control over the interaction model, not by missing core agent primitives. [Hermes Bot Mode](https://hermes-agent.nousresearch.com/docs/user-guide/bot-mode)

One important difference in the reference product: Grok's Bots keep separate conversations and memory, but share the user's cloud filesystem, browser sessions and command-line logins. Skills are also available across Bots. Your request calls for separate Bot files, skills and credentials, so this implementation gives each a dedicated Hermes profile and workspace. That is organizational separation; tools running as one OS user can still cross those paths. [Computer model](https://docs.x.ai/grok-bot/computer-and-apps), [skills](https://docs.x.ai/grok-bot/skills-routines-and-automations)

## Feature map

| Surface            | Grok Bot behavior                                             | This release                                                                                                          |
| ------------------ | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Bot identity       | Durable name, role, working context and boundaries            | Create/edit Bot role, color and model; original avatar artwork                                                        |
| Desktop layout     | Bot roster, messaging transcript, contextual details          | Original dark three-column UI with collapsible details and narrow-screen navigation                                   |
| Persistent chat    | Ongoing relationship with each Bot                            | Hermes native Bot Chat stored in each profile's SQLite database                                                       |
| Threads            | Replies and focused conversations                             | Separate named conversations using the same Bot resources; no nested message replies                                  |
| Memory             | Lasting preferences and role context                          | Native MEMORY.md and USER.md, editable and readable by Hermes                                                         |
| Skills             | Reusable workflows learned from work                          | Private per-profile SKILL.md files; editor plus native Hermes skill tools                                             |
| Files              | Rich document/media inputs and generated results              | Text/source upload and download, private workspace, native file tools; no rich media viewer                           |
| Credentials        | App connections, login and secret handoff                     | Per-profile credential names/add/remove; native .env storage; optional shared Claude login                            |
| Model access       | Product-managed inference                                     | Per-Bot Claude/Anthropic or OpenAI-compatible endpoint, including Ollama                                              |
| Tool activity      | Tools and result cards in the transcript                      | Native tool results and activity timeline; live screen in the Computer tab                                            |
| Direct handoff     | Asynchronous Bot-to-Bot delivery and later replies            | Native Hermes message_agent in canonical Bot Chat; recipient owns its transcript                                      |
| Group discussion   | Multiple Bots with visible ownership/handoffs                 | Shared transcript, sequential member turns, separate profile contexts; no @mention router                             |
| Concurrent work    | Multiple Bots work at once                                    | Separate Bots can overlap; native autonomous turns in another session are tracked alongside app-started work          |
| Redirect/stop      | New instructions can steer active work; Stop ends work        | Native Stop plus steering into the next tool result; persistent per-profile gateway                                   |
| Proactive routines | Time or supported event triggers                              | Native Hermes cron, 30-second ticks, Bot Chat delivery with live interactions, durable unread state and saved results |
| Always-on work     | Cloud work continues when laptop closes                       | Local by default; requires an awake backend host                                                                      |
| Computer and apps  | Persistent browser/desktop, tool connections, manual takeover | Per-Bot Apple VM with Chromium, persistent home, live screen and manual takeover; no app-connection manager           |
| Approvals          | Review operation and inputs, allow/deny, editable send drafts | Native Allow/Deny cards, single/batch question forms and private credential/sudo input; no editable send drafts       |
| Voice              | Dictation, live voice and voice memos                         | Not implemented                                                                                                       |
| Search             | Bots, prior messages, files, links, routines                  | Roster search with Cmd/Ctrl+K                                                                                         |
| Notifications      | App and per-conversation notification controls                | Durable unread Bot/thread/group badges, reply previews and live run state; no OS push controls                        |
| Sharing            | Team Bots, account scope, cross-device access                 | Single-user local workspace only                                                                                      |
| X entry point      | Start tasks by tagging @bot                                   | Not implemented                                                                                                       |

Sources by surface: [Bot lifecycle](https://docs.x.ai/grok-bot/bots), [chat/collaboration](https://docs.x.ai/grok-bot/chat-and-collaboration), [files/results](https://docs.x.ai/grok-bot/files-and-results), [skills/routines](https://docs.x.ai/grok-bot/skills-routines-and-automations), [approvals/privacy](https://docs.x.ai/grok-bot/approvals-security-and-privacy), [settings](https://docs.x.ai/grok-bot/settings-and-notifications), [overall execution model](https://docs.x.ai/grok-bot/overview).

## What unGrokBot supplies

The supplied repository at commit `322711285429483a23ac5a00375ebcb677f8c98e` contains MIT-licensed patches, a Claude runtime and supporting material. It requires a user-supplied Grok Bot 0.71.2 desktop bundle. Its existing look comes from that proprietary bundle; publishing those extracted UI assets would not produce an independently redistributable application.

Its runtime demonstrates per-Bot Apple containers, native UI tools for memories/skills/secrets, thread and group messaging, scheduled/webhook work, and optional T3 cloud agents. The implementation here uses those interactions as reference while authoring its own React/CSS/SVG interface and connecting to Hermes. It does not redistribute or depend on the original DMG. [unGrokBot repository](https://github.com/dafzthomas/unGrokBot)

## What can be done elsewhere

| Option                      | Reuse                                                                                                                 | Tradeoff                                                                                                           |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **Hermes Desktop Bot Mode** | Closest existing open source option: persistent profiles, skills/memory, model choices, groups, handoffs and routines | Different interface; features vary with installed Hermes release. Best option if a custom interface is unnecessary |
| **OpenClaw**                | Multi-agent routing with separate workspaces/auth and scheduled jobs                                                  | Good service/channel-oriented foundation; changing runtime would add migration work after your Hermes choice       |
| **Agent Zero**              | Agent tools, persistent memory, container-oriented operation and task scheduling                                      | Different agent hierarchy and work UI; more work to reproduce a named teammate roster                              |
| **unGrokBot**               | Closest reference-app appearance with a Claude-backed replacement runtime                                             | Requires the proprietary app bundle and Apple container setup; not the independent OSS UI requested                |

Primary references: [Hermes](https://hermes-agent.nousresearch.com/docs/user-guide/bot-mode), [OpenClaw multi-agent routing](https://docs.openclaw.ai/concepts/multi-agent), [OpenClaw automation](https://docs.openclaw.ai/automation/cron-jobs), [Agent Zero repository](https://github.com/agent0ai/agent-zero).

## Model-access decision

The user chose both Claude access and OpenAI-compatible models. The first implementation uses Hermes' native `anthropic` provider for Claude, with an explicit option to adopt an existing Claude Code login, and `custom` with Chat Completions for compatible APIs. This avoids maintaining a second Claude Agent SDK executor. Native Hermes supports more providers than this UI exposes.

Current Hermes documentation says Claude Max OAuth needs extra usage credits, and lists API-key authentication as an alternative. Subscription entitlement and external-account reuse are provider-controlled and were not tested with a live account. Local Ollama still needs a running server and a suitable tool-calling model. [Hermes provider documentation](https://hermes-agent.nousresearch.com/docs/integrations/providers)

## Next development priorities

1. Extend editable send-draft controls. Native routine outcomes, autonomous live turns, questions/approvals, steering and durable unread Bot/thread/group state are implemented.
2. Extend the managed computer with explicit file transfer and browser-login controls. The VM isolates guest files; Hermes host tools remain outside it.
3. Use an encrypted OS credential store or native external-vault references, including private login/secret handoff controls.
4. Add authenticated always-on backend operation, durable restart recovery and notifications. Add signed webhook triggers only with an explicit sender and trust boundary.
5. Extend group ownership/routing, message replies, rich file artifacts, voice and cross-device/team access.

The first release deliberately stores memory, skills, transcripts and routines in native Hermes formats so those improvements do not require a second memory or scheduler system.

## Computer implementation findings

The supplied unGrokBot implementation keeps inference on the Mac and gives each
Bot an Apple container desktop. This app follows that arrangement with an
MIT-derived Debian/Xvfb/Openbox/Chromium image, a noVNC screen client, and
profile-bound MCP tools. The native Hermes process owns the model and MCP
connection; the app owns VM lifecycle and takeover state. Its tool service refuses
new computer actions while the user has control.

The installed Hermes version’s screen runtime is Linux-only. Newer Hermes
[Bot Screen documentation](https://hermes-agent.nousresearch.com/docs/user-guide/features/bot-screen)
describes additional placement options; those docs do not establish support in
our installed release. A small MCP adapter avoids replacing Hermes inference or
requiring its host desktop tool to control the user’s Mac.

[Apple container](https://github.com/apple/container) supplies the VM runtime.
The screen proxy uses the VM’s private network address; localhost port publishing
accepted connections but reset HTTP/WebSocket traffic on this macOS 27 check.
The UI talks only to the loopback backend. The guest’s VNC endpoint requires its
own random screen password. MCP v2 renamed FastMCP to MCPServer, so the adapter
supports the installed v2 interface with a v1 import fallback, following the
[official Python SDK](https://github.com/modelcontextprotocol/python-sdk).
