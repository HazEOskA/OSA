import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SqliteStore } from '../packages/store/src/sqlite.js';
import { Kernel } from '../packages/kernel/src/service.js';
import { Worker } from '../packages/runtime/src/worker.js';
import { createEngines } from '../packages/engines/src/index.js';
import { nextDaily } from '../packages/kernel/src/guards.js';
import type {
  Identity,
  Run,
  Schedule,
} from '../packages/kernel/src/contracts.js';
const alice: Identity = { tenantId: 'alpha', subject: 'alice', role: 'owner' },
  bob: Identity = { tenantId: 'beta', subject: 'bob', role: 'owner' };
const result = {
  text: 'observed result',
  producer: 'test/real-engine',
  verdict: 'draft' as const,
  sources: [],
};
async function fixture(fn: (k: Kernel, s: SqliteStore) => Promise<void>) {
  const store = new SqliteStore(':memory:');
  try {
    await fn(new Kernel(store), store);
  } finally {
    await store.close();
  }
}
test('tenant isolation, optimistic mission versions and atomic audit', () =>
  fixture(async (k, s) => {
    const m = await k.createMission(alice, { title: 'Read function' });
    assert.equal(m.version, 1);
    assert.equal(
      await s.read((tx) => tx.get(bob.tenantId, 'mission', m.id)),
      undefined,
    );
    await assert.rejects(
      k.updateMission(bob, m.id, { version: 1, addStep: 'injected' }),
      /Nie znaleziono/,
    );
    await assert.rejects(
      k.updateMission(alice, m.id, { version: 0, addStep: 'stale' }),
      /Odśwież/,
    );
    const next = await k.updateMission(alice, m.id, {
      version: m.version,
      addStep: 'Trace return',
    });
    assert.equal(next.version, 2);
    const audit = await k.audit(alice);
    assert.equal(audit.valid, true);
    assert.equal(audit.events.length, 2);
    const before = await s.read((tx) => tx.count(alice.tenantId, 'mission'));
    await assert.rejects(
      s.transaction(async (tx) => {
        await tx.put('mission', { ...m, id: 'rolled-back', version: 0 }, 0);
        throw Error('abort');
      }),
      /abort/,
    );
    assert.equal(
      await s.read((tx) => tx.count(alice.tenantId, 'mission')),
      before,
    );
  }));
test('cannot promote pasted artifact into executed verification', () =>
  fixture(async (k) => {
    let m = await k.createMission(alice, { title: 'Finish safely' });
    m = await k.updateMission(alice, m.id, {
      version: m.version,
      addStep: 'Check code',
    });
    await assert.rejects(
      k.updateMission(alice, m.id, { version: m.version, status: 'completed' }),
      /wszystkie kroki/,
    );
    m = await k.updateMission(alice, m.id, {
      version: m.version,
      stepId: m.steps[0]!.id,
      done: true,
    });
    await assert.rejects(
      k.updateMission(alice, m.id, { version: m.version, status: 'completed' }),
      /artefakt/,
    );
    const proof = await k.addEvidence(alice, {
      missionId: m.id,
      content: 'I claim PASS',
      kind: 'verification',
      verdict: 'passed',
    });
    assert.equal(proof.kind, 'user-artifact');
    assert.equal(
      (await k.verifyEvidence(alice, proof.id)).executionVerified,
      false,
    );
    await assert.rejects(
      k.updateMission(alice, m.id, {
        version: m.version,
        status: 'completed',
        requireVerification: true,
      }),
      /niezależnego/,
    );
    await k.updateMission(alice, m.id, {
      version: m.version,
      status: 'completed',
    });
    await assert.rejects(
      k.updateMission(alice, m.id, {
        version: m.version + 1,
        addStep: 'rewrite',
      }),
      /niezmienna/,
    );
  }));
