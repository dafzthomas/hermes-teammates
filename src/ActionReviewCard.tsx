import { useState, type FormEvent } from 'react';
import { ShieldCheck } from 'lucide-react';
import { actionArgumentsSchema, type InteractiveRequest, type RequestResponse } from './domain';

export function ActionReviewCard({
  request,
  botName,
  respond,
}: {
  request: Extract<InteractiveRequest, { kind: 'action' }>;
  botName: string;
  respond: (response: RequestResponse) => Promise<void>;
}) {
  const [draft, setDraft] = useState(() => JSON.stringify(request.args, null, 2));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function decide(response: RequestResponse) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await respond(response);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not send review.');
      setBusy(false);
    }
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const args = actionArgumentsSchema.parse(JSON.parse(draft));
      void decide({ kind: 'action', result: { decision: 'approve', args } });
    } catch {
      setError(
        'Enter a JSON object under 64 KB. Keep the original field names and edit their values.',
      );
    }
  }
  return (
    <section className="request-card action-review" aria-label={`${botName} app action review`}>
      <header>
        <ShieldCheck size={18} />
        <strong>Review app action</strong>
        <span>{botName}</span>
      </header>
      <p>
        <strong>{request.connectionName}</strong> ·{' '}
        {request.toolName.split('__').slice(2).join('__')}
      </p>
      <p className="request-note">
        Edit the parameters below, then allow this action once. The app tool will receive your
        reviewed values. Keep the original field names.
      </p>
      <form onSubmit={submit}>
        <label>
          Action parameters
          <textarea
            className="action-parameters"
            aria-label="Action parameters"
            spellCheck={false}
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              setError('');
            }}
            rows={8}
            disabled={busy}
          />
        </label>
        <small>
          Review expires at{' '}
          {new Date(request.expiresAt).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          })}
          .
        </small>
        <div className="request-actions">
          <button
            type="button"
            disabled={busy}
            onClick={() => void decide({ kind: 'action', result: { decision: 'deny' } })}
          >
            Deny
          </button>
          <button className="primary" type="submit" disabled={busy}>
            Run reviewed action
          </button>
        </div>
      </form>
      {error && (
        <p className="request-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
