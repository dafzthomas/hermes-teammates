import { z } from 'zod';

export async function api(url: string, body?: unknown, method?: string): Promise<unknown> {
  const response = await fetch(`/api${url}`, {
    method: method || (body === undefined ? 'GET' : 'POST'),
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data: unknown = await response.json();
  if (!response.ok) {
    const error = z.object({ error: z.string() }).safeParse(data);
    throw new Error(error.success ? error.data.error : `Request failed (${response.status})`);
  }
  return data;
}
