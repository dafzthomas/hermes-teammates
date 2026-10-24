import http from 'node:http';

/** Deterministic model transport; native Hermes still discovers and executes MCP tools. */
export function appModelFixture() {
  const stages = new Map<string, number>();
  const received: string[] = [];
  const server = http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += String(chunk);
    if (!req.url?.includes('chat/completions') || !raw) {
      res.writeHead(404).end('{}');
      return;
    }
    received.push(raw);
    const body = JSON.parse(raw);
    const history = JSON.stringify(body.messages);
    const marker = [...history.matchAll(/APP_REVIEW_[A-Z]+/g)].at(-1)?.[0] || 'default';
    const stage = stages.get(marker) || 0;
    const names: string[] = (body.tools || []).map(
      (t: { function: { name: string } }) => t.function.name,
    );
    const native =
      history.match(/mcp__app_[a-f0-9]{12}__send_message/)?.[0] ||
      names.find((n) => /mcp__app_.*__send_message/.test(n));
    let tool: { name: string; arguments: string } | undefined;
    if (stage === 0 && names.includes('tool_search'))
      tool = {
        name: 'tool_search',
        arguments: JSON.stringify({ queries: ['send_message'], limit: 10 }),
      };
    else if (stage === 1 && native)
      tool = { name: 'tool_describe', arguments: JSON.stringify({ names: [native] }) };
    else if (stage === 2 && native) {
      const args = { recipient: 'original@example.test', text: 'Original draft' };
      tool = {
        name: names.includes(native) ? native : 'tool_call',
        arguments: JSON.stringify(
          names.includes(native) ? args : { calls: [{ name: native, arguments: args }] },
        ),
      };
    }
    if (tool) stages.set(marker, stage + 1);
    const message = tool
      ? {
          role: 'assistant',
          content: '',
          tool_calls: [{ id: `proof-${marker}-${stage}`, type: 'function', function: tool }],
        }
      : { role: 'assistant', content: 'App review proof complete.' };
    res.setHeader('Content-Type', body.stream ? 'text/event-stream' : 'application/json');
    if (body.stream)
      res.end(
        `data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', model: 'fixture-model', choices: [{ index: 0, delta: tool ? { ...message, tool_calls: message.tool_calls?.map((c, index) => ({ index, ...c })) } : message, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: tool ? 'tool_calls' : 'stop' }] })}\n\ndata: [DONE]\n\n`,
      );
    else
      res.end(
        JSON.stringify({
          id: 'fixture',
          object: 'chat.completion',
          model: 'fixture-model',
          choices: [{ index: 0, message, finish_reason: tool ? 'tool_calls' : 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
        }),
      );
  });
  return { server, received };
}