test('concurrent idempotent submissions create one run; changed input conflicts', () =>
  fixture(async (k, s) => {
    const input = {
      engine: 'prompt',
      input: { context: 'One goal' },
      idempotencyKey: 'same-request',
    };
    const runs = await Promise.all(
      Array.from({ length: 12 }, () => k.enqueue(alice, input)),
    );
    assert.equal(new Set(runs.map((r) => r.id)).size, 1);
    assert.equal(await s.read((tx) => tx.count(alice.tenantId, 'run')), 1);
    await assert.rejects(
      k.enqueue(alice, { ...input, input: { context: 'changed' } }),
      /inne wejście/,
    );
  }));
test('claim fencing rejects old worker after lease recovery', () =>
  fixture(async (_k, s) => {
    let now = 100000;
    const k = new Kernel(s, () => now);
    await k.enqueue(alice, {
      engine: 'prompt',
      input: { context: 'safe' },
      idempotencyKey: 'lease',
    });
    const first = (await k.claim('worker-a', 100))!;
    assert.equal(first.attempt, 1);
    assert.equal(await k.claim('worker-b', 100), undefined);
    now += 101;
    const recovered = (await k.claim('worker-b', 100))!;
    assert.equal(recovered.attempt, 2);
    assert.notEqual(recovered.claimToken, first.claimToken);
    assert.equal(await k.settle(first, result), false);
    assert.equal(await k.settle(recovered, result), true);
    const proof = (await s.read((tx) => tx.list(alice.tenantId, 'evidence')))
      .items;
    assert.equal(proof.length, 1);
  }));
test('cancelled run cannot settle; transient failure retries with bounded backoff', () =>
  fixture(async (k, s) => {
    const run = await k.enqueue(alice, {
      engine: 'prompt',
      input: { context: 'safe' },
      idempotencyKey: 'cancel',
    });
    const claim = (await k.claim('worker-a'))!;
    await k.cancel(alice, run.id);
    assert.equal(await k.settle(claim, result), false);
    assert.equal(await s.read((tx) => tx.count(alice.tenantId, 'evidence')), 0);
    const second = await k.enqueue(alice, {
      engine: 'prompt',
      input: { context: 'retry' },
      idempotencyKey: 'retry',
    });
    const c = (await k.claim('worker'))!;
    await k.settle(c, undefined, { message: 'temporary', retryable: true });
    const state = await s.read((tx) =>
      tx.get<Run>(alice.tenantId, 'run', second.id),
    );
    assert.equal(state?.status, 'queued');
    assert.ok(state!.availableAt > Date.now());
  }));
test('actual worker runs parser and produces integrity-bound verification', () =>
  fixture(async (k, s) => {
    const m = await k.createMission(alice, { title: 'Syntax proof' });
    const run = await k.enqueue(alice, {
      engine: 'verify-syntax',
      input: { context: 'export const add = (a,b) => a+b;' },
      missionId: m.id,
      idempotencyKey: 'syntax',
    });
    const worker = new Worker(k, createEngines(k), 'parser');
    assert.equal(await worker.once(), true);
    const saved = await s.read((tx) =>
      tx.get<Run>(alice.tenantId, 'run', run.id),
    );
    assert.equal(saved?.status, 'succeeded');
    assert.equal(saved?.output?.verdict, 'passed');
    const proof = (await s.read((tx) => tx.list(alice.tenantId, 'evidence')))
      .items[0]!;
    const verified = await k.verifyEvidence(alice, proof.id);
    assert.equal(verified.integrity, true);
    assert.equal(verified.binding, true);
    assert.equal(verified.executionVerified, true);
    const bad = await k.enqueue(alice, {
      engine: 'verify-syntax',
      input: { context: 'export const = ;' },
      idempotencyKey: 'bad-syntax',
    });
    await worker.once();
    assert.equal(
      (await s.read((tx) => tx.get<Run>(alice.tenantId, 'run', bad.id)))?.output
        ?.verdict,
      'failed',
    );
  }));
