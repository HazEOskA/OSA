import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PostgresStore } from '../packages/store/src/postgres.js';
import { Kernel } from '../packages/kernel/src/service.js';
import { Worker } from '../packages/runtime/src/worker.js';
import { createEngines } from '../packages/engines/src/index.js';
import type { Identity, Run } from '../packages/kernel/src/contracts.js';
const url = process.env.OSA_TEST_DATABASE_URL;
test(
  'real PostgreSQL: independent connections preserve idempotency, claim fencing, evidence and rollback',
  { skip: !url },
  async () => {
    const a = new PostgresStore(url!),
      b = new PostgresStore(url!);
    await a.init();
    await b.init();
    let now = Date.now();
    const ka = new Kernel(a, () => now),
      kb = new Kernel(b, () => now),
      identity: Identity = {
        tenantId: 'pg-test-' + randomUUID(),
        subject: 'test',
        role: 'owner',
      };
    try {
      const payload = {
        engine: 'prompt',
        input: { context: 'Postgres transaction proof' },
        idempotencyKey: 'same',
      };
      const runs = await Promise.all([
        ka.enqueue(identity, payload),
        kb.enqueue(identity, payload),
        ka.enqueue(identity, payload),
        kb.enqueue(identity, payload),
      ]);
      assert.equal(new Set(runs.map((r) => r.id)).size, 1);
      const claims = await Promise.all([
        ka.claim('pool-a', 100),
        kb.claim('pool-b', 100),
      ]);
      const acquired = claims.filter(Boolean);
      assert.equal(acquired.length, 1);
      const old = acquired[0]!;
      now += 101;
      const takeover = (await kb.claim('recovery', 100))!;
      assert.equal(takeover.id, old.id);
      assert.notEqual(takeover.claimToken, old.claimToken);
      assert.equal(
        await ka.settle(old, {
          text: 'stale',
          producer: 'test',
          verdict: 'draft',
          sources: [],
        }),
        false,
      );
      assert.equal(
        await kb.settle(takeover, {
          text: 'current',
          producer: 'test',
          verdict: 'draft',
          sources: [],
        }),
        true,
      );
      assert.equal((await ka.audit(identity)).valid, true);
      assert.equal(
        (await a.read((tx) => tx.list(identity.tenantId, 'evidence'))).items
          .length,
        1,
      );
      const m = await ka.createMission(identity, {
        title: 'Parser on Postgres',
      });
      const syntax = await ka.enqueue(identity, {
        engine: 'verify-syntax',
        input: { context: 'export const n=1;' },
        missionId: m.id,
        idempotencyKey: 'parser',
      });
      await new Worker(ka, createEngines(ka), 'pg-parser').once();
      const saved = await b.read((tx) =>
        tx.get<Run>(identity.tenantId, 'run', syntax.id),
      );
      assert.equal(saved?.output?.verdict, 'passed');
      const evidence = (
        await b.read((tx) => tx.evidenceForMission(identity.tenantId, m.id))
      )[0]!;
      assert.equal(
        (await kb.verifyEvidence(identity, evidence.id)).executionVerified,
        true,
      );
      await assert.rejects(
        a.transaction(async (tx) => {
          await tx.put('mission', { ...m, id: randomUUID(), version: 0 }, 0);
          throw Error('rollback');
        }),
        /rollback/,
      );
      assert.equal(
        await b.read((tx) => tx.count(identity.tenantId, 'mission')),
        1,
      );
    } finally {
      await a.close();
      await b.close();
    }
  },
);
