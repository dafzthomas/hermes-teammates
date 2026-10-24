import { useState, type FormEvent } from 'react';
import { CircleHelp, KeyRound, ShieldCheck } from 'lucide-react';
import type { InteractiveRequest, RequestResponse } from './domain';

export function RequestCard({
  request,
  botName,
  respond,
}: {
  request: InteractiveRequest;
  botName: string;
  respond: (response: RequestResponse) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function answer(response: RequestResponse) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await respond(response);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not send response');
      setBusy(false);
    }
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    if (request.kind === 'secret') {
      const value = String(data.get('value') || '');
      event.currentTarget.reset();
      void answer({ kind: 'secret', value });
    } else if (request.kind === 'clarify') {
      const answers: Record<string, string> = {};
      for (const question of request.questions) {
        const custom = String(data.get(`custom-${question.qid}`) || '').trim();
        const selected = data.getAll(`choice-${question.qid}`).map(String);
        answers[question.qid] =
          custom || (question.multi_select ? JSON.stringify(selected) : selected[0] || '');
      }
      void answer({ kind: 'clarify', answers });
    }
  }
  return (
    <section
      className="request-card"
      aria-label={`${botName} ${request.kind === 'clarify' ? 'question' : request.kind === 'approval' ? 'approval request' : 'credential request'}`}
    >
      <header>
        {request.kind === 'approval' ? (
          <ShieldCheck size={18} />
        ) : request.kind === 'secret' ? (
          <KeyRound size={18} />
        ) : (
          <CircleHelp size={18} />
        )}
        <strong>
          {request.kind === 'approval'
            ? 'Your approval is needed'
            : request.kind === 'secret'
              ? 'Private input needed'
              : 'A question for you'}
        </strong>
        <span>{botName}</span>
      </header>
      {request.kind === 'approval' ? (
        <>
          {request.description && <p>{request.description}</p>}
          {request.command && <pre>{request.command}</pre>}
          <p className="request-note">Review the action before allowing it to continue.</p>
          <div className="request-actions">
            {request.choices.includes('deny') && (
              <button
                disabled={busy}
                onClick={() => void answer({ kind: 'approval', choice: 'deny' })}
              >
                Deny
              </button>
            )}
            {request.choices.includes('once') && (
              <button
                className="primary"
                disabled={busy}
                onClick={() => void answer({ kind: 'approval', choice: 'once' })}
              >
                Allow once
              </button>
            )}
            {request.choices.includes('session') && (
              <button
                disabled={busy}
                onClick={() => void answer({ kind: 'approval', choice: 'session' })}
              >
                Allow for this session
              </button>
            )}
            {request.choices.includes('always') && (
              <button
                disabled={busy}
                onClick={() => void answer({ kind: 'approval', choice: 'always' })}
              >
                Always allow this action
              </button>
            )}
          </div>
        </>
      ) : (
        <form onSubmit={submit}>
          {request.kind === 'secret' ? (
            <label>
              {request.prompt}
              <input
                name="value"
                aria-label={request.envVar || 'Private value'}
                type="password"
                autoComplete="off"
                disabled={busy}
              />
            </label>
          ) : (
            request.questions.map((question) => (
              <fieldset key={question.qid} disabled={busy}>
                <legend>{question.question}</legend>
                {question.choices?.map((choice) => (
                  <label className="request-choice" key={choice}>
                    <input
                      type={question.multi_select ? 'checkbox' : 'radio'}
                      name={`choice-${question.qid}`}
                      value={choice}
                    />
                    {choice}
                  </label>
                ))}
                <label className="request-custom">
                  {question.choices?.length ? 'Or type your answer' : 'Your answer'}
                  <textarea name={`custom-${question.qid}`} rows={2} />
                </label>
              </fieldset>
            ))
          )}
          {request.kind === 'secret' && (
            <p className="request-note">
              Sent privately to this Bot’s runtime. It is not added to chat or activity.
            </p>
          )}
          <div className="request-actions">
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void answer(
                  request.kind === 'secret'
                    ? { kind: 'secret', value: '' }
                    : {
                        kind: 'clarify',
                        answers: Object.fromEntries(request.questions.map((q) => [q.qid, ''])),
                      },
                )
              }
            >
              Skip
            </button>
            <button className="primary" disabled={busy}>
              {busy ? 'Sending…' : request.kind === 'secret' ? 'Send privately' : 'Send answer'}
            </button>
          </div>
        </form>
      )}
      {error && (
        <p role="alert" className="request-error">
          {error}
        </p>
      )}
    </section>
  );
}
