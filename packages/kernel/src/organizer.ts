import type { Store, Tx } from '../../store/src/store.js';
import type { Entity, Identity, Kind, OrganizerBlock, OrganizerClosure, OrganizerDay, OrganizerEntry, OrganizerReport, OrganizerSettings, OrganizerSnapshot, OrganizerStatus } from './contracts.js';
import { OsaError } from './contracts.js';
import { dateKey, digest, id, object, requireWrite, text } from './guards.js';

// The server-authenticated tenant and subject define a personal namespace.
// Request body identity fields never select another person's records.
export const organizerNamespace = (identity: Identity) =>
  'organizer:' + digest([identity.tenantId, identity.subject]);

function integer(value: unknown, min: number, max: number, name: string) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max)
    throw new OsaError('INVALID_INPUT', name + ': podaj liczbę od ' + min + ' do ' + max + '.');
  return value;
}
function fullText(value: unknown) {
  text(value, 'Treść', 4000);
  return value as string; // Preserve the complete capture, including whitespace.
}
function validDate(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      !Number.isFinite(Date.parse(value + 'T12:00:00Z')) ||
      new Date(value + 'T12:00:00Z').toISOString().slice(0, 10) !== value)
    throw new OsaError('INVALID_DATE', 'Nieprawidłowa data dnia.');
  return value;
}
export function nextOrganizerDate(date: string) {
  return new Date(Date.parse(validDate(date) + 'T12:00:00Z') + 86400000).toISOString().slice(0, 10);
}
export function blockSeconds(block: OrganizerBlock, now: number) {
  return block.elapsedSeconds + (block.status === 'running' && block.runningSince
    ? Math.max(0, Math.floor((now - Date.parse(block.runningSince)) / 1000)) : 0);
}
function version(entity: Entity, expected: unknown) {
  if (entity.version !== expected)
    throw new OsaError('VERSION_CONFLICT', 'Dane zmieniły się w drugim oknie. Odświeżono widok; sprawdź go i ponów.', 409);
}

