import readline from 'node:readline';
import fs from 'node:fs';
import { createHash } from 'node:crypto';

const lines = readline.createInterface({ input: process.stdin });
for await (const line of lines) {
  const request = JSON.parse(line);
  if (!('id' in request)) continue;
  let result;
  if (request.method === 'initialize')
    result = {
      protocolVersion: request.params.protocolVersion,
      capabilities: { tools: {} },
      serverInfo: { name: 'review-proof', version: '1' },
    };
  else if (request.method === 'tools/list')
    result = {
      tools: [
        {
          name: 'send_message',
          description: 'Send a message through the connected proof app',
          inputSchema: {
            type: 'object',
            properties: { recipient: { type: 'string' }, text: { type: 'string' } },
            required: ['recipient', 'text'],
          },
        },
      ],
    };
  else if (request.method === 'tools/call') {
    const record = {
      args: request.params.arguments,
      credentialHash: createHash('sha256')
        .update(process.env.APP_TOKEN || '')
        .digest('hex'),
      providerPresent: Boolean(process.env.OPENAI_API_KEY),
    };
    fs.appendFileSync(process.argv[2], JSON.stringify(record) + '\n');
    result = { content: [{ type: 'text', text: JSON.stringify(record.args) }] };
  } else {
    process.stdout.write(
      JSON.stringify({
        jsonrpc: '2.0',
        id: request.id,
        error: { code: -32601, message: 'Unknown method' },
      }) + '\n',
    );
    continue;
  }
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\n');
}
