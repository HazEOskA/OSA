import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { SqliteStore } from '../packages/store/src/sqlite.js';
import { PostgresStore } from '../packages/store/src/postgres.js';
import { Organizer, blockSeconds, nextOrganizerDate, organizerNamespace } from '../packages/kernel/src/organizer.js';
import type { Identity, OrganizerEntry, OrganizerBlock } from '../packages/kernel/src/contracts.js';
const owner: Identity = { tenantId: 'alpha', subject: 'osa', role: 'owner' };
const colleague: Identity = { ...owner, subject: 'colleague' };
async function fixture(fn: (o: Organizer, advance: (seconds: number) => void) => Promise<void>) {
  const store = new SqliteStore(':memory:');
  let now = Date.parse('2026-10-02T10:00:00Z');
  const organizer = new Organizer(store, () => now);
  try { await fn(organizer, seconds => { now += seconds * 1000; }); }
  finally { await store.close(); }
}
async function capture(o: Organizer, content: string, nextStep = '', identity = owner) {
  const snap = await o.act(identity, { action: 'capture', text: content, nextStep });
  return snap.entries.find(e => e.text === content)!;
}
async function prepared(o: Organizer) {
  const e = await capture(o, 'Przeczytać moduł autoryzacji', 'Otwórz auth.ts i zaznacz wejścia.');
  const snapshot = await o.snapshot(owner);
  return o.act(owner, { action: 'priority.add', id: e.id, version: snapshot.plan.version });
}
test('capture preserves all 4000 characters and whitespace through later/archive/restore', () => fixture(async o => {
  const content = '  Notatka\n' + 'ą'.repeat(3989) + ' ';
  assert.equal(content.length, 4000);
  let e = await capture(o, content);
  assert.deepEqual((await o.snapshot(owner)).plan.priorityIds, []);
  let s = await o.act(owner, { action: 'move', id: e.id, version: e.version, status: 'later' });
  e = s.entries.find(x => x.id === e.id)!;
  s = await o.act(owner, { action: 'move', id: e.id, version: e.version, status: 'archived' });
  e = s.entries.find(x => x.id === e.id)!;
  assert.equal(e.text, content);
  s = await o.act(owner, { action: 'restore', id: e.id, version: e.version });
  assert.equal(s.entries.find(x => x.id === e.id)!.status, 'later');
  assert.equal(s.entries.find(x => x.id === e.id)!.text, content);
  await assert.rejects(capture(o, 'x'.repeat(4001)), { code: 'INVALID_INPUT' });
}));
test('personal namespace separates colleagues, tenants and reader writes', () => fixture(async o => {
  const e = await capture(o, 'Prywatna myśl');
  assert.equal((await o.snapshot(colleague)).entries.length, 0);
  assert.equal((await o.snapshot({ ...owner, tenantId: 'beta' })).entries.length, 0);
  await assert.rejects(o.act(colleague, { action: 'edit', id: e.id, version: e.version, text: 'attack' }), { code: 'NOT_FOUND' });
  await assert.rejects(o.act({ ...owner, role: 'reader' }, { action: 'capture', text: 'attack' }), { code: 'FORBIDDEN' });
  assert.equal((await o.snapshot({ ...owner, role: 'reader' })).entries[0]!.text, 'Prywatna myśl');
}));
test('three priorities, one selected task, explicit next step and stale plan conflict', () => fixture(async o => {
  const entries: OrganizerEntry[] = [];
  for (let i = 0; i < 4; i++) entries.push(await capture(o, 'Zadanie ' + i));
  let s = await o.snapshot(owner);
  for (const e of entries.slice(0, 3)) s = await o.act(owner, { action: 'priority.add', id: e.id, version: s.plan.version });
  assert.equal(s.plan.currentEntryId, entries[0]!.id);
  await assert.rejects(o.act(owner, { action: 'priority.add', id: entries[3]!.id, version: s.plan.version }), { code: 'PRIORITY_LIMIT' });
  assert.equal((await o.snapshot(owner)).entries.find(e => e.id === entries[3]!.id)!.status, 'inbox');
  await assert.rejects(o.act(owner, { action: 'select', id: entries[1]!.id, version: 0 }), { code: 'VERSION_CONFLICT' });
  await assert.rejects(o.act(owner, { action: 'block.start', id: entries[0]!.id, version: s.plan.version, settingsVersion: s.settings.version, minutes: 25 }), { code: 'NEXT_STEP_REQUIRED' });
  s = await o.act(owner, { action: 'select', id: entries[1]!.id, version: s.plan.version });
  assert.equal(s.plan.currentEntryId, entries[1]!.id);
}));
test('budget can be zero, validates timezone/dates and uses Europe/Amsterdam by default', () => fixture(async o => {
  let s = await o.snapshot(owner);
  assert.equal(s.settings.timezone, 'Europe/Amsterdam');
  assert.equal(s.plan.availableMinutes, 90);
  s = await o.act(owner, { action: 'settings', version: s.plan.version, availableMinutes: 0, timezone: 'Pacific/Auckland', settingsVersion: s.settings.version });
  assert.equal(s.plan.availableMinutes, 0);
  await assert.rejects(o.act(owner, { action: 'settings', version: s.plan.version, availableMinutes: 20, timezone: 'wrong', settingsVersion: s.settings.version }), { code: 'INVALID_INPUT' });
  await assert.rejects(o.snapshot(owner, '2026-02-30'), { code: 'INVALID_DATE' });
  assert.equal(nextOrganizerDate('2026-12-31'), '2027-01-01');
}));
test('server timer, pause/resume, single active block and two-tab optimistic conflicts', () => fixture(async (o, advance) => {
  let s = await prepared(o);
  s = await o.act(owner, { action: 'block.start', id: s.plan.currentEntryId, version: s.plan.version, settingsVersion: s.settings.version, minutes: 25 });
  const initial = s.activeBlock!;
  advance(61);
  s = await o.snapshot(owner);
  assert.equal(blockSeconds(s.activeBlock!, Date.parse(s.serverNow)), 61);
  await assert.rejects(o.act(owner, { action: 'block.start', id: s.plan.currentEntryId, version: s.plan.version, settingsVersion: s.settings.version, minutes: 5 }), { code: 'BLOCK_ACTIVE' });
  await assert.rejects(o.act(owner, { action: 'close', version: s.plan.version }), { code: 'BLOCK_ACTIVE' });
  await assert.rejects(o.act(owner, { action: 'complete', id: s.plan.currentEntryId, version: s.entries.find(e => e.id === s.plan.currentEntryId)!.version }), { code: 'BLOCK_ACTIVE' });
  s = await o.act(owner, { action: 'block.pause', id: initial.id, version: initial.version });
  advance(80);
  assert.equal(blockSeconds((await o.snapshot(owner)).activeBlock!, o.now()), 61);
  await assert.rejects(o.act(owner, { action: 'block.resume', id: initial.id, version: initial.version }), { code: 'VERSION_CONFLICT' });
  s = await o.act(owner, { action: 'block.resume', id: initial.id, version: s.activeBlock!.version });
  advance(19);
  s = await o.act(owner, { action: 'block.finish', id: initial.id, version: s.activeBlock!.version });
  assert.equal(s.activeBlock, null);
  assert.equal(s.blocks.find(b => b.id === initial.id)!.elapsedSeconds, 80);
}));
test('running block and completed state survive a real SQLite close/reopen', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'osa-organizer-restart-'));
  const file = join(directory, 'organizer.sqlite');
  let now = Date.parse('2026-10-02T10:00:00Z');
  let store = new SqliteStore(file);
  try {
    let o = new Organizer(store, () => now);
    let s = await prepared(o);
    s = await o.act(owner, { action: 'block.start', id: s.plan.currentEntryId, version: s.plan.version, settingsVersion: s.settings.version, minutes: 15 });
    const blockId = s.activeBlock!.id;
    await store.close();
    now += 120000;
    store = new SqliteStore(file);
    o = new Organizer(store, () => now);
    s = await o.snapshot(owner);
    assert.equal(s.activeBlock!.id, blockId);
    assert.equal(blockSeconds(s.activeBlock!, now), 120);
    s = await o.act(owner, { action: 'block.finish', id: blockId, version: s.activeBlock!.version });
    const e = s.entries.find(e => e.id === s.plan.currentEntryId)!;
    await o.act(owner, { action: 'complete', id: e.id, version: e.version });
    await store.close();
    store = new SqliteStore(file);
    s = await new Organizer(store, () => now).snapshot(owner);
    assert.equal(s.activeBlock, null);
    assert.equal(s.entries.find(x => x.id === e.id)!.status, 'done');
  } finally { await store.close(); await rm(directory, { recursive: true, force: true }); }
});
test('evening closure is an immutable snapshot with one versioned tomorrow task', () => fixture(async o => {
  let s = await prepared(o);
  const completed = s.entries.find(e => e.id === s.plan.currentEntryId)!;
  s = await o.act(owner, { action: 'complete', id: completed.id, version: completed.version });
  const tomorrow = await capture(o, 'Dokończyć test logowania', 'Uruchom test przypadku wygasłej sesji.');
  s = await o.act(owner, { action: 'priority.add', id: tomorrow.id, version: s.plan.version });
  s = await o.act(owner, { action: 'close', version: s.plan.version, tomorrowId: tomorrow.id, tomorrowVersion: 0, notes: 'Przeczytałem przepływ.', blocker: 'Brakowało fixture.' });
  const closure = s.closures[0]!;
  assert.equal(closure.done[0]!.id, completed.id);
  assert.equal(closure.unfinished[0]!.id, tomorrow.id);
  assert.equal(closure.tomorrow!.id, tomorrow.id);
  const next = await o.snapshot(owner, '2026-10-03');
  assert.deepEqual(next.plan.priorityIds, [tomorrow.id]);
  assert.equal(next.plan.currentEntryId, tomorrow.id);
  await o.act(owner, { action: 'edit', date: next.date, id: tomorrow.id, version: next.entries.find(e => e.id === tomorrow.id)!.version, text: 'Zmieniony później wpis' });
  const old = await o.snapshot(owner, '2026-10-02');
  assert.equal(old.closures.find(c => c.id === closure.id)!.tomorrow!.text, 'Dokończyć test logowania');
  await assert.rejects(o.act(owner, { action: 'close', date: old.date, version: old.plan.version, notes: 'overwrite' }), { code: 'DAY_CLOSED' });
}));
test('full tomorrow plan rolls closure back without losing notes or current day', () => fixture(async o => {
  let s = await prepared(o);
  const selected = s.entries.find(e => e.id === s.plan.currentEntryId)!;
  let next = await o.snapshot(owner, '2026-10-03');
  for (let i = 0; i < 3; i++) {
    const e = await capture(o, 'Jutro ' + i);
    next = await o.act(owner, { action: 'priority.add', date: next.date, id: e.id, version: next.plan.version });
  }
  await assert.rejects(o.act(owner, { action: 'close', date: s.date, version: s.plan.version, tomorrowId: selected.id, tomorrowVersion: next.plan.version, notes: 'keep' }), { code: 'PRIORITY_LIMIT' });
  s = await o.snapshot(owner, s.date);
  assert.equal(s.plan.closureId, undefined);
  assert.equal(s.closures.length, 0);
  assert.equal(s.plan.currentEntryId, selected.id);
}));
test('bounded history retains pinned old task/block and inbox pagination loses no entries', () => fixture(async o => {
  let s = await prepared(o);
  const oldId = s.plan.currentEntryId;
  s = await o.act(owner, { action: 'block.start', id: oldId, version: s.plan.version, settingsVersion: s.settings.version, minutes: 25 });
  const oldBlockId = s.activeBlock!.id, tenantId = organizerNamespace(owner);
  await o.store.transaction(async tx => {
    for (let i = 0; i < 205; i++) {
      await tx.put<OrganizerEntry>('organizer-entry', { id: 'new-' + String(i).padStart(4, '0'), tenantId, version: 0, createdAt: '2026-10-03T10:00:00Z', text: 'Backlog ' + i, nextStep: '', estimateMinutes: 25, status: 'inbox', updatedAt: '2026-10-03T10:00:00Z' }, 0);
      await tx.put<OrganizerBlock>('organizer-block', { id: 'block-' + String(i).padStart(4, '0'), tenantId, version: 0, createdAt: '2026-10-03T10:00:00Z', date: '2026-10-03', entryId: 'new-' + String(i).padStart(4, '0'), taskText: 'Backlog', nextStep: 'Read', plannedSeconds: 60, elapsedSeconds: 1, status: 'completed', note: '' }, 0);
    }
  });
  s = await o.snapshot(owner);
  assert.equal(s.coverage.entriesHaveMore, true);
  assert.ok(s.entries.some(e => e.id === oldId));
  assert.equal(s.activeBlock!.id, oldBlockId);
  assert.ok(s.blocks.some(b => b.id === oldBlockId));
  let cursor: string | undefined;
  const ids = [];
  do { const page = await o.inbox(owner, cursor); ids.push(...page.items.map(e => e.id)); cursor = page.nextCursor; } while (cursor);
  assert.equal(ids.length, 205);
  assert.equal(new Set(ids).size, 205);
  const moved = await o.act(owner, { action: 'move', id: 'new-0000', version: 1, status: 'archived' });
  assert.equal(moved.entries.find(e => e.id === 'new-0000')!.status, 'archived', 'mutation response refreshes older paginated records');
}));
test('PostgreSQL organizer: independent connections allow only one block start', { skip: !process.env.OSA_TEST_DATABASE_URL }, async () => {
  const a = new PostgresStore(process.env.OSA_TEST_DATABASE_URL!), b = new PostgresStore(process.env.OSA_TEST_DATABASE_URL!);
  await a.init(); await b.init();
  const identity: Identity = { ...owner, tenantId: 'organizer-pg-' + randomUUID() };
  const oa = new Organizer(a), ob = new Organizer(b);
  try {
    const e = await capture(oa, 'PostgreSQL focus', 'Read the transaction', identity);
    const s = await oa.act(identity, { action: 'priority.add', id: e.id, version: 0 });
    const input = { action: 'block.start', id: e.id, version: s.plan.version, settingsVersion: s.settings.version, minutes: 5 };
    const results = await Promise.allSettled([oa.act(identity, input), ob.act(identity, input)]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    const current = await ob.snapshot(identity);
    assert.equal(current.blocks.length, 1);
    assert.equal(current.activeBlock!.entryId, e.id);
  } finally { await a.close(); await b.close(); }
});