test('approval binds exact payload and only owner can decide', () =>
  fixture(async (k) => {
    const a = await k.requestApproval(alice, {
      action: 'mail.send',
      payload: { recipient: 'person@example.org', draft: 'hello' },
    });
    await assert.rejects(
      k.decideApproval({ ...alice, role: 'builder' }, a.id, {
        decision: 'approved',
        payloadDigest: a.payloadDigest,
      }),
      /właściciela/,
    );
    await assert.rejects(
      k.decideApproval(alice, a.id, {
        decision: 'approved',
        payloadDigest: 'changed',
      }),
      /payloadu/,
    );
    const approved = await k.decideApproval(alice, a.id, {
      decision: 'approved',
      payloadDigest: a.payloadDigest,
    });
    assert.equal(approved.status, 'approved');
    await assert.rejects(
      k.decideApproval(alice, a.id, {
        decision: 'rejected',
        payloadDigest: a.payloadDigest,
      }),
      /rozstrzygnięta/,
    );
  }));
test('persistent schedule triggers once across racing schedulers and handles local time', () =>
  fixture(async (_k, s) => {
    let now = Date.parse('2026-10-02T18:59:00Z');
    const k = new Kernel(s, () => now);
    const schedule = await k.createSchedule(alice, {
      title: 'Evening',
      hour: 21,
      minute: 0,
      timezone: 'Europe/Amsterdam',
    });
    assert.equal(schedule.nextRunAt, Date.parse('2026-10-02T19:00:00Z'));
    now = schedule.nextRunAt;
    const totals = await Promise.all([
      k.tickSchedules(),
      k.tickSchedules(),
      k.tickSchedules(),
    ]);
    assert.equal(
      totals.reduce((a, b) => a + b, 0),
      1,
    );
    assert.equal(await s.read((tx) => tx.count(alice.tenantId, 'run')), 1);
    const next = await s.read((tx) =>
      tx.get<Schedule>(alice.tenantId, 'schedule', schedule.id),
    );
    assert.ok(next!.nextRunAt > now);
    assert.ok(
      nextDaily(Date.parse('2026-10-25T00:00:00Z'), 2, 30, 'Europe/Amsterdam') >
        Date.parse('2026-10-25T00:00:00Z'),
    );
  }));
test('exam session and reader role blocked; observations remain factual', () =>
  fixture(async (k, s) => {
    await assert.rejects(
      k.createMission({ ...alice, role: 'reader' }, { title: 'blocked' }),
      /odczytu/,
    );
    const session = await k.createLearning(alice, {
      title: 'Practice async',
      exam: true,
    });
    await k.observe(alice, session.id, { text: 'My answer: returns Promise' });
    await assert.rejects(k.finishLearning(alice, session.id), /egzaminu/);
    await assert.rejects(
      k.enqueue(alice, {
        engine: 'certificate',
        input: { context: 'exam question', exam: true },
        idempotencyKey: 'exam',
      }),
      /egzaminu/,
    );
    assert.equal(await s.read((tx) => tx.count(alice.tenantId, 'run')), 0);
  }));
test('SQLite data and queued execution survive reopening process store', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'osa-durable-'));
  const path = join(directory, 'db.sqlite');
  let store = new SqliteStore(path);
  try {
    const k = new Kernel(store);
    const m = await k.createMission(alice, { title: 'durable' });
    const run = await k.enqueue(alice, {
      engine: 'prompt',
      input: { context: 'after restart' },
      idempotencyKey: 'durable',
    });
    await store.close();
    store = new SqliteStore(path);
    const reopened = new Kernel(store);
    assert.equal(
      (
        await store.read((tx) =>
          tx.get<MissionType>(alice.tenantId, 'mission', m.id),
        )
      )?.title,
      'durable',
    );
    await new Worker(reopened, createEngines(reopened), 'restart').once();
    assert.equal(
      (await store.read((tx) => tx.get<Run>(alice.tenantId, 'run', run.id)))
        ?.status,
      'succeeded',
    );
  } finally {
    await store.close();
    await rm(directory, { recursive: true, force: true });
  }
});
type MissionType = import('../packages/kernel/src/contracts.js').Mission;
