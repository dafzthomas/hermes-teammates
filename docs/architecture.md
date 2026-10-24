# Architecture and boundaries

## Ownership

React renders the roster, transcript and details. The loopback Express server validates requests, owns app metadata and starts Hermes child processes. Electron is a sandboxed desktop shell around that same backend. Hermes owns inference, tools, sessions, memories, learned skills, teammate delivery and cron jobs.

```text
React / Electron
        │ same-origin HTTP + server-sent change notifications
Loopback server
        ├── teammates.json: Bot roster, groups, activity, group display transcript, read cursors, app connections
        ├── Apple container manager: per-Bot VM, named home volume, private screen proxy
        └── Hermes gateway: one persistent stdio process per active Bot profile
                 ├── profile configuration and credential file
                 ├── native SQLite sessions (app reads, never rewrites)
                 ├── MEMORY.md / USER.md / skills / workspace
                 ├── native message_agent delivery to another profile
                 ├── profile-bound MCP → app computer tools → that Bot’s VM
                 └── native cron jobs + scheduler + saved outputs
```

## Data layout

```text
TEAMMATES_DATA_DIR/
  teammates.json
  hermes/                         # primary Bot's HERMES_HOME
    config.yaml / profile.yaml / SOUL.md / .env
    state.db
    workspace/ / memories/ / skills/ / cron/
    installs -> existing Hermes dependency generations
    profiles/bot-<id>/            # each specialist's HERMES_HOME
      config.yaml / profile.yaml / SOUL.md / .env
      state.db
      workspace/ / memories/ / skills/ / cron/
```

Only installed dependency generations are linked to the existing Hermes installation. The app does not copy API keys, memory, skills or history from the user's default Hermes profile. Model login reuse is opt-in. Hermes can also fill unset variables from a `.env` in its source checkout or apply managed credentials; use a clean runtime installation if those shared sources should be unavailable. Hermes native global/bundled capabilities and external OS resources may still be available; the profile folders are not an operating-system sandbox.

## Runtime protocol

The adapter resolves the installed Hermes Python environment and launches its native `tui_gateway.entry` through a small bootstrap. Each Bot has a separate persistent process and private stdio JSON-RPC channel. There is no gateway HTTP/WebSocket port exposed to the browser. Hermes owns session creation/resumption, inference, tool execution and persistence; the app validates and presents native events.

`session.create` / `session.resume` selects a conversation, `prompt.submit` starts a turn, and `message.delta`, `tool.start`, `tool.complete` and `message.complete` drive the interface. A turn settles only on a terminal event or failure, not on the initial submit acknowledgement. A native gateway stays alive across turns. Settings, memory, skill and credential edits invalidate an idle gateway so its next turn loads the new resources.

The client advertises native server-request support. Hermes sends `clarify`, `approval`, `secret`, `sudo`, `vault.save_login`, `vault.unlock_prompt` or `vault.code` requests; the app keeps their IDs and validated public fields in memory and renders a matching card. Responses must belong to that Bot and match the request kind. Approval scopes must come from Hermes' offered choices. Native cancellation/timeout or Stop clears the card. Unsupported interaction types receive an explicit JSON-RPC error rather than a fabricated answer. Secret responses go directly to the private runtime channel and are not copied into app metadata or activity.

`session.steer` queues instructions for the next tool result and reports rejection if the turn can no longer accept them. `session.interrupt` stops the current turn. The app waits for its terminal event before admitting a replacement turn, avoiding a late interrupted completion settling the new turn. A five-second interruption deadline closes an unresponsive gateway. A 15-minute timeout requests Stop for both app-started and autonomous turns. Native `message.start` events adopt known conversation sessions, so routine delivery and incoming Bot work can stream, ask questions and request approval through the same interface. Autonomous sessions are tracked separately from a user-started turn in another conversation. Shutdown terminates all owned gateway/scheduler children and waits for their exits; no completed side effects are undone.

The child environment passes a small OS-variable allowlist, sets the correct HERMES_HOME, and excludes ambient provider keys. Credentials are loaded by Hermes from that profile. `HERMES_DISABLE_LAZY_INSTALLS=1` prevents bot startup from initiating source-update dependency installation or launcher publication. Managed installations reuse existing dependencies; custom installations can override executable, source, Python, tool store and dependency paths.

