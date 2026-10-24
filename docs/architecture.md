# Architecture and boundaries

## Ownership

React renders the roster, transcript and details. The loopback Express server validates requests, owns app metadata and starts Hermes child processes. Electron is a sandboxed desktop shell around that same backend. Hermes owns inference, tools, sessions, memories, learned skills, teammate delivery and cron jobs.

```text
React / Electron
        │ same-origin HTTP + server-sent change notifications
Loopback server
        ├── teammates.json: Bot roster, groups, activity, group display transcript
        └── Hermes CLI: one process per active Bot turn
                 ├── profile configuration and credential file
                 ├── native SQLite sessions (app reads, never rewrites)
                 ├── MEMORY.md / USER.md / skills / workspace
                 ├── native message_agent delivery to another profile
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

The adapter starts the configured executable without a shell:

```text
hermes chat --query-file - --format stream-json
  --continue "Bot Chat" --create-if-missing
  --provider anthropic|custom --model <id> --in <Bot workspace>
```

The prompt is written to stdin. Validated JSONL events update streaming text and tool activity. Completion requires a terminal result and a successful process exit. Stop targets the owned POSIX process group (Windows uses process termination); work already completed is not undone. There is a 15-minute app-owned turn timeout. Unexpected process exit becomes a visible error.

The child environment passes a small OS-variable allowlist, sets the correct HERMES_HOME, and excludes ambient provider keys. Credentials are loaded by Hermes from that profile. `HERMES_DISABLE_LAZY_INSTALLS=1` prevents bot startup from initiating source-update dependency installation or launcher publication. Managed installations reuse existing dependencies; custom installations can override executable, source, Python, tool store and dependency paths.

The Python bridge imports Hermes' installed cron library and exposes JSON-only create/list/pause/resume/remove operations. It keeps native cron jobs authoritative. The app invokes `hermes cron tick` every 30 seconds, with one tracked tick per profile; Hermes owns job locking and due-run behavior. Results are read from native cron outputs. This is not a hosted scheduler and does not promise work while the backend is stopped.

## Collaboration

`profile.yaml` marks the app-owned profiles as Bot Mode participants. The permanent Bot Chat enables Hermes' native `message_agent` tool. Hermes maintains target validation, asynchronous delivery, sender attribution and recipient history. The app records outbound tool activity and reads the resulting native transcripts. A dispatch acknowledgement is not proof of delivery; the recipient transcript/result is the evidence.

Group membership and a display transcript live in app metadata. On a user message, members run in order with a bounded recent group context and separate native group conversations. Private Bot Chat history is not added to the group context. The current design has no native group mention router, persistent group worker or cross-process group lock; only one backend should own a data directory.

## Security

- This is a single-user local service. Loopback binding, Host/Origin checks, cross-site rejection and a production CSP protect browser access; they do not authenticate local processes.
- Electron disables Node access in the renderer, enables context isolation and sandboxing, denies permissions and sends external HTTP links to the system browser.
- App directories are created owner-only; credentials and atomic state/config writes use mode 0600. `.env` is plaintext. No encryption-at-rest claim is made.
- The API returns credential names, not values. Known raw values are redacted from displayed transcripts/activity. Redaction is best-effort and cannot protect transformed secrets or an external tool's side effects.
- File editing accepts simple names and rejects traversal/symlink targets. Uploads are limited to text/source files. Native Hermes tools remain more capable than this file UI.
- Native one-shot approval mode is `deny`. This blocks approval-gated actions in this execution mode; it does not guarantee every external action requires approval. Role text is guidance, not enforcement.
- Profile isolation organizes data. Native tools run as the current OS user, so a malicious instruction can attempt to read other profiles or local files. Configure a real container/remote sandbox before using untrusted skills or sensitive production credentials.

## Known operational limits

Run state is in memory. A backend crash/restart does not reconstruct active children or resume an unfinished group sequence. Native Hermes transcripts and cron job stores remain durable. There is no multi-backend writer coordination for app metadata. The native scheduler may use its own execution controls independently of interactive chat. No automatic login, external messaging or deployment is performed by installing this app.
