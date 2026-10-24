import http from 'node:http';

/** Controlled inference only. Hermes executes the actual native browser/vault tools. */
export function vaultModelFixture(loginUrl: string) {
  const received: string[] = [];
  const stages = new Map<string, number>();
  const server = http.createServer(async (req, res) => {
    if (req.url === '/login') {
      res.setHeader('Content-Type', 'text/html');
      res.end(
        '<!doctype html><title>Controlled login</title><form><label>Username<input autocomplete="username" name="username"></label><label>Password<input type="password" autocomplete="current-password" name="password"></label><label>Verification code<input autocomplete="one-time-code" inputmode="numeric" name="otp"></label><button>Sign in</button></form>',
      );
      return;
    }
    let raw = '';
    for await (const chunk of req) raw += String(chunk);
    if (!req.url?.includes('chat/completions') || !raw) {
      res.writeHead(404).end('{}');
      return;
    }
    received.push(raw);
    const body = JSON.parse(raw);
    const history = JSON.stringify(body.messages);
    const marker = [...history.matchAll(/VAULT_[A-Z]+/g)].at(-1)?.[0] || 'VAULT_LOGIN';
    const stage = stages.get(marker) || 0;
    const names: string[] = (body.tools || []).map(
      (t: { function: { name: string } }) => t.function.name,
    );
    const steps =
      marker === 'VAULT_UNLOCK'
        ? [{ name: 'browser_vault_unlock', args: { backend: 'bitwarden' } }]
        : [
            { name: 'browser_navigate', args: { url: loginUrl } },
            { name: 'browser_vault_save_login', args: { label: 'Private sign-in' } },
            ...(marker === 'VAULT_LOGIN' ? [{ name: 'browser_vault_enter_code', args: {} }] : []),
          ];
    let tool: { name: string; arguments: string } | undefined;
    if (stage === 0)
      tool = {
        name: 'tool_search',
        arguments: JSON.stringify({
          queries: ['browser navigate', 'browser vault login unlock code'],
          limit: 10,
        }),
      };
    else if (stage === 1)
      tool = {
        name: 'tool_describe',
        arguments: JSON.stringify({ names: steps.map((s) => s.name) }),
      };
    else if (steps[stage - 2]) {
      const step = steps[stage - 2];
      tool = {
        name: names.includes(step.name) ? step.name : 'tool_call',
        arguments: JSON.stringify(
          names.includes(step.name)
            ? step.args
            : { calls: [{ name: step.name, arguments: step.args }] },
        ),
      };
    }
    if (tool) stages.set(marker, stage + 1);
    const message = tool
      ? {
          role: 'assistant',
          content: '',
          tool_calls: [{ id: `vault-${marker}-${stage}`, type: 'function', function: tool }],
        }
      : { role: 'assistant', content: 'Private vault flow complete.' };
    res.setHeader('Content-Type', body.stream ? 'text/event-stream' : 'application/json');
    if (body.stream)
      res.end(
        `data: ${JSON.stringify({ id: 'vault', object: 'chat.completion.chunk', model: 'fixture-model', choices: [{ index: 0, delta: tool ? { ...message, tool_calls: message.tool_calls?.map((call, index) => ({ index, ...call })) } : message, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ id: 'vault', object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: tool ? 'tool_calls' : 'stop' }] })}\n\ndata: [DONE]\n\n`,
      );
    else
      res.end(
        JSON.stringify({
          id: 'vault',
          object: 'chat.completion',
          model: 'fixture-model',
          choices: [{ index: 0, message, finish_reason: tool ? 'tool_calls' : 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
        }),
      );
  });
  return { server, received };
}
