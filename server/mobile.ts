import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';

const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const deviceSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  hash: z.string(),
  createdAt: z.number(),
  expiresAt: z.number(),
});
type Device = z.infer<typeof deviceSchema>;
const lifetime = 90 * 24 * 60 * 60 * 1000;

/** Separate capability store. Never write pairing codes or bearer tokens to disk. */
export class MobileAccess {
  private devices: Device[];
  private pairing?: { hash: string; expiresAt: number };
  readonly file: string;
  constructor(
    root: string,
    private now = () => Date.now(),
  ) {
    this.file = path.join(root, 'mobile-devices.json');
    this.devices = fs.existsSync(this.file)
      ? z.array(deviceSchema).parse(JSON.parse(fs.readFileSync(this.file, 'utf8')))
      : [];
  }
  private save() {
    const temp = `${this.file}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(this.devices), { mode: 0o600 });
    fs.renameSync(temp, this.file);
  }
  list() {
    return this.devices.map(({ hash: _hash, ...device }) => device);
  }
  createPairing() {
    const code = randomBytes(24).toString('base64url');
    this.pairing = { hash: digest(code), expiresAt: this.now() + 5 * 60 * 1000 };
    return { code, expiresAt: this.pairing.expiresAt };
  }
  pair(code: string, name: string) {
    if (!this.pairing || this.pairing.expiresAt <= this.now() || this.pairing.hash !== digest(code))
      return null;
    const token = randomBytes(32).toString('base64url');
    const device: Device = {
      id: randomUUID(),
      name,
      hash: digest(token),
      createdAt: this.now(),
      expiresAt: this.now() + lifetime,
    };
    this.devices = this.devices.filter((d) => d.expiresAt > this.now());
    if (this.devices.length >= 32) throw new Error('Revoke an old device before pairing another.');
    this.devices.push(device);
    this.save();
    this.pairing = undefined;
    return { token, deviceId: device.id, expiresAt: device.expiresAt };
  }
  authenticate(authorization?: string) {
    if (!authorization || !/^Bearer [\w-]{43}$/.test(authorization)) return undefined;
    const hash = digest(authorization.slice(7));
    return this.devices.find((d) => d.hash === hash && d.expiresAt > this.now());
  }
  revoke(id: string) {
    this.devices = this.devices.filter((d) => d.id !== id);
    this.save();
  }
}

/** Explicit API subset: no internal hook/capability, VM, vault-management or arbitrary proxy access. */
export function mobileRoute(method: string, url: string) {
  if (!url.startsWith('/api/')) return false;
  const pathname = new URL(url, 'https://mobile.invalid').pathname;
  if (/%|\\|\/\//.test(pathname)) return false;
  if (method === 'GET') return /^\/api\/(state|bots\/[\w-]+|groups\/[\w-]+)$/.test(pathname);
  if (method === 'PUT')
    return /^\/api\/bots\/[\w-]+(?:\/memory|\/secrets\/[A-Z_][A-Z0-9_]*|\/routines\/[\w-]+\/preference)?$/.test(
      pathname,
    );
  if (method === 'DELETE') return /^\/api\/bots\/[\w-]+\/secrets\/[A-Z_][A-Z0-9_]*$/.test(pathname);
  if (method !== 'POST') return false;
  return /^\/api\/(bots|groups|bots\/[\w-]+\/(messages|read|stop|steer|requests\/[\w-]+|routines(?:\/[\w-]+\/(pause|resume|remove))?)|groups\/[\w-]+\/(messages|read))$/.test(
    pathname,
  );
}

export function createMobileGateway(access: MobileAccess, backendUrl: string, publicUrl: string) {
  const origin = new URL(publicUrl);
  if (
    origin.protocol !== 'https:' ||
    origin.pathname !== '/' ||
    origin.search ||
    origin.hash ||
    origin.username ||
    origin.password
  )
    throw new Error('TEAMMATES_MOBILE_URL must be an HTTPS origin without a path or credentials.');
  const upstream = new URL(backendUrl);
  if (upstream.protocol !== 'http:' || upstream.hostname !== '127.0.0.1')
    throw new Error('Mobile upstream must be the loopback backend.');
  const app = express();
  app.disable('x-powered-by');
  const attempts = new Map<string, { count: number; expiresAt: number }>();
  app.use((req, res, next) => {
    res.set({
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Strict-Transport-Security': 'max-age=31536000',
      'Referrer-Policy': 'no-referrer',
    });
    if (
      req.headers.host !== origin.host ||
      req.headers.origin ||
      req.headers['sec-fetch-site'] === 'cross-site'
    )
      return res.status(403).json({ error: 'Native mobile requests only.' });
    next();
  });
  app.use(express.json({ limit: '512kb' }));
  app.post('/mobile/pair', (req, res) => {
    const now = Date.now();
    for (const [key, value] of attempts) if (value.expiresAt <= now) attempts.delete(key);
    // Global bound as well as per-address rate limiting. Do not trust forwarded addresses.
    const ip = req.socket.remoteAddress || 'unknown';
    const attempt = attempts.get(ip) || { count: 0, expiresAt: now + 60_000 };
    if (attempts.size >= 1000 || ++attempt.count > 10)
      return res.status(429).json({ error: 'Too many pairing attempts. Wait a minute.' });
    attempts.set(ip, attempt);
    const { code, name } = z
      .object({ code: z.string().min(1).max(100), name: z.string().trim().min(1).max(60) })
      .parse(req.body);
    const paired = access.pair(code, name);
    return paired
      ? res.json(paired)
      : res
          .status(401)
          .json({ error: 'Pairing code is invalid or expired. Create a new code on the host.' });
  });
  app.use((req, res, next) => {
    const device = access.authenticate(req.headers.authorization);
    if (!device)
      return res
        .status(401)
        .json({ error: 'Device access expired or was revoked. Pair again on the host.' });
    if (req.method === 'DELETE' && req.path === '/mobile/device') {
      access.revoke(device.id);
      return res.json({ ok: true });
    }
    next();
  });
  app.use(async (req, res) => {
    if (!mobileRoute(req.method, req.originalUrl))
      return res.status(404).json({ error: 'Mobile endpoint not available.' });
    const response = await fetch(`${upstream.origin}${req.originalUrl}`, {
      method: req.method,
      headers: { 'Content-Type': 'application/json' },
      ...(req.method === 'GET' ? {} : { body: JSON.stringify(req.body || {}) }),
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
    });
    res
      .status(response.status)
      .type('application/json')
      .send(await response.text());
  });
  app.use(
    (error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(error instanceof z.ZodError ? 400 : 502).json({
        error:
          error instanceof z.ZodError
            ? 'Invalid mobile request.'
            : 'Host request failed. Check the backend on the host.',
      });
    },
  );
  return app;
}

export function startMobileGateway(access: MobileAccess, backendUrl: string) {
  const publicUrl = process.env.TEAMMATES_MOBILE_URL;
  if (!publicUrl) return undefined;
  const cert = process.env.TEAMMATES_MOBILE_TLS_CERT;
  const key = process.env.TEAMMATES_MOBILE_TLS_KEY;
  if (!cert || !key)
    throw new Error('Mobile HTTPS needs TEAMMATES_MOBILE_TLS_CERT and TEAMMATES_MOBILE_TLS_KEY.');
  const app = createMobileGateway(access, backendUrl, publicUrl);
  const server = https.createServer(
    { cert: fs.readFileSync(cert), key: fs.readFileSync(key), minVersion: 'TLSv1.2' },
    app,
  );
  server.requestTimeout = 35_000;
  server.listen(
    Number(process.env.TEAMMATES_MOBILE_PORT || 4311),
    process.env.TEAMMATES_MOBILE_BIND || '127.0.0.1',
  );
  return server;
}
