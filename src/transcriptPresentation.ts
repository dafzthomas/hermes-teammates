import type { Message } from './domain';

export type TranscriptAction = {
  kind: 'action';
  message: Message;
  label: string;
  icon: 'terminal' | 'tool' | 'handoff';
};

export type TranscriptEntry =
  | { kind: 'message'; message: Message }
  | { kind: 'incoming'; message: Message; sender: string; body: string }
  | { kind: 'routine'; message: Message; name: string; body: string }
  | { kind: 'attention'; message: Message; label: string }
  | TranscriptAction;

export type TranscriptBlock =
  | TranscriptEntry
  | { kind: 'activity'; id: string; sessionId: string; actions: TranscriptAction[] };

export function readableToolName(name: string | null): string {
  const label = name?.replace(/_/g, ' ').trim();
  return label ? label[0].toUpperCase() + label.slice(1) : 'Tool call';
}

function hasRecordedFailure(content: string): boolean {
  try {
    const output: unknown = JSON.parse(content);
    if (output && typeof output === 'object' && !Array.isArray(output)) {
      if ('error' in output && output.error) return true;
      if ('is_error' in output && output.is_error === true) return true;
      if ('success' in output && output.success === false) return true;
      if ('exit_code' in output && typeof output.exit_code === 'number' && output.exit_code !== 0)
        return true;
    }
  } catch {}
  return /(?:^|\n)\s*(?:error\b|failed\b|failure\b|traceback\b|permission denied\b|access denied\b|command (?:failed|denied)\b)/i.test(
    content,
  );
}

export function presentMessage(message: Message): TranscriptEntry {
  if (message.role === 'user') {
    const incoming = /^Message from 🤖 (.+? \(@[^)]+\)):\s*([\s\S]*)$/.exec(message.content);
    if (incoming) return { kind: 'incoming', message, sender: incoming[1], body: incoming[2] };
    const routine = /^\[Cronjob "([^"\n]+)" output[^\n]*\]\s*([\s\S]*)$/.exec(message.content);
    if (routine) return { kind: 'routine', message, name: routine[1], body: routine[2] };
  }
  if (message.role !== 'assistant' && message.content.startsWith('[IMPORTANT: Background process'))
    return hasRecordedFailure(message.content)
      ? { kind: 'attention', message, label: 'Bot handoff outcome' }
      : { kind: 'action', message, label: 'Bot handoff outcome', icon: 'handoff' };
  if (message.role !== 'tool') return { kind: 'message', message };
  const label = readableToolName(message.toolName);
  if (hasRecordedFailure(message.content)) return { kind: 'attention', message, label };
  if (message.toolName === 'message_agent')
    return { kind: 'action', message, label: 'Bot handoff · dispatch status', icon: 'handoff' };
  return {
    kind: 'action',
    message,
    label,
    icon: message.toolName === 'terminal' ? 'terminal' : 'tool',
  };
}

export function groupTranscript(messages: readonly Message[]): TranscriptBlock[] {
  const blocks: TranscriptBlock[] = [];
  for (const message of messages) {
    const entry = presentMessage(message);
    if (entry.kind !== 'action' || entry.icon === 'handoff') {
      blocks.push(entry);
      continue;
    }
    const previous = blocks.at(-1);
    if (previous?.kind === 'activity' && previous.sessionId === message.sessionId) {
      previous.actions.push(entry);
    } else {
      blocks.push({
        kind: 'activity',
        id: message.id,
        sessionId: message.sessionId,
        actions: [entry],
      });
    }
  }
  return blocks;
}

export function activityLabel(count: number): string {
  return `${count} tool ${count === 1 ? 'call' : 'calls'} recorded`;
}
