import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { KeychainAccess, SecureStorage, StorageError } from '@aparajita/capacitor-secure-storage';
import { z } from 'zod';
export const connectionSchema = z.object({
  url: z.string(),
  token: z.string(),
  deviceId: z.string(),
  expiresAt: z.number(),
});
export type Connection = z.infer<typeof connectionSchema>;
const storageKey = 'hermes-host-v1';
export function hostOrigin(value: string) {
  const url = new URL(value.trim());
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw new Error('Enter an HTTPS host address without a path, password or query.');
  return url.origin;
}
export async function restoreConnection(): Promise<Connection | undefined> {
  if (!Capacitor.isNativePlatform()) return undefined;
  const value = await SecureStorage.get(storageKey);
  if (value === null) return undefined;
  const parsed = connectionSchema.parse(value);
  hostOrigin(parsed.url);
  return parsed;
}
export async function saveConnection(connection?: Connection) {
  // Browser acceptance uses memory only. Never fall back to localStorage for a token.
  if (!Capacitor.isNativePlatform()) return;
  if (connection) {
    await SecureStorage.setSynchronize(false);
    await SecureStorage.setDefaultKeychainAccess(KeychainAccess.whenUnlockedThisDeviceOnly);
    await SecureStorage.set(storageKey, connection);
  } else await SecureStorage.remove(storageKey);
}
export class AccessRevoked extends Error {}
export async function requestHost(
  url: string,
  route: string,
  body?: unknown,
  method?: string,
  token?: string,
) {
  const response = await CapacitorHttp.request({
    url: `${hostOrigin(url)}${route}`,
    method: method || (body === undefined ? 'GET' : 'POST'),
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { data: body }),
    responseType: 'json',
    connectTimeout: 10_000,
    readTimeout: 35_000,
    disableRedirects: true,
  });
  if (response.status < 200 || response.status >= 300) {
    const message = z.object({ error: z.string() }).safeParse(response.data);
    const text = message.success ? message.data.error : `Host request failed (${response.status}).`;
    if (response.status === 401 && token) throw new AccessRevoked(text);
    throw new Error(text);
  }
  return response.data as unknown;
}
export async function pair(url: string, code: string, name: string) {
  const origin = hostOrigin(url);
  const result = z
    .object({ token: z.string(), deviceId: z.string(), expiresAt: z.number() })
    .parse(await requestHost(origin, '/mobile/pair', { code: code.trim(), name }));
  const connection = { url: origin, ...result };
  try {
    await saveConnection(connection);
  } catch (error) {
    await requestHost(origin, '/mobile/device', undefined, 'DELETE', result.token).catch(() => {});
    const status =
      error instanceof StorageError
        ? ` (${error.code}${error.message.match(/\(-?\d+\)/)?.[0] || ''})`
        : '';
    throw new Error(`Secure device storage is unavailable${status}. Pairing was cancelled.`);
  }
  return connection;
}
export function mobileApi(connection: Connection, route: string, body?: unknown, method?: string) {
  return requestHost(connection.url, `/api${route}`, body, method, connection.token);
}
