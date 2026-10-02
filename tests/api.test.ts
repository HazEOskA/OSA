import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import type { IncomingMessage } from 'node:http';
import { SqliteStore } from '../packages/store/src/sqlite.js';
import { Kernel } from '../packages/kernel/src/service.js';
import { createApi } from '../apps/api/src/server.js';
import { Worker } from '../packages/runtime/src/worker.js';
import { createEngines } from '../packages/engines/src/index.js';
import { OsaClient } from '../packages/sdk/src/index.js';
import type { Mission, Run } from '../packages/kernel/src/contracts.js';
import { Auth } from '../apps/api/src/auth.js';
import type { IdentityConfig } from '../apps/api/src/auth.js';
async function fixture(
  fn: (
    url: string,
    k: Kernel,
    worker: Worker,
    ownerToken: string,
  ) => Promise<void>,
) {
  const s = new SqliteStore(':memory:'),
    k = new Kernel(s),
    worker = new Worker(k, createEngines(k), 'http-worker');
  const ownerToken = 'fixture-owner-alpha',
    hash = (t: string) => createHash('sha256').update(t).digest('hex');
  const server = createApi(k, {
    publicUrl: 'http://127.0.0.1:3000',
    identities: [
      {
        tenantId: 'alpha',
        subject: 'osa',
        role: 'owner',
        tokenHash: hash(ownerToken),
      },
      {
        tenantId: 'beta',
        subject: 'other',
        role: 'owner',
        tokenHash: hash('fixture-beta'),
      },
      {
        tenantId: 'alpha',
        subject: 'reader',
        role: 'reader',
        tokenHash: hash('fixture-reader'),
      },
    ],
    worker,
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('address');
  try {
    await fn('http://127.0.0.1:' + address.port, k, worker, ownerToken);
  } finally {
    await worker.stop();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await s.close();
  }
}
test('real HTTP + SDK: mission → syntax execution → bound proof → closure', () =>
  fixture(async (url, k, worker, token) => {
    const client = new OsaClient(url, token);
    const mission = await client.createMission('HTTP syntax proof');
    const step = await client.request<Mission>('/api/missions/' + mission.id, {
      method: 'PATCH',
      body: { version: mission.version, addStep: 'Verify parser' },
    });
    const run = await client.enqueue(
      'verify-syntax',
      { context: 'export const answer = 42;' },
      'http-flow',
      mission.id,
    );
    assert.equal(run.status, 'queued');
    await worker.once();
    const finished = await client.getRun(run.id);
    assert.equal(finished.status, 'succeeded');
    const report = await k.report({
      tenantId: 'alpha',
      subject: 'osa',
      role: 'owner',
    });
    const proof = report.evidence.find((e) => e.runId === run.id)!;
    const verified = await client.verifyEvidence(proof.id);
    assert.equal(verified.executionVerified, true);
    const done = await client.request<Mission>('/api/missions/' + mission.id, {
      method: 'PATCH',
      body: {
        version: step.version,
        stepId: step.steps[0]!.id,
        done: true,
        status: 'completed',
        requireVerification: true,
      },
    });
    assert.equal(done.status, 'completed');
    assert.equal((await client.getMission(mission.id)).status, 'completed');
  }));
test('anonymous, reader, other tenant and hostile Origin cannot mutate private state', () =>
  fixture(async (url, _k, _worker, token) => {
    assert.equal((await fetch(url + '/api/bootstrap')).status, 401);
    const owner = new OsaClient(url, token),
      mission = await owner.createMission('private');
    const reader = new OsaClient(url, 'fixture-reader');
    await assert.rejects(reader.createMission('forbidden'), /FORBIDDEN/);
    const other = new OsaClient(url, 'fixture-beta');
    await assert.rejects(other.getMission(mission.id), /NOT_FOUND/);
    const hostile = await fetch(url + '/api/missions', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
        Origin: 'https://attacker.invalid',
      },
      body: JSON.stringify({ title: 'hostile' }),
    });
    assert.equal(hostile.status, 403);
    const invalid = await fetch(url + '/api/missions', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
      },
      body: 'invalid json',
    });
    assert.equal(invalid.status, 400);
  }));
test('browser login uses HttpOnly session, requires CSRF and revokes on logout', () =>
  fixture(async (url, _k, _worker, token) => {
    const login = await fetch(url + '/api/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://127.0.0.1:3000',
      },
      body: JSON.stringify({ token }),
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie')!;
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);
    const key = cookie.split(';')[0]!;
    const body = (await login.json()) as { csrf: string };
    const headers = { 'Content-Type': 'application/json', Cookie: key };
    assert.equal(
      (
        await fetch(url + '/api/missions', {
          method: 'POST',
          headers,
          body: JSON.stringify({ title: 'no csrf' }),
        })
      ).status,
      403,
    );
    const allowed = await fetch(url + '/api/missions', {
      method: 'POST',
      headers: { ...headers, 'X-OSA-CSRF': body.csrf },
      body: JSON.stringify({ title: 'with csrf' }),
    });
    assert.equal(allowed.status, 201);
    assert.equal(
      (
        await fetch(url + '/api/auth/logout', {
          method: 'POST',
          headers: { ...headers, 'X-OSA-CSRF': body.csrf },
          body: '{}',
        })
      ).status,
      200,
    );
    assert.equal(
      (await fetch(url + '/api/bootstrap', { headers: { Cookie: key } }))
        .status,
      401,
    );
  }));
test('disabled AI is an explicit durable failure, not a successful template response', () =>
  fixture(async (url, _k, worker, token) => {
    const client = new OsaClient(url, token);
    const run = await client.enqueue(
      'profile',
      { context: 'My project facts' },
      'provider-disabled',
    );
    await worker.once();
    const state = await client.getRun(run.id);
    assert.equal(state.status, 'failed');
    assert.match(state.error || '', /PROVIDER_NOT_CONFIGURED/);
    assert.equal(state.output, undefined);
  }));
test('token rotation revokes existing sessions and policy changes update roles', async () => {
  const store = new SqliteStore(':memory:');
  const hash = (value: string) =>
    createHash('sha256').update(value).digest('hex');
  const config: IdentityConfig = {
    tenantId: 'alpha',
    subject: 'owner',
    role: 'owner',
    tokenHash: hash('fixture-old-token'),
  };
  const auth = new Auth(store, [config]);
  try {
    const { key } = await auth.login('fixture-old-token');
    const req = {
      headers: { cookie: 'osa_session=' + key },
    } as IncomingMessage;
    assert.equal((await auth.resolve(req)).identity.role, 'owner');
    config.role = 'reader';
    assert.equal((await auth.resolve(req)).identity.role, 'reader');
    config.tokenHash = hash('fixture-new-token');
    await assert.rejects(auth.resolve(req), { code: 'UNAUTHORIZED' });
    assert.equal(auth.token('fixture-old-token'), undefined);
    const fresh = await auth.login('fixture-new-token');
    assert.equal(
      (
        await auth.resolve({
          headers: { cookie: 'osa_session=' + fresh.key },
        } as IncomingMessage)
      ).identity.role,
      'reader',
    );
  } finally {
    await store.close();
  }
});