The Python bridge imports Hermes' installed cron library and exposes JSON-only create/list/pause/resume/remove operations. It keeps native cron jobs authoritative. The app invokes `hermes cron tick` every 30 seconds, with one tracked tick per profile; Hermes owns job locking and due-run behavior. New jobs use Hermes native `deliver="bot-chat"`, including its durable delivery receipts, owner routing and offline fallback. The app does not enqueue a second copy or replay deliveries. Native routine context appears as an attributed card, and the Bot's follow-up reply stays in its canonical transcript. Original run results remain readable from native cron outputs. Existing jobs keep their native delivery target. This is not a hosted scheduler and does not promise work while the backend is stopped.

## Collaboration

`profile.yaml` marks the app-owned profiles as Bot Mode participants. The permanent Bot Chat enables Hermes' native `message_agent` tool. Hermes maintains target validation, asynchronous delivery, sender attribution and recipient history. The app records outbound tool activity and reads the resulting native transcripts. A dispatch acknowledgement is not proof of delivery; the recipient transcript/result is the evidence.

Group membership and a display transcript live in app metadata. On a user message, members run in order with a bounded recent group context and separate native group conversations. Private Bot Chat history is not added to the group context. The current design has no native group mention router, persistent group worker or cross-process group lock; only one backend should own a data directory.

## Unread conversations

The app reads native active assistant messages from visible, non-cron sessions.
It joins compressed session titles back to their conversation and excludes group
execution sessions from private-chat badges. App metadata stores only the last
observed native message ID for each Bot/conversation and a separate group message
cursor. The acknowledgement validates the ID against that Bot and conversation,
and only advances. A reply arriving after the observed message therefore stays
unread, including after restart. Earlier transcripts without a read cursor are
unread until opened.

The client acknowledges the latest loaded reply only while its Chat is visible
and the window has focus. Computer views and other conversations do not clear it.
Native completions trigger transcript refresh; a five-second poll also discovers
writes made by Hermes workers outside this backend's gateway. History reads the
latest 2,000 active messages, so older long conversations cannot hide a newly
delivered reply. OS notifications and cross-device read synchronization are not
implemented.

## Bot computers

The app creates named Apple container VMs under a namespace derived from the
workspace path. Each VM is labelled with its owning namespace and receives only
a named home volume. A one-shot root initialization fixes volume ownership; the
desktop and all agent commands run as `bot` (uid 1000). There are no host path
mounts or provider environment variables in the desktop. Browser state and files
remain in the volume across sleep. Containers are stopped on clean shutdown and
after 20 minutes idle, except during manual control or an in-flight tool action.

A private profile descriptor holds a random per-backend MCP capability and the
loopback URL. Hermes starts the small stdio MCP adapter with that descriptor,
using its own installed Python SDK. Native target-profile workers therefore read
the recipient’s capability, rather than inheriting the sender’s computer. The
capability is checked against the Bot ID on every tool call. Existing non-app MCP
configuration is preserved. Startup refreshes descriptors for enabled computers.

The browser connects to a same-origin WebSocket. The server validates Host and
Origin, looks up only the owning VM’s private IPv4 address, and proxies its VNC
stream. The guest screen uses a separate random VNC password. No arbitrary proxy
target is accepted. noVNC starts in watch mode; taking control gates new MCP
computer actions and waits for existing app-owned actions to finish. Hand-back
releases the gate. It does not stop processes previously started in the VM or
intercept native Hermes host tools.

The VM home and host workspace are separate. No automatic file copy, credential
injection, browser login management, whole-agent sandbox, or remote desktop
service is implied by this surface. Native Hermes tools remain capable of acting
on the host under the current OS account.

## Connected apps and reviews

The connection manager owns only `app_<id>` MCP entries in the Bot's native
configuration. HTTP bearer and command environment bindings contain credential
names, resolved by Hermes at connection time. Native MCP starts command servers
with its filtered environment, not the model provider's ambient keys. The manager
preserves unrelated MCP entries and native hooks. Failed connection changes restore
the previous app metadata and owned configuration files when filesystem recovery
is possible; this is not a multi-file crash transaction.

