import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SqliteStore } from '../packages/store/src/sqlite.js';
import { Organizer } from '../packages/kernel/src/organizer.js';
import { Kernel } from '../packages/kernel/src/service.js';
import { Worker } from '../packages/runtime/src/worker.js';
import { createEngines } from '../packages/engines/src/index.js';
import type { Identity } from '../packages/kernel/src/contracts.js';
const osa: Identity = { tenantId: 'reports', subject: 'osa', role: 'owner' };
const other: Identity = { ...osa, subject: 'other' };
async function add(o: Organizer, who: Identity, text: string, nextStep: string) {
  let state = await o.act(who, { action: 'capture', text, nextStep });
  const entry = state.entries.find(e => e.text === text)!;
  return o.act(who, { action: 'priority.add', id: entry.id, version: state.plan.version });
}
test('personal report snapshots task text, server-clock work and next step without closing the day', async () => {
  const store = new SqliteStore(':memory:'); let now = Date.parse('2026-10-02T10:00:00Z');
  const o = new Organizer(store, () => now);
  try {
    let state = await add(o, osa, 'Skończone zadanie', 'Otwórz kod.');
    const completedId = state.plan.currentEntryId;
    state = await o.act(osa, { action:'block.start', id:completedId, version:state.plan.version, settingsVersion:state.settings.version, minutes:25 });
    now += 92000;
    state = await o.act(osa, { action:'block.finish', id:state.activeBlock!.id, version:state.activeBlock!.version });
    state = await o.act(osa, { action:'complete', id:completedId, version:state.entries.find(e=>e.id===completedId)!.version });
    state = await add(o, osa, 'Prywatna otwarta praca', 'Sprawdź konkretny test.');
    const report = await o.generateReport(osa, state.date, 'known-job');
    assert.equal(report.seconds,92); assert.equal(report.done[0]!.id,completedId);
    assert.equal(report.unfinished[0]!.text,'Prywatna otwarta praca');
    assert.equal(report.nextStep,'Sprawdź konkretny test.');
    const snap = await o.snapshot(osa);
    assert.equal(snap.plan.closureId,undefined);
    assert.equal(snap.plan.reportId,report.id);
    const entry = snap.entries.find(e=>e.id===snap.plan.currentEntryId)!;
    await o.act(osa,{ action:'edit',id:entry.id,version:entry.version,text:'Późniejsza zmiana' });
    assert.equal((await o.generateReport(osa,state.date,'known-job')).unfinished[0]!.text,'Prywatna otwarta praca');
    assert.equal((await o.snapshot(other)).reports.length,0);
    assert.equal((await o.reports(other)).items.length,0);
    await assert.rejects(o.generateReport({...osa,role:'reader'}),{code:'FORBIDDEN'});
    const manual = await o.act(osa,{ action:'report.generate', subject:other.subject, tenantId:other.tenantId });
    assert.equal(manual.reports.length,2);
    assert.equal((await o.snapshot(other)).reports.length,0);
  } finally { await store.close(); }
});
test('evening worker reports belong to each schedule creator and never expose private task text in shared outputs', async () => {
  const store = new SqliteStore(':memory:'); let now = Date.parse('2026-10-02T18:30:00Z');
  const kernel = new Kernel(store,()=>now), organizer = new Organizer(store,()=>now);
  const worker = new Worker(kernel,createEngines(kernel),'evening-proof');
  try {
    await add(organizer,osa,'OSA_PRIVATE_SECRET','OSA_PRIVATE_NEXT');
    await add(organizer,other,'OTHER_PRIVATE_SECRET','OTHER_PRIVATE_NEXT');
    const a = await kernel.createSchedule(osa,{title:'Wieczór Osa',hour:21,minute:0,timezone:'Europe/Amsterdam',ownerSubject:other.subject});
    const b = await kernel.createSchedule(other,{title:'Wieczór druga osoba',hour:21,minute:0,timezone:'Europe/Amsterdam'});
    assert.equal(a.ownerSubject,osa.subject); assert.equal(b.ownerSubject,other.subject);
    now = Date.parse('2026-10-02T19:01:00Z');
    assert.equal(await kernel.tickSchedules(),2);
    assert.equal(await worker.once(),true); assert.equal(await worker.once(),true);
    const ra = (await organizer.snapshot(osa)).reports[0]!, rb = (await organizer.snapshot(other)).reports[0]!;
    assert.equal(ra.source,'schedule'); assert.equal(rb.source,'schedule');
    assert.equal(ra.unfinished[0]!.text,'OSA_PRIVATE_SECRET');
    assert.equal(rb.unfinished[0]!.text,'OTHER_PRIVATE_SECRET');
    assert.equal((await organizer.snapshot({...osa,subject:'scheduler'})).reports.length,0);
    assert.equal((await organizer.snapshot({...osa,subject:'worker:evening-proof'})).reports.length,0);
    const publicData = await kernel.report(other);
    assert.equal(publicData.runs.every(r=>r.status==='succeeded'),true);
    assert.doesNotMatch(JSON.stringify(publicData),/OSA_PRIVATE_SECRET|OTHER_PRIVATE_SECRET|OSA_PRIVATE_NEXT|OTHER_PRIVATE_NEXT/);
    assert.equal(await kernel.tickSchedules(),0);
    assert.equal((await organizer.snapshot(osa)).reports.length,1);
  } finally { await worker.stop(); await store.close(); }
});
test('manual job requester is bound to authentication and legacy schedules do not invent an organizer owner', async () => {
  const store = new SqliteStore(':memory:'); let now = Date.parse('2026-10-02T18:30:00Z');
  const kernel = new Kernel(store,()=>now), organizer = new Organizer(store,()=>now);
  const worker = new Worker(kernel,createEngines(kernel),'requester-proof');
  try {
    await add(organizer,osa,'Owner-only report text','Owner-only step');
    const run = await kernel.enqueue(osa,{engine:'daily-report',input:{requestedBy:other.subject},requestedBy:other.subject,idempotencyKey:'same-key'});
    assert.equal(run.requestedBy,osa.subject);
    await assert.rejects(kernel.enqueue(other,{engine:'daily-report',input:{requestedBy:other.subject},idempotencyKey:'same-key'}),{code:'IDEMPOTENCY_CONFLICT'});
    await worker.once();
    assert.equal((await organizer.snapshot(osa)).reports.length,1);
    assert.equal((await organizer.snapshot(other)).reports.length,0);
    const old = await kernel.createSchedule(osa,{title:'Starszy raport projektu',hour:21,minute:0,timezone:'Europe/Amsterdam'});
    await store.transaction(tx=>tx.put('schedule',{...old,ownerSubject:undefined},old.version));
    now = Date.parse('2026-10-02T19:01:00Z');
    await kernel.tickSchedules(); await worker.once();
    assert.equal((await organizer.snapshot(osa)).reports.length,1);
    const legacy = (await kernel.report(osa)).runs.find(r=>r.trigger==='schedule')!;
    assert.equal(legacy.requestedBy,undefined);
    assert.match(legacy.output!.text,/starszy harmonogram/);
  } finally { await worker.stop(); await store.close(); }
});
