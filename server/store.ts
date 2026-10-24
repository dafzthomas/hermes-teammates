import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import YAML from 'yaml';
import { z } from 'zod';
import {
  botSchema,
  groupSchema,
  activitySchema,
  type Bot,
  type Activity,
  type Provider,
  type Inbox,
} from '../src/domain';

const stateSchema = z.object({
  bots: z.array(botSchema),
  groups: z.array(groupSchema),
  activity: z.array(activitySchema),
  readCursors: z
    .array(
      z.object({ botId: z.string(), title: z.string(), sequence: z.number().int().nonnegative() }),
    )
    .default([]),
  groupReads: z.record(z.string(), z.string()).default({}),
  groupMessages: z
    .record(
      z.string(),
      z.array(z.object({ id: z.string(), name: z.string(), text: z.string(), at: z.number() })),
    )
    .default({}),
});
const rowsSchema = z.array(
  z.object({
    id: z.number(),
    role: z.string(),
    content: z.string().nullable(),
    timestamp: z.number(),
    session_id: z.string(),
    tool_name: z.string().nullable(),
  }),
);

export class Store {
  readonly root: string;
  state: z.infer<typeof stateSchema>;
  constructor(root: string) {
    this.root = path.resolve(root);
    fs.mkdirSync(this.root, { recursive: true, mode: 0o700 });
    this.state = fs.existsSync(this.statePath)
      ? stateSchema.parse(JSON.parse(fs.readFileSync(this.statePath, 'utf8')))
      : stateSchema.parse({ bots: [], groups: [], activity: [] });
    if (!this.state.bots.length) {
      this.createBot(
        {
          name: 'Hermes',
          role: 'Your primary Bot. Help with research, writing and planning. Coordinate specialist Bots when useful. Check sources, save lasting preferences in memory, and suggest routines for recurring work. Never send external messages or make purchases without approval.',
          color: 'white',
          provider: { kind: 'claude', model: 'claude-sonnet-4-6', borrowLogin: false },
        },
        'default',
      );
    }
  }
  get statePath() {
    return path.join(this.root, 'teammates.json');
  }
  save() {
    this.atomic(this.statePath, JSON.stringify(this.state, null, 2));
  }
  atomic(file: string, content: string) {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const temp = `${file}.${randomUUID()}.tmp`;
    fs.writeFileSync(temp, content, { mode: 0o600 });
    fs.renameSync(temp, file);
  }
  bot(id: string) {
    const bot = this.state.bots.find((b) => b.id === id);
    if (!bot) throw new Error('Bot not found');
    return bot;
  }
  home(id: string) {
    this.bot(id);
    return id === 'default'
      ? path.join(this.root, 'hermes')
      : path.join(this.root, 'hermes', 'profiles', id);
  }
  createBot(
    input: { name: string; role: string; color: Bot['color']; provider: Provider },
    id = `bot-${randomUUID().slice(0, 8)}`,
  ): Bot {
    const bot = botSchema.parse({
      ...input,
      id,
      createdAt: new Date().toISOString(),
      pinned: id === 'default',
    });
    this.state.bots.push(bot);
    const home = this.home(id);
    for (const dir of ['workspace', 'memories', 'skills', 'sessions', 'cron', 'home'])
      fs.mkdirSync(path.join(home, dir), { recursive: true, mode: 0o700 });
    this.writeProfile(bot);
    this.save();
    return bot;
  }
  writeProfile(bot: Bot) {
    const home = this.home(bot.id);
    const p = bot.provider;
    const config = {
      model:
        p.kind === 'claude'
          ? { provider: 'anthropic', default: p.model }
          : {
              provider: 'custom',
              default: p.model,
              base_url: p.baseUrl,
              key_env: 'OPENAI_API_KEY',
              api_mode: 'chat_completions',
            },
      agent: { max_turns: 30, bot_mode_protocol: true },
      auth: { adopt_external_logins: p.kind === 'claude' && p.borrowLogin },
      approvals: { mode: 'manual', single_query_mode: 'deny' },
      terminal: { backend: 'local', cwd: path.join(home, 'workspace') },
      telemetry: { enabled: false },
    };
    const configFile = path.join(home, 'config.yaml');
    const previous = fs.existsSync(configFile)
      ? z.record(z.string(), z.unknown()).parse(YAML.parse(fs.readFileSync(configFile, 'utf8')))
      : {};
    const merged: Record<string, unknown> = { ...previous };
    for (const [key, value] of Object.entries(config)) {
      const prior = z.record(z.string(), z.unknown()).safeParse(previous[key]);
      merged[key] = key === 'model' ? value : { ...(prior.success ? prior.data : {}), ...value };
    }
    this.atomic(configFile, YAML.stringify(merged));
    const profileFile = path.join(home, 'profile.yaml');
    const profile = fs.existsSync(profileFile)
      ? z.record(z.string(), z.unknown()).parse(YAML.parse(fs.readFileSync(profileFile, 'utf8')))
      : {};
    const uiMeta = z.record(z.string(), z.unknown()).safeParse(profile.ui_meta);
    this.atomic(
      profileFile,
      YAML.stringify({
        ...profile,
        name: bot.id,
        display_name: bot.name,
        description: bot.role,
        ui_meta: { ...(uiMeta.success ? uiMeta.data : {}), 'hermes-bots': { title: bot.name } },
      }),
    );
    this.atomic(
      path.join(home, 'SOUL.md'),
      `${bot.role}\n\nWork in your own workspace. You have private memory and skills. Do not save secrets in memory or transcripts. Ask before consequential external actions. Suggest useful recurring routines rather than enabling unexpected work.\n${bot.computerEnabled ? '\nYou have a persistent Linux computer. Use tool_search for computer tools on the teammates-computer MCP server, then tool_describe and tool_call as needed. Prefer computer_shell, computer_screenshot and computer_action for browser and desktop tasks; these act inside your VM, while terminal and other host tools act on the Mac. Screen coordinates are 1280x800. Screenshot results use Hermes MEDIA:path image caching; inspect that path with vision_analyze before clicking, and report when a vision model is unavailable. The user can take control: wait for hand-back when computer tools report human_has_control. The VM home and browser logins persist across sleep, but its workspace is separate from your host workspace. Do not print credentials or claim all your tools are sandboxed.\n' : ''}`,
    );
    if (!fs.existsSync(path.join(home, '.env'))) this.atomic(path.join(home, '.env'), '');
  }
  updateBot(
    id: string,
    input: { name: string; role: string; color: Bot['color']; provider: Provider },
  ) {
    const bot = this.bot(id);
    Object.assign(bot, input);
    this.writeProfile(bot);
    this.save();
    return bot;
  }
  activity(botId: string, kind: Activity['kind'], text: string) {
    this.state.activity.push({
      id: randomUUID(),
      botId,
      kind,
      text: this.redact(botId, text),
      at: Date.now(),
    });
    this.state.activity = this.state.activity.slice(-500);
    this.save();
  }
  secretEntries(id: string) {
    const raw = fs.readFileSync(path.join(this.home(id), '.env'), 'utf8');
    const entries: Record<string, string> = {};
    for (const line of raw.split('\n')) {
      const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
      if (!match) continue;
      try {
        entries[match[1]] = z.string().parse(JSON.parse(match[2]));
      } catch {
        entries[match[1]] = match[2];
      }
    }
    return entries;
  }
  setSecret(id: string, name: string, value: string | null) {
    if (!/^[A-Z][A-Z0-9_]{0,63}$/.test(name))
      throw new Error('Use an uppercase environment variable name.');
    if (/^(HERMES_|PATH$|HOME$|PYTHON|NODE_|LD_|DYLD_|BASH|ENV$|SHELL$)/.test(name))
      throw new Error('Runtime control variables cannot be stored as credentials.');
    const entries = this.secretEntries(id);
    if (value === null) delete entries[name];
    else entries[name] = value;
    this.atomic(
      path.join(this.home(id), '.env'),
      Object.entries(entries)
        .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
        .join('\n') + '\n',
    );
  }
  redact(id: string, text: string) {
    for (const value of Object.values(this.secretEntries(id)))
      if (value.length >= 4) text = text.split(value).join('[redacted]');
    return text;
  }
  safeFile(id: string, folder: 'workspace' | 'skills', name: string) {
    if (!/^[\w][\w .-]{0,119}$/.test(name) || name === '.' || name === '..')
      throw new Error('Use a simple file name without folders.');
    const root = path.join(this.home(id), folder);
    const target = folder === 'skills' ? path.join(root, name, 'SKILL.md') : path.join(root, name);
    for (let current = target; current !== this.root; current = path.dirname(current)) {
      try {
        if (fs.lstatSync(current).isSymbolicLink())
          throw new Error('Symbolic links are not editable through the app.');
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
      }
    }
    return target;
  }
  files(id: string) {
    const home = path.join(this.home(id), 'workspace');
    return fs
      .readdirSync(home, { withFileTypes: true })
      .filter((f) => f.isFile() && !f.name.startsWith('.'))
      .map((f) => ({ name: f.name, size: fs.statSync(path.join(home, f.name)).size }));
  }
  skills(id: string) {
    const home = path.join(this.home(id), 'skills');
    return fs
      .readdirSync(home, { withFileTypes: true })
      .filter((f) => f.isDirectory())
      .flatMap((f) => {
        const file = this.safeFile(id, 'skills', f.name);
        return fs.existsSync(file)
          ? [{ name: f.name, content: fs.readFileSync(file, 'utf8') }]
          : [];
      });
  }
  memory(id: string, name: 'MEMORY' | 'USER') {
    const file = path.join(this.home(id), 'memories', `${name}.md`);
    if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink())
      throw new Error('Memory is a symbolic link.');
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  }
  saveMemory(id: string, name: 'MEMORY' | 'USER', content: string) {
    this.memory(id, name);
    this.atomic(path.join(this.home(id), 'memories', `${name}.md`), content);
  }
  history(id: string, title = 'Bot Chat') {
    const file = path.join(this.home(id), 'state.db');
    if (!fs.existsSync(file)) return { messages: [], sessions: [] };
    const db = new DatabaseSync(file, { readOnly: true });
    try {
      const sessions = z
        .array(z.object({ id: z.string(), title: z.string().nullable(), count: z.number() }))
        .parse(
          db
            .prepare(
              `SELECT id, title, message_count AS count FROM sessions WHERE hidden = 0 AND source != 'cron' ORDER BY started_at`,
            )
            .all(),
        )
        .map((s) => ({ ...s, title: s.title || 'Untitled' }));
      const rows = rowsSchema.parse(
        db
          .prepare(
            `SELECT * FROM (SELECT m.id, m.role, m.content, m.timestamp, m.session_id, m.tool_name FROM messages m JOIN sessions s ON m.session_id=s.id WHERE (s.title=? OR substr(s.title,1,length(?))=?) AND s.hidden=0 AND s.source != 'cron' AND m.active=1 ORDER BY m.timestamp DESC, m.id DESC LIMIT 2000) ORDER BY timestamp, id`,
          )
          .all(title, `${title} #`, `${title} #`),
      );
      return {
        sessions,
        messages: rows
          .filter((r) => r.content)
          .map((r) => ({
            id: `${r.session_id}:${r.id}`,
            role: r.role,
            content: this.redact(id, r.content || ''),
            timestamp: r.timestamp * 1000,
            sessionId: r.session_id,
            toolName: r.tool_name,
          })),
      };
    } finally {
      db.close();
    }
  }
  acknowledge(id: string, title: string, messageId: string) {
    const match = /^(.+):([0-9]+)$/.exec(messageId);
    const sequence = Number(match?.[2]);
    if (!match || !Number.isSafeInteger(sequence) || sequence <= 0)
      throw new Error('Invalid message cursor.');
    const file = path.join(this.home(id), 'state.db');
    if (!fs.existsSync(file)) throw new Error('Conversation not found.');
    const db = new DatabaseSync(file, { readOnly: true });
    try {
      const row = db
        .prepare(
          `SELECT m.id FROM messages m JOIN sessions s ON s.id=m.session_id
        WHERE m.id=? AND m.session_id=? AND m.role='assistant' AND m.active=1
        AND trim(COALESCE(m.content,'')) != '' AND s.hidden=0 AND s.source != 'cron'
        AND (s.title=? OR substr(s.title,1,length(?))=?)`,
        )
        .get(sequence, match[1], title, `${title} #`, `${title} #`);
      if (!row) throw new Error('Message is not a visible reply in this conversation.');
    } finally {
      db.close();
    }
    const cursor = this.state.readCursors.find((c) => c.botId === id && c.title === title);
    if (sequence > (cursor?.sequence || 0)) {
      if (cursor) cursor.sequence = sequence;
      else this.state.readCursors.push({ botId: id, title, sequence });
      this.save();
    }
  }
  acknowledgeGroup(id: string, messageId: string) {
    if (!this.state.groups.some((g) => g.id === id)) throw new Error('Group not found.');
    const messages = this.state.groupMessages[id] || [];
    const next = messages.findIndex((m) => m.id === messageId);
    if (next < 0) throw new Error('Group message not found.');
    const previous = messages.findIndex((m) => m.id === this.state.groupReads[id]);
    if (next > previous) {
      this.state.groupReads[id] = messageId;
      this.save();
    }
  }
  inbox(): Inbox {
    const inbox: Inbox = { conversations: [], groups: [] };
    for (const bot of this.state.bots) {
      const file = path.join(this.home(bot.id), 'state.db');
      if (!fs.existsSync(file)) continue;
      const db = new DatabaseSync(file, { readOnly: true });
      try {
        const sessions = z
          .array(z.object({ title: z.string() }))
          .parse(
            db
              .prepare(
                `SELECT DISTINCT title FROM sessions WHERE hidden=0 AND source != 'cron' AND title IS NOT NULL`,
              )
              .all(),
          );
        const titles = new Set(sessions.map((s) => s.title.replace(/ #\d+$/, '')));
        for (const title of titles) {
          if (this.state.groups.some((g) => title === `Group ${g.id}`)) continue;
          const latest = z
            .object({
              id: z.number(),
              session_id: z.string(),
              content: z.string(),
              timestamp: z.number(),
            })
            .optional()
            .parse(
              db
                .prepare(
                  `SELECT m.id,m.session_id,m.content,m.timestamp FROM messages m JOIN sessions s ON s.id=m.session_id
              WHERE s.hidden=0 AND s.source != 'cron' AND m.active=1 AND m.role='assistant'
              AND trim(COALESCE(m.content,'')) != '' AND (s.title=? OR substr(s.title,1,length(?))=?)
              ORDER BY m.id DESC LIMIT 1`,
                )
                .get(title, `${title} #`, `${title} #`),
            );
          if (!latest) continue;
          const { count } = z.object({ count: z.number() }).parse(
            db
              .prepare(
                `SELECT COUNT(*) AS count FROM messages m JOIN sessions s ON s.id=m.session_id
              WHERE s.hidden=0 AND s.source != 'cron' AND m.active=1 AND m.role='assistant'
              AND trim(COALESCE(m.content,'')) != '' AND m.id>? AND (s.title=? OR substr(s.title,1,length(?))=?)`,
              )
              .get(
                this.state.readCursors.find((c) => c.botId === bot.id && c.title === title)
                  ?.sequence || 0,
                title,
                `${title} #`,
                `${title} #`,
              ),
          );
          inbox.conversations.push({
            botId: bot.id,
            title,
            unread: count,
            latestId: `${latest.session_id}:${latest.id}`,
            preview: this.redact(bot.id, latest.content).replace(/\s+/g, ' ').slice(0, 160),
            at: latest.timestamp * 1000,
          });
        }
      } finally {
        db.close();
      }
    }
    for (const group of this.state.groups) {
      const messages = this.state.groupMessages[group.id] || [];
      const latest = messages.at(-1);
      if (!latest) continue;
      const previous = messages.findIndex((m) => m.id === this.state.groupReads[group.id]);
      inbox.groups.push({
        groupId: group.id,
        unread: messages.slice(previous + 1).filter((m) => m.name !== 'You').length,
        latestId: latest.id,
        preview: latest.text.slice(0, 160),
        at: latest.at,
      });
    }
    return inbox;
  }
  outputs(id: string) {
    const root = path.join(this.home(id), 'cron', 'output');
    if (!fs.existsSync(root)) return [];
    const files: string[] = [];
    const visit = (dir: string, depth: number) => {
      if (depth > 2) return;
      for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, f.name);
        if (f.isDirectory()) visit(p, depth + 1);
        else if (f.isFile() && /\.(md|txt)$/.test(f.name)) files.push(p);
      }
    };
    visit(root, 0);
    return files
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
      .slice(0, 15)
      .map((p) => ({
        name: path.relative(root, p),
        content: this.redact(id, fs.readFileSync(p, 'utf8').slice(0, 60000)),
      }));
  }
}
