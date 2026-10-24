import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import YAML from 'yaml';
import { z } from 'zod';
import {
  actionArgumentsSchema,
  connectionInputSchema,
  type Bot,
  type Connection,
  type InteractiveRequest,
  type RequestResponse,
} from '../src/domain';
import { Store } from './store';
import { Hermes } from './hermes';
import { serverResource } from './computers';

const recordSchema = z.record(z.string(), z.unknown());
const hookInputSchema = z.object({
  hook_event_name: z.literal('pre_tool_call'),
  tool_name: z.string(),
  tool_input: actionArgumentsSchema,
  session_id: z.string(),
  extra: z.object({ tool_call_id: z.string().min(1) }),
});
type Directive =
  | { action: 'block'; message: string }
  | { action: 'modify'; args: z.infer<typeof actionArgumentsSchema> };
type ActionRequest = Extract<InteractiveRequest, { kind: 'action' }>;
const block = (message: string): Directive => ({ action: 'block', message });
export const nativeServerName = (id: string) => `app_${id.replaceAll('-', '').slice(0, 12)}`;

/** App-owned MCP configuration and human reviews. Hermes executes the resulting native tool call. */
export class Connections {
  private origin = '';
  private tokens = new Map<string, string>();
  private pending = new Map<
    string,
    { view: ActionRequest; sessionId: string; settle: (result: Directive) => void }
  >();
  constructor(
    readonly store: Store,
    readonly hermes: Hermes,
    readonly changed: () => void,
  ) {}
  bindOrigin(origin: string) {
    this.origin = origin;
  }
  list(id: string) {
    this.store.bot(id);
    return this.store.state.connections.filter((c) => c.botId === id);
  }
  views() {
    return [...this.pending.values()].map((r) => r.view);
  }
  config(id: string) {
    return recordSchema.parse(
      YAML.parse(fs.readFileSync(path.join(this.store.home(id), 'config.yaml'), 'utf8')),
    );
  }
  saveConfig(id: string, config: Record<string, unknown>) {
    this.store.atomic(path.join(this.store.home(id), 'config.yaml'), YAML.stringify(config));
  }
  save(id: string, input: z.infer<typeof connectionInputSchema>, connectionId?: string) {
    if (!this.origin || !this.hermes.python || !this.hermes.runtime.available)
      throw new Error('Connect Hermes before adding apps.');
    const connections = this.list(id);
    const existing = connectionId ? connections.find((c) => c.id === connectionId) : undefined;
    if (connectionId && !existing) throw new Error('App connection not found.');
    for (const key of input.server.transport === 'stdio'
      ? Object.values(input.server.env)
      : input.server.bearerCredential
        ? [input.server.bearerCredential]
        : [])
      if (!(key in this.store.secretEntries(id)))
        throw new Error(`Add ${key} to this Bot's credentials first.`);
    const serialized = JSON.stringify(input);
    if (this.store.redact(id, serialized) !== serialized)
      throw new Error('Use credential names instead of secret values in app configuration.');
    const connection: Connection = { ...input, botId: id, id: existing?.id || randomUUID() };
    this.change(id, () => {
      this.store.state.connections = [
        ...this.store.state.connections.filter((c) => c.id !== connection.id),
        connection,
      ];
      this.configure(this.store.bot(id));
    });
    return connection;
  }
  remove(id: string, connectionId: string) {
    const connection = this.list(id).find((c) => c.id === connectionId);
    if (!connection) throw new Error('App connection not found.');
    this.change(id, () => {
      const config = this.config(id);
      const servers = recordSchema.parse(config.mcp_servers || {});
      delete servers[nativeServerName(connection.id)];
      config.mcp_servers = servers;
      this.saveConfig(id, config);
      this.store.state.connections = this.store.state.connections.filter(
        (c) => c.id !== connectionId,
      );
      this.configure(this.store.bot(id));
    });
  }
  private change(id: string, update: () => void) {
    const previous = this.store.state.connections;
    const previousToken = this.tokens.get(id);
    const files = ['config.yaml', 'shell-hooks-allowlist.json', '.teammates-app-review.json'].map(
      (name) => path.join(this.store.home(id), name),
    );
    files.push(this.store.statePath);
    const backups = files.map((file) => ({
      file,
      content: fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null,
    }));
    try {
      update();
      this.store.save();
    } catch (error) {
      this.store.state.connections = previous;
      if (previousToken) this.tokens.set(id, previousToken);
      else this.tokens.delete(id);
      for (const backup of backups) {
        if (backup.content === null) fs.rmSync(backup.file, { force: true });
        else this.store.atomic(backup.file, backup.content);
      }
      throw error;
    }
    this.hermes.reset(id);
    this.changed();
  }
  configure(bot: Bot) {
    const connections = this.list(bot.id);
    if (!connections.length) {
      const config = this.config(bot.id);
      const hooks = recordSchema.parse(config.hooks || {});
      const previous = z.array(recordSchema).parse(hooks.pre_tool_call || []);
      if (previous.some((h) => h.teammates_review === true)) {
        hooks.pre_tool_call = previous.filter((h) => h.teammates_review !== true);
        config.hooks = hooks;
        this.saveConfig(bot.id, config);
        const allowlistPath = path.join(this.store.home(bot.id), 'shell-hooks-allowlist.json');
        if (fs.existsSync(allowlistPath)) {
          const allowlist = recordSchema.parse(JSON.parse(fs.readFileSync(allowlistPath, 'utf8')));
          allowlist.approvals = z
            .array(recordSchema)
            .parse(allowlist.approvals || [])
            .filter((a) => a.teammates_review !== true);
          this.store.atomic(allowlistPath, JSON.stringify(allowlist, null, 2));
        }
        fs.rmSync(path.join(this.store.home(bot.id), '.teammates-app-review.json'), {
          force: true,
        });
        this.tokens.delete(bot.id);
      }
      return;
    }
    if (!this.origin || !this.hermes.python)
      throw new Error('App connections need the running backend and Hermes Python.');
    const config = this.config(bot.id);
    const servers = recordSchema.parse(config.mcp_servers || {});
    for (const connection of connections) {
      const key = nativeServerName(connection.id);
      if (!connection.enabled) {
        delete servers[key];
        continue;
      }
      const server = connection.server;
      servers[key] =
        server.transport === 'stdio'
          ? {
              command: server.command,
              args: server.args,
              env: Object.fromEntries(
                Object.entries(server.env).map(([name, credential]) => [
                  name,
                  '${' + credential + '}',
                ]),
              ),
              timeout: 180,
            }
          : {
              url: server.url,
              ...(server.bearerCredential
                ? { headers: { Authorization: 'Bearer ${' + server.bearerCredential + '}' } }
                : {}),
              timeout: 180,
            };
    }
    config.mcp_servers = servers;
    const plugins = recordSchema.parse(config.plugins || {});
    // Preserve explicit operator limits; the app's default leaves time to review a draft.
    if (plugins.hook_callback_timeout === undefined) plugins.hook_callback_timeout = 300;
    config.plugins = plugins;
    const limit =
      typeof plugins.hook_callback_timeout === 'number' && plugins.hook_callback_timeout > 0
        ? plugins.hook_callback_timeout
        : 300;
    const timeout = Math.max(1, Math.min(240, Math.floor(limit) - 5));
    const token = this.tokens.get(bot.id) || randomBytes(32).toString('hex');
    this.tokens.set(bot.id, token);
    const descriptor = path.join(this.store.home(bot.id), '.teammates-app-review.json');
    this.store.atomic(
      descriptor,
      JSON.stringify({ url: `${this.origin}/api/bots/${bot.id}/action-review`, token, timeout }),
    );
    // Shell hooks are split by shlex, never executed as a shell command.
    const quote = (part: string) =>
      '"' + part.replaceAll('\\', '\\\\').replaceAll('"', '\\"') + '"';
    const command = [this.hermes.python, '-I', serverResource('action_review.py'), descriptor]
      .map(quote)
      .join(' ');
    const hooks = recordSchema.parse(config.hooks || {});
    const previous = z.array(recordSchema).parse(hooks.pre_tool_call || []);
    hooks.pre_tool_call = [
      ...previous.filter((h) => h.teammates_review !== true),
      {
        teammates_review: true,
        matcher: '^mcp__app_[a-f0-9]{12}__.*$',
        command,
        timeout: Math.min(300, timeout + 10),
        fail_closed: true,
      },
    ];
    config.hooks = hooks;
    this.saveConfig(bot.id, config);
    const allowlistPath = path.join(this.store.home(bot.id), 'shell-hooks-allowlist.json');
    const allowlist = fs.existsSync(allowlistPath)
      ? recordSchema.parse(JSON.parse(fs.readFileSync(allowlistPath, 'utf8')))
      : {};
    const approvals = z.array(recordSchema).parse(allowlist.approvals || []);
    // Authorize only this app-owned hook. Other user-configured hooks keep their own consent.
    allowlist.approvals = [
      ...approvals.filter((a) => a.teammates_review !== true),
      { event: 'pre_tool_call', command, teammates_review: true },
    ];
    this.store.atomic(allowlistPath, JSON.stringify(allowlist, null, 2));
  }
  authorized(id: string, bearer: string | undefined) {
    const expected = this.tokens.get(id);
    const supplied = bearer?.replace(/^Bearer /, '') || '';
    return Boolean(
      expected &&
      Buffer.byteLength(expected) === Buffer.byteLength(supplied) &&
      timingSafeEqual(Buffer.from(expected), Buffer.from(supplied)),
    );
  }
  async request(id: string, input: unknown): Promise<{ id: string; result: Promise<Directive> }> {
    const payload = hookInputSchema.parse(input);
    const connection = this.list(id).find((c) =>
      payload.tool_name.startsWith(`mcp__${nativeServerName(c.id)}__`),
    );
    const turn = await this.hermes.turnForStoredSession(id, payload.session_id);
    const reject = (message: string) => ({ id: '', result: Promise.resolve(block(message)) });
    if (!connection?.enabled) return reject('App connection is disabled or no longer available.');
    if (!connection.review)
      return { id: '', result: Promise.resolve({ action: 'modify', args: payload.tool_input }) };
    if (!turn)
      return reject(
        'This app action needs a live Teammates conversation for review. Ask again in Bot Chat.',
      );
    if (
      this.store.redact(id, JSON.stringify(payload.tool_input)) !==
      JSON.stringify(payload.tool_input)
    )
      return reject(
        'Use credential bindings instead of including stored secrets in action parameters.',
      );
    const key = `review-${randomUUID()}`;
    let settle: (result: Directive) => void = () => {};
    const config = this.config(id);
    const timeout = this.reviewTimeout(config);
    const result = new Promise<Directive>((resolve) => {
      settle = resolve;
    });
    const timer = setTimeout(
      () => this.cancel(key, 'Action review expired. Ask again to create a new draft.'),
      timeout * 1000,
    );
    const view: ActionRequest = {
      id: key,
      botId: id,
      title: turn.title,
      kind: 'action',
      connectionName: connection.name,
      toolName: payload.tool_name,
      args: payload.tool_input,
      expiresAt: Date.now() + timeout * 1000,
    };
    this.pending.set(key, {
      view,
      sessionId: turn.sessionId || payload.session_id,
      settle: (result) => {
        clearTimeout(timer);
        this.pending.delete(key);
        settle(result);
        this.changed();
      },
    });
    turn.activity = 'Waiting for action review';
    this.store.activity(id, 'run', `Review requested: ${connection.name}`);
    this.changed();
    return { id: key, result };
  }
  private reviewTimeout(config: Record<string, unknown>) {
    const plugins = recordSchema.parse(config.plugins || {});
    const limit =
      typeof plugins.hook_callback_timeout === 'number' && plugins.hook_callback_timeout > 0
        ? plugins.hook_callback_timeout
        : 300;
    return Math.max(1, Math.min(240, Math.floor(limit) - 5));
  }
  respond(id: string, requestId: string, response: RequestResponse) {
    const request = this.pending.get(requestId);
    if (!request || request.view.botId !== id)
      throw new Error('This action is no longer waiting for review.');
    if (response.kind !== 'action') throw new Error('Response does not match this action review.');
    if (!this.hermes.turnFor(id, request.sessionId)) {
      this.cancel(requestId, 'The turn ended before review.');
      throw new Error('The turn has ended.');
    }
    if (response.result.decision === 'deny') request.settle(block('The user denied this action.'));
    else {
      const args = response.result.args;
      if (Object.keys(request.view.args).some((key) => !Object.hasOwn(args, key)))
        throw new Error('Keep the original field names when editing. Change their values instead.');
      if (this.store.redact(id, JSON.stringify(args)) !== JSON.stringify(args))
        throw new Error('Use credential bindings instead of secret values.');
      request.settle({ action: 'modify', args });
    }
    this.store.activity(
      id,
      'run',
      response.result.decision === 'deny'
        ? 'App action denied'
        : 'App action approved with reviewed parameters',
    );
    const turn = this.hermes.turnFor(id, request.sessionId);
    if (turn) turn.activity = 'Continuing';
  }
  cancel(requestId: string, message = 'Action review cancelled.') {
    this.pending.get(requestId)?.settle(block(message));
  }
  cancelBot(id: string, sessionId?: string) {
    for (const [key, request] of this.pending)
      if (request.view.botId === id && (!sessionId || sessionId === request.sessionId))
        this.cancel(key);
  }
  close() {
    for (const key of this.pending.keys()) this.cancel(key, 'Teammates is shutting down.');
  }
}