export class Organizer {
  constructor(readonly store: Store, readonly now = () => Date.now()) {}
  private base(tenantId: string, entityId: string = id()) {
    return { id: entityId, tenantId, version: 0, createdAt: new Date(this.now()).toISOString() };
  }
  private async settings(tx: Tx, tenant: string): Promise<OrganizerSettings> {
    return await tx.get<OrganizerSettings>(tenant, 'organizer-settings', 'settings') ||
      { ...this.base(tenant, 'settings'), timezone: 'Europe/Amsterdam', activeBlockId: '' };
  }
  private async day(tx: Tx, tenant: string, date: string): Promise<OrganizerDay> {
    return await tx.get<OrganizerDay>(tenant, 'organizer-day', date) ||
      { ...this.base(tenant, date), date, availableMinutes: 90, priorityIds: [], currentEntryId: '', completedIds: [], blockIds: [] };
  }
  private async find<T extends Entity>(tx: Tx, tenant: string, kind: Kind, entityId: unknown) {
    const found = await tx.get<T>(tenant, kind, text(entityId, 'Id', 100));
    if (!found) throw new OsaError('NOT_FOUND', 'Nie znaleziono wpisu w Twoim organizerze.', 404);
    return found;
  }
  async snapshot(identity: Identity, requestedDate?: string): Promise<OrganizerSnapshot> {
    const tenant = organizerNamespace(identity);
    return this.store.read(async tx => {
      const settings = await this.settings(tx, tenant);
      const date = requestedDate ? validDate(requestedDate) : dateKey(this.now(), settings.timezone);
      const plan = await this.day(tx, tenant, date);
      const entries = await tx.list<OrganizerEntry>(tenant, 'organizer-entry', 200);
      const blocks = await tx.list<OrganizerBlock>(tenant, 'organizer-block', 200);
      const plans = await tx.list<OrganizerDay>(tenant, 'organizer-day', 30);
      const closures = await tx.list<OrganizerClosure>(tenant, 'organizer-closure', 30);
      const reports = await tx.list<OrganizerReport>(tenant, 'organizer-report', 30);
      const activeBlock = settings.activeBlockId
        ? await tx.get<OrganizerBlock>(tenant, 'organizer-block', settings.activeBlockId) || null : null;
      // Pinning by id prevents an older task or running block from disappearing
      // when the bounded history receives more than 200 newer entries.
      for (const entryId of new Set([...plan.priorityIds, ...plan.completedIds, ...(activeBlock ? [activeBlock.entryId] : [])])) {
        if (!entries.items.some(e => e.id === entryId)) {
          const entry = await tx.get<OrganizerEntry>(tenant, 'organizer-entry', entryId);
          if (entry) entries.items.push(entry);
        }
      }
      for (const blockId of new Set([...plan.blockIds, ...(activeBlock ? [activeBlock.id] : [])])) {
        if (!blocks.items.some(b => b.id === blockId)) {
          const block = await tx.get<OrganizerBlock>(tenant, 'organizer-block', blockId);
          if (block) blocks.items.push(block);
        }
      }
      if (plan.closureId && !closures.items.some(c => c.id === plan.closureId)) {
        const closure = await tx.get<OrganizerClosure>(tenant, 'organizer-closure', plan.closureId);
        if (closure) closures.items.push(closure);
      }
      if (plan.reportId && !reports.items.some(r => r.id === plan.reportId)) {
        const report = await tx.get<OrganizerReport>(tenant, 'organizer-report', plan.reportId);
        if (report) reports.items.push(report);
      }
      if (!plans.items.some(p => p.id === plan.id)) plans.items.unshift(plan);
      // Fetch the next plan explicitly for safe, versioned evening carry-over.
      const tomorrow = await tx.get<OrganizerDay>(tenant, 'organizer-day', nextOrganizerDate(date));
      if (tomorrow && !plans.items.some(p => p.id === tomorrow.id)) plans.items.push(tomorrow);
      return { date, serverNow: new Date(this.now()).toISOString(), settings, plan,
        entries: entries.items, blocks: blocks.items, activeBlock, closures: closures.items, reports: reports.items, plans: plans.items,
        coverage: { entriesHaveMore: !!entries.nextCursor, blocksHaveMore: !!blocks.nextCursor, plansHaveMore: !!plans.nextCursor, reportsHaveMore: !!reports.nextCursor } };
    });
  }
  async inbox(identity: Identity, cursor?: string, status = 'inbox') {
    if (!['inbox', 'later', 'done', 'archived'].includes(status))
      throw new OsaError('INVALID_INPUT', 'Nieprawidłowa lista.');
    return this.store.read(async tx => {
      const page = await tx.list<OrganizerEntry>(organizerNamespace(identity), 'organizer-entry', 50, cursor);
      return { items: page.items.filter(e => e.status === status || (status === 'later' && e.status === 'ready')), nextCursor: page.nextCursor };
    });
  }
  async generateReport(identity: Identity, requestedDate?: string, generationId?: string, source: 'manual' | 'schedule' = 'manual'): Promise<OrganizerReport> {
    requireWrite(identity);
    const tenant = organizerNamespace(identity);
    const reportId = generationId ? 'report:' + text(generationId, 'Id raportu', 80) : id();
    return this.store.transaction(async tx => {
      const settings = await this.settings(tx, tenant);
      const date = requestedDate ? validDate(requestedDate) : dateKey(this.now(), settings.timezone);
      const existing = await tx.get<OrganizerReport>(tenant, 'organizer-report', reportId);
      if (existing) {
        if (existing.date !== date || existing.source !== source) throw new OsaError('IDEMPOTENCY_CONFLICT', 'Ten raport opisuje inny dzień.', 409);
        return existing;
      }
      const plan = await this.day(tx, tenant, date);
      const closure = plan.closureId ? await tx.get<OrganizerClosure>(tenant, 'organizer-closure', plan.closureId) : undefined;
      const done = closure ? closure.done : await Promise.all(plan.completedIds.map(entryId => this.find<OrganizerEntry>(tx, tenant, 'organizer-entry', entryId)));
      const priorities = closure ? closure.unfinished : await Promise.all(plan.priorityIds.map(entryId => this.find<OrganizerEntry>(tx, tenant, 'organizer-entry', entryId)));
      const unfinished = priorities.filter(entry => entry.status !== 'done');
      const blocks = await Promise.all(plan.blockIds.map(blockId => this.find<OrganizerBlock>(tx, tenant, 'organizer-block', blockId)));
      const current = unfinished.find(entry => entry.id === plan.currentEntryId) || unfinished[0];
      const report: OrganizerReport = {
        ...this.base(tenant, reportId), date, timezone: settings.timezone,
        generatedAt: new Date(this.now()).toISOString(), source, done, unfinished,
        seconds: closure ? closure.seconds : blocks.reduce((total, block) => total + blockSeconds(block, this.now()), 0),
        nextStep: closure?.tomorrow?.nextStep || current?.nextStep || '',
        notes: closure?.notes || '', blocker: closure?.blocker || '',
        blockOpen: !closure && blocks.some(block => block.status !== 'completed'),
      };
      const saved = await tx.put('organizer-report', report, 0);
      await tx.put('organizer-day', { ...plan, reportId: saved.id }, plan.version);
      await tx.append({ tenantId: tenant, subject: identity.subject, type: 'organizer.report.generated',
        entityId: saved.id, at: report.generatedAt, payload: { date, source } });
      return saved;
    });
  }
  async reports(identity: Identity, cursor?: string) {
    return this.store.read(tx => tx.list<OrganizerReport>(organizerNamespace(identity), 'organizer-report', 30, cursor));
  }
  async act(identity: Identity, input: Record<string, unknown>): Promise<OrganizerSnapshot> {
    requireWrite(identity);
    const b = object(input), action = text(b.action, 'Akcja', 80);
    if (action === 'report.generate') {
      const date = b.date === undefined ? undefined : validDate(b.date);
      await this.generateReport(identity, date);
      return this.snapshot(identity, date);
    }
    const tenant = organizerNamespace(identity);
    let resultDate = '', changedEntityId = '';
    await this.store.transaction(async tx => {
      const settings = await this.settings(tx, tenant);
      const date = b.date === undefined ? dateKey(this.now(), settings.timezone) : validDate(b.date);
      resultDate = date;
      const plan = await this.day(tx, tenant, date);
      const at = new Date(this.now()).toISOString();
      const active = settings.activeBlockId ? await tx.get<OrganizerBlock>(tenant, 'organizer-block', settings.activeBlockId) : undefined;
      const openDay = () => {
        if (plan.closureId) throw new OsaError('DAY_CLOSED', 'Ten dzień jest domknięty. Przejdź do kolejnego dnia.', 409);
      };
      const planVersion = () => { openDay(); version(plan, b.version); };
      const savePlan = () => tx.put('organizer-day', plan, plan.version);
      const entry = () => this.find<OrganizerEntry>(tx, tenant, 'organizer-entry', b.id);
      const idleEntry = (e: OrganizerEntry) => {
        if (active?.entryId === e.id) throw new OsaError('BLOCK_ACTIVE', 'Najpierw zakończ blok tej pracy.', 409);
      };
      let entityId = date;
      if (action === 'capture') {
        const e: OrganizerEntry = { ...this.base(tenant), text: fullText(b.text),
          nextStep: text(b.nextStep, 'Następny krok', 1000, true),
          estimateMinutes: b.estimateMinutes === undefined ? 25 : integer(b.estimateMinutes, 1, 480, 'Szacunek'),
          status: 'inbox', updatedAt: at };
        await tx.put('organizer-entry', e, 0); entityId = e.id;
      } else if (action === 'edit') {
        const e = await entry(); version(e, b.version); idleEntry(e);
        if (e.status === 'archived' || e.status === 'done') throw new OsaError('ENTRY_CLOSED', 'Przywróć wpis przed edycją.', 409);
        if (plan.priorityIds.includes(e.id)) openDay();
        if (b.text !== undefined) e.text = fullText(b.text);
        if (b.nextStep !== undefined) e.nextStep = text(b.nextStep, 'Następny krok', 1000, true);
        if (b.estimateMinutes !== undefined) e.estimateMinutes = integer(b.estimateMinutes, 1, 480, 'Szacunek');
        e.updatedAt = at; await tx.put('organizer-entry', e, e.version); entityId = e.id;
      } else if (action === 'move' || action === 'restore') {
        const e = await entry(); version(e, b.version); idleEntry(e);
        if (plan.priorityIds.includes(e.id)) {
          openDay(); version(plan, b.planVersion);
          plan.priorityIds = plan.priorityIds.filter(x => x !== e.id);
          if (plan.currentEntryId === e.id) plan.currentEntryId = '';
          await savePlan();
        }
        if (action === 'restore') {
          if (e.status !== 'archived') throw new OsaError('INVALID_STATE', 'Wpis nie jest w archiwum.', 409);
          e.status = e.previousStatus || 'inbox'; e.previousStatus = undefined;
        } else {
          const status = text(b.status, 'Lista', 20) as OrganizerStatus;
          if (!['inbox', 'later', 'archived'].includes(status)) throw new OsaError('INVALID_INPUT', 'Nieprawidłowa lista.');
          if (e.status === 'archived') throw new OsaError('INVALID_STATE', 'Użyj przywrócenia wpisu.', 409);
          if (status === 'archived') e.previousStatus = e.status as Exclude<OrganizerStatus, 'archived'>;
          e.status = status;
          if (status !== 'archived') e.completedAt = undefined;
        }
        e.updatedAt = at; await tx.put('organizer-entry', e, e.version); entityId = e.id;
      } else if (action === 'settings') {
        planVersion();
        plan.availableMinutes = integer(b.availableMinutes, 0, 720, 'Dostępny czas');
        if (b.timezone !== undefined) {
          version(settings, b.settingsVersion);
          const timezone = text(b.timezone, 'Strefa czasowa', 100);
          try { new Intl.DateTimeFormat('en', { timeZone: timezone }); }
          catch { throw new OsaError('INVALID_INPUT', 'Nieprawidłowa strefa czasowa IANA.'); }
          settings.timezone = timezone; await tx.put('organizer-settings', settings, settings.version);
        }
        await savePlan();
      } else if (['priority.add', 'priority.remove', 'select'].includes(action)) {
        planVersion(); const e = await entry(); entityId = e.id;
        if (action === 'priority.add') {
          if (['done', 'archived'].includes(e.status)) throw new OsaError('INVALID_STATE', 'Wybierz aktywny wpis.', 409);
          if (!plan.priorityIds.includes(e.id)) {
            if (plan.priorityIds.length >= 3) throw new OsaError('PRIORITY_LIMIT', 'Na dziś wybierz najwyżej trzy priorytety. Reszta zostaje w skrzynce.', 409);
            plan.priorityIds.push(e.id);
          }
          if (!plan.currentEntryId) plan.currentEntryId = e.id;
          await tx.put<OrganizerEntry>('organizer-entry', { ...e, status: 'ready', updatedAt: at }, e.version);
        } else if (action === 'priority.remove') {
          idleEntry(e); plan.priorityIds = plan.priorityIds.filter(x => x !== e.id);
          if (plan.currentEntryId === e.id) plan.currentEntryId = '';
          if (e.status === 'ready') await tx.put<OrganizerEntry>('organizer-entry', { ...e, status: 'inbox', updatedAt: at }, e.version);
        } else {
          if (!plan.priorityIds.includes(e.id) || ['done', 'archived'].includes(e.status)) throw new OsaError('INVALID_STATE', 'Wybierz jeden z aktywnych priorytetów.', 409);
          if (active && active.entryId !== e.id) throw new OsaError('BLOCK_ACTIVE', 'Zakończ obecny blok przed zmianą pracy.', 409);
          plan.currentEntryId = e.id;
        }
        await savePlan();
      } else if (action === 'complete') {
        openDay(); const e = await entry(); version(e, b.version); idleEntry(e); entityId = e.id;
        if (['done', 'archived'].includes(e.status)) throw new OsaError('INVALID_STATE', 'Wpis jest już zamknięty.', 409);
        if (plan.completedIds.length >= 200) throw new OsaError('DAY_LIMIT', 'Dzienny zapis obejmuje najwyżej 200 ukończonych wpisów.', 409);
        e.status = 'done'; e.completedAt = at; e.updatedAt = at;
        await tx.put('organizer-entry', e, e.version);
        plan.completedIds = [...new Set([...plan.completedIds, e.id])];
        if (plan.currentEntryId === e.id) plan.currentEntryId = '';
        await savePlan();
      } else if (action === 'block.start') {
        planVersion(); version(settings, b.settingsVersion);
        if (active) throw new OsaError('BLOCK_ACTIVE', 'Masz już jeden otwarty blok. Wróć do niego.', 409);
        const e = await entry();
        if (plan.currentEntryId !== e.id || !plan.priorityIds.includes(e.id) || ['done', 'archived'].includes(e.status)) throw new OsaError('INVALID_STATE', 'Najpierw wybierz zadanie TERAZ.', 409);
        if (!e.nextStep.trim()) throw new OsaError('NEXT_STEP_REQUIRED', 'Przed startem zapisz jeden konkretny następny krok.', 409);
        if (plan.blockIds.length >= 200) throw new OsaError('DAY_LIMIT', 'Dzienny zapis obejmuje najwyżej 200 bloków.', 409);
        const block: OrganizerBlock = { ...this.base(tenant), date, entryId: e.id, taskText: e.text, nextStep: e.nextStep,
          plannedSeconds: integer(b.minutes, 1, 180, 'Długość bloku') * 60,
          elapsedSeconds: 0, status: 'running', runningSince: at, note: '' };
        await tx.put('organizer-block', block, 0);
        settings.activeBlockId = block.id; await tx.put('organizer-settings', settings, settings.version);
        plan.blockIds.push(block.id); await savePlan(); entityId = block.id;
      } else if (['block.pause', 'block.resume', 'block.finish'].includes(action)) {
        const block = await this.find<OrganizerBlock>(tx, tenant, 'organizer-block', b.id);
        version(block, b.version); entityId = block.id;
        if (settings.activeBlockId !== block.id || block.status === 'completed') throw new OsaError('INVALID_STATE', 'Ten blok jest już zakończony.', 409);
        if ((action === 'block.pause' && block.status !== 'running') ||
            (action === 'block.resume' && block.status !== 'paused')) throw new OsaError('INVALID_STATE', 'Stan bloku zmienił się.', 409);
        block.elapsedSeconds = blockSeconds(block, this.now());
        block.runningSince = action === 'block.resume' ? at : undefined;
        block.status = action === 'block.finish' ? 'completed' : action === 'block.pause' ? 'paused' : 'running';
        if (action === 'block.finish') {
          block.finishedAt = at; block.note = text(b.note, 'Notatka bloku', 2000, true);
          settings.activeBlockId = ''; await tx.put('organizer-settings', settings, settings.version);
        }
        await tx.put('organizer-block', block, block.version);
      } else if (action === 'close') {
        planVersion();
        if (active) throw new OsaError('BLOCK_ACTIVE', 'Najpierw zakończ otwarty blok pracy.', 409);
        const priorities: OrganizerEntry[] = [];
        for (const entryId of plan.priorityIds) priorities.push(await this.find<OrganizerEntry>(tx, tenant, 'organizer-entry', entryId));
        const done: OrganizerEntry[] = [];
        for (const entryId of new Set([...plan.completedIds, ...priorities.filter(e => e.status === 'done').map(e => e.id)]))
          done.push(await this.find<OrganizerEntry>(tx, tenant, 'organizer-entry', entryId));
        let tomorrow: OrganizerEntry | null = null;
        const tomorrowDate = nextOrganizerDate(date);
        if (b.tomorrowId) {
          tomorrow = await this.find<OrganizerEntry>(tx, tenant, 'organizer-entry', b.tomorrowId);
          if (['done', 'archived'].includes(tomorrow.status)) throw new OsaError('INVALID_STATE', 'Na jutro wybierz niedokończoną pracę.', 409);
          const next = await this.day(tx, tenant, tomorrowDate);
          version(next, b.tomorrowVersion);
          if (next.closureId) throw new OsaError('DAY_CLOSED', 'Kolejny dzień jest już domknięty.', 409);
          if (!next.priorityIds.includes(tomorrow.id)) {
            if (next.priorityIds.length >= 3) throw new OsaError('PRIORITY_LIMIT', 'Jutro ma już trzy priorytety. Usuń jeden lub domknij dzień bez przenoszenia.', 409);
            next.priorityIds.push(tomorrow.id);
          }
          if (!next.currentEntryId) next.currentEntryId = tomorrow.id;
          await tx.put('organizer-day', next, next.version);
          if (tomorrow.status !== 'ready') tomorrow = await tx.put<OrganizerEntry>('organizer-entry', { ...tomorrow, status: 'ready', updatedAt: at }, tomorrow.version);
        }
        let seconds = 0;
        for (const blockId of plan.blockIds) {
          const block = await this.find<OrganizerBlock>(tx, tenant, 'organizer-block', blockId);
          seconds += block.elapsedSeconds;
        }
        const closure: OrganizerClosure = { ...this.base(tenant, date), date, timezone: settings.timezone,
          closedAt: at, done, unfinished: priorities.filter(e => e.status !== 'done'),
          notes: text(b.notes, 'Notatka dnia', 4000, true), blocker: text(b.blocker, 'Blokada', 2000, true),
          seconds, tomorrowDate, tomorrow };
        await tx.put('organizer-closure', closure, 0);
        plan.closureId = closure.id; await savePlan();
      } else throw new OsaError('INVALID_ACTION', 'Nieznana akcja organizera.');
      changedEntityId = entityId;
      await tx.append({ tenantId: tenant, subject: identity.subject, type: 'organizer.' + action,
        entityId, at, payload: { date } });
    });
    // Store reads must happen after the transaction leaves the SQLite serial gate.
    const snapshot = await this.snapshot(identity, resultDate);
    if (changedEntityId !== resultDate && !snapshot.entries.some(e => e.id === changedEntityId)) {
      const changed = await this.store.read(tx => tx.get<OrganizerEntry>(tenant, 'organizer-entry', changedEntityId));
      if (changed) snapshot.entries.push(changed);
    }
    return snapshot;
  }
}
