import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Kernel } from '../../../packages/kernel/src/service.js';
import { Organizer } from '../../../packages/kernel/src/organizer.js';
import { OsaError } from '../../../packages/kernel/src/contracts.js';
import type {
  Entity,
  Evidence,
  Identity,
  Kind,
  LearningSession,
  Mission,
  Run,
} from '../../../packages/kernel/src/contracts.js';
import {
  digest,
  object,
  requireWrite,
  text,
} from '../../../packages/kernel/src/guards.js';
import { catalog } from '../../../packages/engines/src/catalog.js';
import { OpenAIAdapter } from '../../../packages/adapters/src/openai.js';
import type { Worker } from '../../../packages/runtime/src/worker.js';
import { Auth } from './auth.js';
import type { IdentityConfig } from './auth.js';
export interface ServerConfig {
  publicUrl: string;
  identities: IdentityConfig[];
  staticDir?: string;
  worker?: Worker;
}
export function createApi(kernel: Kernel, config: ServerConfig) {
  const organizer = new Organizer(kernel.store, kernel.now);
  const auth = new Auth(kernel.store, config.identities);
  const publicOrigin = new URL(config.publicUrl).origin;
  const secure = publicOrigin.startsWith('https:');
  const provider = new OpenAIAdapter();
  const limiters = new Map<string, { count: number; reset: number }>();
  const send = (
    res: http.ServerResponse,
    status: number,
    data: unknown,
    headers: Record<string, string> = {},
  ) => {
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...headers,
    });
    res.end(JSON.stringify(data));
  };
  async function body(req: http.IncomingMessage, limit = 100000) {
    if (!req.headers['content-type']?.startsWith('application/json'))
      throw new OsaError(
        'CONTENT_TYPE',
        'Wymagany Content-Type application/json.',
        415,
      );
    const chunks: Buffer[] = [];
    let n = 0;
    for await (const chunk of req) {
      n += chunk.length;
      if (n > limit)
        throw new OsaError(
          'PAYLOAD_TOO_LARGE',
          'Żądanie przekracza limit.',
          413,
        );
      chunks.push(chunk);
    }
    try {
      return object(JSON.parse(Buffer.concat(chunks).toString()));
    } catch (e) {
      if (e instanceof OsaError) throw e;
      throw new OsaError('INVALID_JSON', 'Nieprawidłowy JSON.');
    }
  }
  function rate(key: string, max: number) {
    const now = Date.now();
    let item = limiters.get(key);
    if (!item || item.reset < now) {
      item = { count: 0, reset: now + 60000 };
      limiters.set(key, item);
    }
    item.count++;
    if (item.count > max)
      throw new OsaError('RATE_LIMIT', 'Limit wywołań. Spróbuj później.', 429);
    if (limiters.size > 10000)
      for (const [k, v] of limiters) if (v.reset < now) limiters.delete(k);
  }
  return http.createServer(async (req, res) => {
    const requestId = randomUUID();
    res.setHeader('X-Request-Id', requestId);
    try {
      const url = new URL(req.url || '/', 'http://osa');
      const path = url.pathname;
      const method = req.method || 'GET';
      if (path === '/health/live' && method === 'GET')
        return send(res, 200, { status: 'ok', service: 'osa-api' });
      if (path === '/health/ready' && method === 'GET') {
        await kernel.store.read((tx) => tx.count('__health__', 'mission'));
        return send(res, 200, { status: 'ready', store: kernel.store.kind });
      }
      // Origin checks precede parsing for all browser mutations, including login.
      if (
        !['GET', 'HEAD', 'OPTIONS'].includes(method) &&
        req.headers.origin &&
        req.headers.origin !== publicOrigin
      )
        throw new OsaError(
          'ORIGIN_DENIED',
          'Niedozwolone źródło żądania.',
          403,
        );
      if (path === '/api/auth/login' && method === 'POST') {
        rate('login:' + req.socket.remoteAddress, 10);
        const b = await body(req);
        const { key, session } = await auth.login(text(b.token, 'Token', 1000));
        return send(
          res,
          200,
          { identity: session.identity, csrf: session.csrf },
          {
            'Set-Cookie': `osa_session=${key}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${secure ? '; Secure' : ''}`,
          },
        );
      }
      if (path.startsWith('/api/')) {
        const { identity, session } = await auth.resolve(req);
        rate('api:' + identity.tenantId, 300);
        if (
          !['GET', 'HEAD'].includes(method) &&
          session &&
          req.headers['x-osa-csrf'] !== session.csrf
        )
          throw new OsaError(
            'CSRF_DENIED',
            'Brak poprawnego tokenu CSRF.',
            403,
          );
        if (path === '/api/auth/me' && method === 'GET')
          return send(res, 200, { identity, csrf: session?.csrf || null });
        if (path === '/api/auth/logout' && method === 'POST') {
          await auth.logout(session);
          return send(
            res,
            200,
            { ok: true },
            {
              'Set-Cookie': `osa_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure ? '; Secure' : ''}`,
            },
          );
        }
        if (path === '/api/organizer' && method === 'GET')
          return send(res, 200, await organizer.snapshot(identity, url.searchParams.get('date') || undefined));
        if (path === '/api/organizer' && method === 'POST')
          return send(res, 200, await organizer.act(identity, await body(req)));
        if (path === '/api/organizer/inbox' && method === 'GET')
          return send(res, 200, await organizer.inbox(identity, url.searchParams.get('cursor') || undefined, url.searchParams.get('status') || 'inbox'));
        if (path === '/api/bootstrap' && method === 'GET') {
          const report = await kernel.report(identity);
          const [approvals, schedules, learning] = await Promise.all(
            ['approval', 'schedule', 'learning'].map((kind) =>
              kernel.store.read((tx) =>
                tx.list(identity.tenantId, kind as Kind, 50),
              ),
            ),
          );
          return send(res, 200, {
            identity,
            report,
            approvals: approvals?.items || [],
            schedules: schedules?.items || [],
            learning: learning?.items || [],
            engines: catalog.map(({ instruction, ...e }) => e),
            integrations: [
              {
                id: 'kernel',
                status: 'ready',
                detail: 'Własny kernel, API i trwały magazyn',
              },
              {
                id: 'worker',
                status: config.worker ? 'ready' : 'external',
                detail: config.worker
                  ? 'Worker lokalny'
                  : 'Worker jako osobny proces; sprawdź wykonania',
              },
              {
                id: 'openai',
                status: provider.configured() ? 'configured' : 'not_configured',
                detail: 'Klucz i model w konfiguracji backendu',
              },
              {
                id: 'google',
                status: 'not_configured',
                detail:
                  'Wymaga wyboru Calendar / Drive / Gmail i zakresów OAuth',
              },
              {
                id: 'cloud',
                status: 'not_deployed',
                detail:
                  'Docker i PostgreSQL; docelowy dostawca nie jest wybrany',
              },
              {
                id: 'mcp',
                status: 'available',
                detail:
                  'Własny proces stdio; konfiguracja klienta w docs/MCP.md',
              },
            ],
          });
        }
        const kinds: Record<string, Kind> = {
          missions: 'mission',
          runs: 'run',
          evidence: 'evidence',
          approvals: 'approval',
          schedules: 'schedule',
          learning: 'learning',
          focus: 'focus',
        };
        const segments = path.split('/').filter(Boolean);
        const name = segments[1] || '',
          entityId = segments[2],
          action = segments[3];
        const kind = kinds[name];
        if (kind && method === 'GET' && !entityId) {
          return send(
            res,
            200,
            await kernel.store.read((tx) =>
              tx.list(
                identity.tenantId,
                kind,
                Math.min(200, Number(url.searchParams.get('limit')) || 50),
                url.searchParams.get('cursor') || undefined,
              ),
            ),
          );
        }
        if (kind && method === 'GET' && entityId && !action) {
          const found = await kernel.store.read((tx) =>
            tx.get(identity.tenantId, kind, entityId),
          );
          if (!found)
            throw new OsaError('NOT_FOUND', 'Nie znaleziono obiektu.', 404);
          return send(res, 200, found);
        }
        if (path === '/api/missions' && method === 'POST')
          return send(
            res,
            201,
            await kernel.createMission(identity, await body(req)),
          );
        if (name === 'missions' && entityId && method === 'PATCH')
          return send(
            res,
            200,
            await kernel.updateMission(identity, entityId, await body(req)),
          );
        if (path === '/api/runs' && method === 'POST') {
          rate('generate:' + identity.tenantId, 30);
          return send(
            res,
            202,
            await kernel.enqueue(identity, await body(req)),
          );
        }
        if (
          name === 'runs' &&
          entityId &&
          action === 'cancel' &&
          method === 'POST'
        ) {
          const run = await kernel.cancel(identity, entityId);
          config.worker?.abort(entityId);
          return send(res, 200, run);
        }
        if (
          name === 'runs' &&
          entityId &&
          action === 'retry' &&
          method === 'POST'
        )
          return send(res, 202, await kernel.retry(identity, entityId));
        if (path === '/api/evidence' && method === 'POST')
          return send(
            res,
            201,
            await kernel.addEvidence(identity, await body(req)),
          );
        if (
          name === 'evidence' &&
          entityId &&
          action === 'verify' &&
          method === 'GET'
        )
          return send(
            res,
            200,
            await kernel.verifyEvidence(identity, entityId),
          );
        if (path === '/api/approvals' && method === 'POST')
          return send(
            res,
            201,
            await kernel.requestApproval(identity, await body(req)),
          );
        if (
          name === 'approvals' &&
          entityId &&
          action === 'decide' &&
          method === 'POST'
        )
          return send(
            res,
            200,
            await kernel.decideApproval(identity, entityId, await body(req)),
          );
        if (path === '/api/schedules' && method === 'POST')
          return send(
            res,
            201,
            await kernel.createSchedule(identity, await body(req)),
          );
        if (name === 'schedules' && entityId && method === 'PATCH') {
          const b = await body(req);
          if (typeof b.enabled !== 'boolean')
            throw new OsaError('INVALID_INPUT', 'Wymagany stan enabled.');
          return send(
            res,
            200,
            await kernel.toggleSchedule(identity, entityId, b.enabled),
          );
        }
        if (path === '/api/learning' && method === 'POST')
          return send(
            res,
            201,
            await kernel.createLearning(identity, await body(req)),
          );
        if (
          name === 'learning' &&
          entityId &&
          action === 'observe' &&
          method === 'POST'
        )
          return send(
            res,
            200,
            await kernel.observe(identity, entityId, await body(req)),
          );
        if (
          name === 'learning' &&
          entityId &&
          action === 'finish' &&
          method === 'POST'
        )
          return send(
            res,
            202,
            await kernel.finishLearning(identity, entityId),
          );
        if (
          name === 'learning' &&
          entityId &&
          action === 'frame' &&
          method === 'POST'
        ) {
          requireWrite(identity);
          rate('frame:' + identity.tenantId, 10);
          const s = await kernel.store.read((tx) =>
            tx.get<LearningSession>(identity.tenantId, 'learning', entityId),
          );
          if (!s) throw new OsaError('NOT_FOUND', 'Nie znaleziono sesji.', 404);
          if (s.exam || s.status !== 'active')
            throw new OsaError(
              'EXAM_ACTIVE',
              'Analiza kadru jest dostępna tylko dla aktywnej sesji nauki.',
              409,
            );
          const b = await body(req),
            image = text(b.image, 'Kadr JPEG', 64000);
          if (!/^[a-zA-Z0-9+/=]+$/.test(image))
            throw new OsaError('INVALID_IMAGE', 'Nieprawidłowy kadr.');
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 30000);
          req.on('aborted', () => controller.abort());
          try {
            const result = await provider.generate({
              instruction:
                'Opisz obserwowany ekran nauki po polsku. Oddziel fakty i hipotezy. Nie wnioskuj o niewiedzy z pauzy. Nie rozwiązuj trwającego ocenianego egzaminu; jeśli ekran jest egzaminem, zalecaj naukę po nim.',
              input:
                'Cel nauki: ' +
                s.title +
                '\nKontekst: ' +
                text(b.context, 'Kontekst', 3000, true),
              image,
              signal: controller.signal,
            });
            await kernel.observe(identity, entityId, {
              text:
                'Analiza pojedynczego kadru AI (draft): ' +
                result.text.slice(0, 1900),
            });
            return send(res, 200, {
              text: result.text,
              producer: result.producer,
              verdict: 'draft',
              imageStored: false,
            });
          } finally {
            clearTimeout(timeout);
          }
        }
        if (path === '/api/focus' && method === 'POST')
          return send(
            res,
            201,
            await kernel.saveFocus(identity, await body(req)),
          );
        if (path === '/api/report' && method === 'GET')
          return send(
            res,
            200,
            await kernel.report(
              identity,
              url.searchParams.get('date') || undefined,
            ),
          );
        if (path === '/api/events' && method === 'GET')
          return send(
            res,
            200,
            await kernel.audit(
              identity,
              Math.max(0, Number(url.searchParams.get('after')) || 0),
            ),
          );
        if (path === '/api/metrics' && method === 'GET') {
          const r = await kernel.report(identity);
          return send(res, 200, {
            store: kernel.store.kind,
            coverage: r.coverage,
            queued: r.runs.filter((x) => x.status === 'queued').length,
            running: r.runs.filter((x) => x.status === 'running').length,
            failed: r.runs.filter((x) => x.status === 'failed').length,
          });
        }
        throw new OsaError('NOT_FOUND', 'Nieznany endpoint.', 404);
      }
      if (config.staticDir && method === 'GET') {
        const root = resolve(config.staticDir);
        let file = resolve(root, '.' + decodeURIComponent(path));
        if (file !== root && !file.startsWith(root + sep))
          throw new OsaError('FORBIDDEN', 'Niedozwolona ścieżka.', 403);
        try {
          if (!(await stat(file)).isFile()) file = resolve(root, 'index.html');
        } catch {
          if (extname(path))
            throw new OsaError('NOT_FOUND', 'Nie znaleziono pliku.', 404);
          file = resolve(root, 'index.html');
        }
        const type: Record<string, string> = {
          '.html': 'text/html',
          '.js': 'text/javascript',
          '.css': 'text/css',
          '.svg': 'image/svg+xml',
          '.png': 'image/png',
          '.ico': 'image/x-icon',
        };
        const content = await readFile(file);
        res.writeHead(200, {
          'Content-Type':
            (type[extname(file)] || 'application/octet-stream') +
            '; charset=utf-8',
          'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy':
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; media-src 'self' blob:; object-src 'none'; frame-ancestors 'none'",
          'Referrer-Policy': 'same-origin',
          'Cache-Control':
            extname(file) === '.html' ? 'no-cache' : 'public, max-age=3600',
        });
        return res.end(content);
      }
      throw new OsaError('NOT_FOUND', 'Nie znaleziono zasobu.', 404);
    } catch (e) {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      const err =
        e instanceof OsaError
          ? e
          : new OsaError(
              'INTERNAL_ERROR',
              'Błąd serwera. Zachowaj identyfikator żądania.',
              500,
            );
      if (!(e instanceof OsaError))
        console.error(
          'OSA request failed',
          requestId,
          e instanceof Error ? e.name : 'unknown',
        );
      send(res, err.status, {
        error: { code: err.code, message: err.message, requestId },
      });
    }
  });
}
