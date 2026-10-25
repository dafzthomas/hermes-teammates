import { z } from 'zod';
import { routinePreferenceSchema, type Routine, type RoutineOutput } from '../src/domain';

export function nativeRoutinePreference(routine: Routine) {
  const marker = z
    .object({ version: z.literal(1), preference: routinePreferenceSchema })
    .safeParse(routine.teammates_update_preference);
  if (!marker.success) return null;
  const preference = marker.data.preference;
  const deliver = preference === 'all' ? 'bot-chat' : 'local';
  const failure = preference === 'never' ? 'local' : 'bot-chat';
  return routine.deliver === deliver && routine.failure_deliver === failure ? preference : null;
}

// This is the persisted run-document envelope from Hermes cron.scheduler._run_doc_header.
export function parseRoutineOutput(
  content: string,
  routineId: string,
): { outcome: RoutineOutput['outcome']; response: string | null } {
  const header =
    /^# Cron Job: ([^\n]+)\n\n\*\*Job ID:\*\* ([^\n]+)\n\*\*Run Time:\*\* [^\n]+\n\*\*Schedule:\*\* [^\n]*\n\n## Prompt\n\n/.exec(
      content,
    );
  if (!header || header[2] !== routineId) return { outcome: 'unknown', response: null };
  const body = `\n\n${content.slice(header[0].length)}`;
  if (header[1].endsWith(' (FAILED)') && body.includes('\n\n## Error\n\n')) {
    return {
      outcome: /\n\n## Error\n\n```\n[\s\S]+\n```\n?$/.test(body) ? 'error' : 'unknown',
      response: null,
    };
  }
  const parts = body.split('\n\n## Response\n\n');
  if (parts.length !== 2) return { outcome: 'unknown', response: null };
  const response = parts[1].trim();
  if (
    !response ||
    response === '(No response generated)' ||
    /^\[CRON_FAILURE\](?:\n|$)/.test(response)
  )
    return { outcome: 'error', response };
  const markers = new Set([
    '[SILENT]',
    'SILENT',
    'NO_REPLY',
    'NO REPLY',
    '[静默]',
    '静默',
    '[沉默]',
    '沉默',
  ]);
  const lines = response.split('\n').map((line) => line.trim().toUpperCase());
  const isSilentMarker = (line: string) => {
    if (line.length > 64) return false;
    const normalized = line.replace(/\s+/g, ' ');
    let unwrapped = normalized;
    const edge = (character: string) => /\p{P}/u.test(character) && !'[]'.includes(character);
    while (unwrapped && edge(unwrapped[0])) unwrapped = unwrapped.slice(1);
    while (unwrapped && edge(unwrapped.at(-1)!)) unwrapped = unwrapped.slice(0, -1);
    unwrapped = unwrapped.trim();
    return markers.has(normalized) || markers.has(unwrapped);
  };
  if (
    ['[SILENT]', '[静默]', '[沉默]'].some((marker) => response.toUpperCase().startsWith(marker)) ||
    [lines[0], lines.at(-1)!].some(isSilentMarker)
  )
    return { outcome: 'silent', response };
  return { outcome: 'result', response };
}
