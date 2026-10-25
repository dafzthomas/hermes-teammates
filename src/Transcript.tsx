import { Activity, ChevronRight, Clock3, Terminal, Users, Wrench } from 'lucide-react';
import Markdown from 'react-markdown';
import type { Message } from './domain';
import { activityLabel, groupTranscript, type TranscriptAction } from './transcriptPresentation';
import './transcript.css';

function ActionRow({
  action,
  attention = false,
}: {
  action: TranscriptAction;
  attention?: boolean;
}) {
  const Icon = action.icon === 'terminal' ? Terminal : action.icon === 'handoff' ? Users : Wrench;
  return (
    <details
      className={`transcript-action ${action.icon === 'handoff' ? 'handoff-action' : ''} ${attention ? 'transcript-attention' : ''}`}
    >
      <summary>
        <Icon size={15} aria-hidden="true" />
        <span className="transcript-action-label">{action.label}</span>
        <ChevronRight className="transcript-chevron" size={14} aria-hidden="true" />
      </summary>
      <pre className="transcript-raw">{action.message.content}</pre>
    </details>
  );
}

export function Transcript({
  messages,
  botName,
  surface,
}: {
  messages: readonly Message[];
  botName: string;
  surface: 'desktop' | 'mobile';
}) {
  return groupTranscript(messages).map((block) => {
    if (block.kind === 'activity')
      return (
        <details className="transcript-activity" key={block.id}>
          <summary>
            <Activity size={15} aria-hidden="true" />
            <span>{activityLabel(block.actions.length)}</span>
            <ChevronRight className="transcript-chevron" size={14} aria-hidden="true" />
          </summary>
          <div className="transcript-actions">
            {block.actions.map((action) => (
              <ActionRow key={action.message.id} action={action} />
            ))}
          </div>
        </details>
      );
    const m = block.message;
    if (block.kind === 'action') return <ActionRow key={m.id} action={block} />;
    if (block.kind === 'attention')
      return (
        <ActionRow
          key={m.id}
          attention
          action={{
            kind: 'action',
            message: m,
            label: `${block.label} · review result`,
            icon:
              m.toolName === 'terminal'
                ? 'terminal'
                : m.toolName === 'message_agent' || block.label === 'Bot handoff outcome'
                  ? 'handoff'
                  : 'tool',
          }}
        />
      );
    if (block.kind === 'routine')
      return (
        <details className="transcript-action routine-delivery" key={m.id}>
          <summary>
            <Clock3 size={15} aria-hidden="true" />
            <span className="transcript-action-label">Routine · {block.name}</span>
            <ChevronRight className="transcript-chevron" size={14} aria-hidden="true" />
          </summary>
          <div className="routine-output">
            <Markdown>{block.body}</Markdown>
          </div>
        </details>
      );
    const incoming = block.kind === 'incoming';
    const fromUser = m.role === 'user' && !incoming;
    const author = incoming
      ? block.sender
      : fromUser
        ? 'You'
        : m.role === 'assistant'
          ? botName
          : m.role.replace(/_/g, ' ');
    const content = incoming ? block.body : m.content;
    const attribution = (
      <>
        {incoming && <Users size={13} aria-hidden="true" />}
        {author}
      </>
    );
    return surface === 'mobile' ? (
      <article className={`message ${fromUser ? 'from-user' : ''}`} key={m.id}>
        <small>{attribution}</small>
        <Markdown>{content}</Markdown>
      </article>
    ) : (
      <div className={`message-row ${fromUser ? 'user' : 'assistant'}`} key={m.id}>
        <div className="message-meta">
          {attribution}
          <time>
            {new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </time>
        </div>
        <div className="bubble">
          <Markdown>{content}</Markdown>
        </div>
      </div>
    );
  });
}
