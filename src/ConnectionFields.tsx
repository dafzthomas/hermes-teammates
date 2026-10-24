import { useState } from 'react';
import type { Connection } from './domain';

export function ConnectionFields({
  connection,
  credentials,
}: {
  connection?: Connection;
  credentials: string[];
}) {
  const [transport, setTransport] = useState(connection?.server.transport || 'http');
  return (
    <>
      <label>
        App name
        <input
          name="name"
          required
          maxLength={60}
          defaultValue={connection?.name}
          placeholder="e.g. GitHub"
          autoFocus
        />
      </label>
      <label>
        Connection type
        <select
          name="transport"
          value={transport}
          onChange={(event) => {
            const value = event.target.value;
            if (value === 'http' || value === 'stdio') setTransport(value);
          }}
        >
          <option value="http">HTTP MCP endpoint</option>
          <option value="stdio">Installed MCP command</option>
        </select>
      </label>
      {transport === 'http' ? (
        <>
          <label>
            MCP URL
            <input
              name="url"
              type="url"
              required
              defaultValue={connection?.server.transport === 'http' ? connection.server.url : ''}
              placeholder="https://example.com/mcp"
            />
          </label>
          <label>
            Bearer credential
            <select
              name="bearerCredential"
              defaultValue={
                connection?.server.transport === 'http'
                  ? connection.server.bearerCredential || ''
                  : ''
              }
            >
              <option value="">No bearer token</option>
              {credentials.map((key) => (
                <option key={key} value={key}>
                  {key}
                </option>
              ))}
            </select>
            <small>
              Select a credential saved on this Bot. Its value is kept out of the app configuration.
            </small>
          </label>
        </>
      ) : (
        <>
          <label>
            Command
            <input
              name="command"
              required
              defaultValue={
                connection?.server.transport === 'stdio' ? connection.server.command : ''
              }
              placeholder="/path/to/mcp-server"
            />
          </label>
          <label>
            Arguments, as a JSON array
            <textarea
              name="args"
              rows={3}
              defaultValue={JSON.stringify(
                connection?.server.transport === 'stdio' ? connection.server.args : [],
                null,
                2,
              )}
              spellCheck={false}
            />
          </label>
          <label>
            Credential bindings, as a JSON object
            <textarea
              name="env"
              rows={3}
              defaultValue={JSON.stringify(
                connection?.server.transport === 'stdio' ? connection.server.env : {},
                null,
                2,
              )}
              spellCheck={false}
            />
            <small>
              Map app variable names to this Bot's saved credential names, e.g.{' '}
              {`{"API_TOKEN":"GITHUB_TOKEN"}`}.
            </small>
          </label>
        </>
      )}
      <label className="check-label">
        <input type="checkbox" name="review" defaultChecked={connection?.review ?? true} />
        Review every tool call before it runs
      </label>
      <label className="check-label">
        <input type="checkbox" name="enabled" defaultChecked={connection?.enabled ?? true} />
        Enable this connection
      </label>
      <p className="form-note">
        Connect only an app or installed command you trust. Commands run on this Mac as your user
        and receive the credentials you bind. Reviewed actions can be edited or denied in Chat.
      </p>
    </>
  );
}
