import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const base = process.env.OSA_QA_COMPOSE_URL || 'http://127.0.0.1:3000';
const token = (await readFile('data/access-token.txt', 'utf8')).trim();
async function request(path, body) {
  const response = await fetch(base + path, {
    method: body ? 'POST' : 'GET',
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10000),
  });
  assert.ok(
    response.ok,
    'Unexpected API status ' + response.status + ' at ' + path,
  );
  return response.json();
}
const ready = await request('/health/ready');
assert.equal(ready.store, 'postgres');
const boot = await request('/api/bootstrap');
assert.equal(
  boot.integrations.find((i) => i.id === 'worker').status,
  'external',
);
const mission = await request('/api/missions', {
  title: 'CI / PostgreSQL and separate worker',
});
const run = await request('/api/runs', {
  engine: 'verify-syntax',
  input: { context: 'export const verified = true;' },
  missionId: mission.id,
  idempotencyKey: 'compose-' + crypto.randomUUID(),
});
let state;
for (let i = 0; i < 100; i++) {
  state = await request('/api/runs/' + run.id);
  if (['succeeded', 'failed', 'cancelled'].includes(state.status)) break;
  await new Promise((resolve) => setTimeout(resolve, 250));
}
assert.equal(state.status, 'succeeded');
const report = await request('/api/report');
const evidence = report.evidence.find((e) => e.runId === run.id);
assert.ok(evidence, 'Worker result must have persistent evidence');
const proof = await request('/api/evidence/' + evidence.id + '/verify');
assert.equal(proof.executionVerified, true);
console.log(
  'Compose PASS: PostgreSQL, API authentication, separate worker, real parser and bound persistent evidence.',
);