An owner-only descriptor contains a random per-Bot, per-backend review capability.
A native `pre_tool_call` shell hook posts the actual parameters and durable session
ID to the loopback backend. The bootstrap activates declarative hooks using Hermes'
registration API and verifies that its owned hook registered. The backend asks
Hermes for the live-to-stored session mapping, then publishes a card only for that
Bot's active turn. Responses validate Bot ownership, pending lifetime and original
field preservation. Hermes shallow-merges the approved parameters before dispatch.
Other trusted operator-installed hooks can still transform parameters or veto calls;
this is not a replacement for their policies or OS isolation.

Deny, expiry, a closed review channel, Stop, session completion and backend shutdown
resolve pending calls as blocked. Reviews are memory-only and never auto-approved
after backend restart. A browser reload reconnects to the existing card. The app
defaults native callback timeout to 300 seconds if unset, with a 240-second review;
explicit native limits are preserved. The shell subprocess and HTTP request also
have bounded timeouts. A separate unattended worker with no live app turn receives
a block when review is enabled. Disabling review is an explicit per-connection
choice that permits unattended native execution.

## Security

- This is a single-user local service. Loopback binding, Host/Origin checks, cross-site rejection and a production CSP protect browser access; they do not authenticate local processes.
- Electron disables Node access in the renderer, enables context isolation and sandboxing, denies permissions and sends external HTTP links to the system browser.
- App directories are created owner-only; credentials and atomic state/config writes use mode 0600. API-key `.env` and native authentication storage are plaintext. Website passwords and optional TOTP seeds use the native encrypted Hermes vault with its adjacent owner-only key; this is not OS Keychain storage.
- The API returns credential names, not values. Known raw values are redacted from displayed transcripts/activity. Redaction is best-effort and cannot protect transformed secrets or an external tool's side effects.
- File editing accepts simple names and rejects traversal/symlink targets. Uploads are limited to text/source files. Native Hermes tools remain more capable than this file UI.
- Interactive chat uses native `manual` approvals and displays the requested command, description and allowed decision scopes. One-shot cron execution retains `deny`. Not every tool action is approval-gated. Role text is guidance, not enforcement.
- Profile isolation organizes data. Native tools run as the current OS user, so a malicious instruction can attempt to read other profiles or local files. Configure a real container/remote sandbox before using untrusted skills or sensitive production credentials.

## Known operational limits

Run state and pending cards are in backend memory. Reloading the browser reconnects to pending cards without repeating a tool call. A backend crash/restart does not reconstruct active children or resume an unfinished group sequence. Native Hermes transcripts and cron job stores remain durable. There is no multi-backend writer coordination for app metadata. The native scheduler may use its own execution controls independently of interactive chat. No automatic login, external messaging or deployment is performed by installing this app.

## Native login vault

The Credentials panel queries `vault.list` and `vault.sources` through each Bot’s
existing private gateway. Schemas discard unknown fields before returning
metadata to the browser. Add/remove and source edits are rejected while that Bot
is working. Hermes owns encrypted persistence, identifier metadata, origin
binding, secret resolution and external-manager session tokens. No second secret
store is maintained in app metadata.

Private login, unlock and code cards retain only public request fields in the
pending-card map. Masked values pass directly to the native RPC response and are
not saved to the app state or transcript. Form values clear on submit. A reply
must match both Bot ownership and request kind; native cancellation, Stop and
timeout use the existing request lifecycle. Reload restores the pending request,
not a previously typed secret. Native private fills target the Hermes browser,
not the app’s separate VM. Payment/address vault management is not exposed.

## Mobile client and authenticated gateway

The Capacitor client in `mobile/` bundles its phone interface locally. Shared Zod
schemas and request-card components preserve desktop validation and approval
meaning. Native HTTP connects to a separate HTTPS gateway, using a revocable
device token stored in platform secure storage. The gateway has an explicit API
allowlist and forwards accepted requests to the unchanged loopback service.
Hermes ownership, per-profile state, native approvals and VM boundaries remain
on the host. Read [mobile setup and trust](mobile.md) for pairing, token lifetime,
TLS configuration, device revocation and coverage. This is single-owner device
access, not multi-user authorization or a new native agent runtime.
