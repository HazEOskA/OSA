import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { Identity, Mission, Schedule, OrganizerBlock, OrganizerClosure, OrganizerEntry, OrganizerReport, OrganizerSnapshot, Page } from '../../../packages/kernel/src/contracts';

type Api = <T>(path: string, method?: string, body?: unknown) => Promise<T>;
type WorkspaceView = 'day' | 'room' | 'engines' | 'runs' | 'proof' | 'learn' | 'rhythm' | 'platform';
type Props = {
  workspace?: ReactNode;
  workspaceView: WorkspaceView;
  workspaceName: string;
  globalError: string;
  onClearGlobalError: () => void;
  projects: Mission[];
  schedules: Schedule[];
  modelReady: boolean;
  onSchedule: (hour: number, minute: number, timezone: string) => Promise<void>;
  identity: Identity;
  api: Api;
  onNavigate: (view: WorkspaceView) => void;
  onTool: (engine: string, context: string) => void;
  onLogout: () => Promise<void>;
};
type List = 'inbox' | 'later' | 'done' | 'archived';
const listLabels: Record<List, string> = { inbox: 'Skrzynka', later: 'Później', done: 'Ukończone', archived: 'Archiwum' };
const tools = [
  ['prompt', 'Prompt God'], ['research', 'Research'], ['review', 'Code Review'],
  ['leads', 'Lead Engine'], ['mail', 'Cold Mailing'], ['academy', 'Akademia'],
  ['profile', 'Profile Engine'], ['labs', 'OSA Labs'], ['certificate', 'OSA Certyfikat'], ['radar', 'Radar ofert'],
] as const;
const label = (entry: { text: string }) => entry.text.trim().split('\n')[0]!.slice(0, 200);
const nextDate = (date: string) => new Date(Date.parse(date + 'T12:00:00Z') + 86400000).toISOString().slice(0, 10);
const clock = (seconds: number) => String(Math.floor(seconds / 60)).padStart(2, '0') + ':' + String(seconds % 60).padStart(2, '0');
const secondsAt = (block: OrganizerBlock, now: number) => block.elapsedSeconds +
  (block.status === 'running' && block.runningSince ? Math.max(0, Math.floor((now - Date.parse(block.runningSince)) / 1000)) : 0);

function Closure({ report }: { report: OrganizerClosure }) {
  return <article className="o-report" aria-label="Zapis domknięcia dnia">
    <div className="o-report-heading"><span className="o-dot" />Dzień domknięty<span>{new Date(report.closedAt).toLocaleTimeString('pl-PL', { timeZone: report.timezone, hour: '2-digit', minute: '2-digit' })}</span></div>
    <h2>Możesz już odłożyć ten dzień.</h2>
    <p>Ten zapis zostaje taki, jak w chwili domknięcia.</p>
    <div className="o-report-columns">
      <section><h3>Ukończone <span>{report.done.length}</span></h3>
        {report.done.length ? report.done.map(e => <details key={e.id}><summary>{label(e)}</summary><p className="o-fulltext">{e.text}</p></details>) : <p>Nie oznaczono ukończonej pracy.</p>}
      </section>
      <section><h3>Niedokończone <span>{report.unfinished.length}</span></h3>
        {report.unfinished.length ? report.unfinished.map(e => <details key={e.id}><summary>{label(e)}</summary><p className="o-fulltext">{e.text}</p><p>Następny krok: {e.nextStep || 'jeszcze do zapisania'}</p></details>) : <p>Nie zostały otwarte priorytety.</p>}
      </section>
    </div>
    {report.notes && <section><h3>Co dziś zadziałało</h3><p className="o-fulltext">{report.notes}</p></section>}
    {report.blocker && <section><h3>Co zatrzymało pracę</h3><p className="o-fulltext">{report.blocker}</p></section>}
    <div className="o-tomorrow"><span>Jeden ruch na jutro</span><strong>{report.tomorrow ? label(report.tomorrow) : 'Nie wybrano. Wybierzesz, gdy wrócisz.'}</strong>{report.tomorrow?.nextStep && <p>{report.tomorrow.nextStep}</p>}</div>
    <p className="o-footnote">Zapisano {Math.floor(report.seconds / 60)} min w blokach pracy. Czas i oznaczenia zadań opisują Twoją pracę; nie są niezależną weryfikacją jej wyniku.</p>
  </article>;
}
function EntryEditor({ entry, busy, error, readOnly, onSave, onClose, onReload }: {
  entry: OrganizerEntry; busy: boolean; error: string; readOnly: boolean;
  onSave: (body: Record<string, unknown>) => Promise<boolean>;
  onClose: () => void; onReload: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [text, setText] = useState(entry.text);
  const [step, setStep] = useState(entry.nextStep);
  const [estimate, setEstimate] = useState(entry.estimateMinutes);
  useEffect(() => { const d = dialog.current!; d.showModal(); return () => d.close(); }, []);
  const closed = readOnly || ['done', 'archived'].includes(entry.status);
  return <dialog className="o-dialog" ref={dialog} onCancel={onClose} aria-labelledby="o-edit-heading">
    <div className="o-dialog-heading"><h2 id="o-edit-heading">{closed ? 'Twój zapis' : 'Jedna konkretna praca'}</h2><button type="button" aria-label="Zamknij wpis" onClick={onClose}>×</button></div>
    <form onSubmit={async e => { e.preventDefault(); if (closed) return; if (await onSave({ action: 'edit', id: entry.id, version: entry.version, text, nextStep: step, estimateMinutes: estimate })) onClose(); }}>
      <label htmlFor="o-edit-text">Pełna treść wpisu</label><textarea id="o-edit-text" value={text} onChange={e => setText(e.target.value)} maxLength={4000} required readOnly={closed} />
      <label htmlFor="o-edit-step">Następny krok</label><textarea id="o-edit-step" className="o-step-input" value={step} onChange={e => setStep(e.target.value)} maxLength={1000} readOnly={closed} placeholder="Co dokładnie zrobisz jako pierwsze?" />
      <label htmlFor="o-estimate">Szacowany czas w minutach</label><input id="o-estimate" type="number" min={1} max={480} value={estimate} onChange={e => setEstimate(Number(e.target.value))} readOnly={closed} />
      {error && <div role="alert" className="o-error"><p>{error}</p><button type="button" onClick={onReload}>Wczytaj aktualny wpis</button></div>}
      <div className="o-actions">{!closed && <button className="o-primary" disabled={busy}>Zapisz następny krok</button>}<button type="button" onClick={onClose}>Wróć do dnia</button></div>
    </form>
  </dialog>;
}

type ReportRollup = {
  fromDate: string;
  toDate: string;
  reportCount: number;
  doneCount: number;
  unfinishedCount: number;
  seconds: number;
  nextSteps: { date: string; text: string }[];
  blockers: { date: string; text: string }[];
};

function shiftedDate(date: string, days: number) {
  return new Date(Date.parse(date + 'T12:00:00Z') + days * 86400000).toISOString().slice(0, 10);
}
function latestReportsByDate(reports: OrganizerReport[]) {
  const latest = new Map<string, OrganizerReport>();
  for (const report of [...reports].sort((a, b) => b.generatedAt.localeCompare(a.generatedAt))) {
    if (!latest.has(report.date)) latest.set(report.date, report);
  }
  return latest;
}
function reportRollup(reports: OrganizerReport[], toDate: string, days: number): ReportRollup {
  const fromDate = shiftedDate(toDate, -(days - 1));
  const selected = [...latestReportsByDate(reports).values()]
    .filter(report => report.date >= fromDate && report.date <= toDate)
    .sort((a, b) => b.date.localeCompare(a.date) || b.generatedAt.localeCompare(a.generatedAt));
  const taskState = new Map<string, 'done' | 'open'>();
  const steps: { date: string; text: string }[] = [];
  const stepKeys = new Set<string>();
  const blockers: { date: string; text: string }[] = [];
  const blockerKeys = new Set<string>();
  for (const report of selected) {
    for (const entry of report.done) if (!taskState.has(entry.id)) taskState.set(entry.id, 'done');
    for (const entry of report.unfinished) if (!taskState.has(entry.id)) taskState.set(entry.id, 'open');
    const candidates = [report.nextStep, ...report.unfinished.map(entry => entry.nextStep)].map(step => step.trim()).filter(Boolean);
    for (const step of candidates) if (!stepKeys.has(step) && steps.length < 6) {
      stepKeys.add(step); steps.push({ date: report.date, text: step });
    }
    const blocker = report.blocker.trim();
    if (blocker && !blockerKeys.has(blocker) && blockers.length < 4) {
      blockerKeys.add(blocker); blockers.push({ date: report.date, text: blocker });
    }
  }
  return {
    fromDate, toDate, reportCount: selected.length,
    doneCount: [...taskState.values()].filter(state => state === 'done').length,
    unfinishedCount: [...taskState.values()].filter(state => state === 'open').length,
    seconds: selected.reduce((total, report) => total + report.seconds, 0),
    nextSteps: steps, blockers,
  };
}

function ReportRollupView({ title, rollup }: { title: string; rollup: ReportRollup }) {
  return <article className="o-report-rollup">
    <div className="o-rollup-heading"><div><span>OKNO RAPORTOWE</span><h3>{title}</h3></div><time>{rollup.fromDate} → {rollup.toDate}</time></div>
    <div className="o-rollup-totals">
      <p><strong>{rollup.reportCount}</strong><span>dni z raportem</span></p>
      <p><strong>{rollup.doneCount}</strong><span>ukończone</span></p>
      <p><strong>{rollup.unfinishedCount}</strong><span>otwarte</span></p>
      <p><strong>{Math.floor(rollup.seconds / 60)}</strong><span>min pracy</span></p>
    </div>
    <div className="o-rollup-columns">
      <section><h4>Kolejne kroki</h4>{rollup.nextSteps.length ? <ol>{rollup.nextSteps.map((step, index) => <li key={step.date + ':' + index}><span>{step.date}</span>{step.text}</li>)}</ol> : <p>Brak zapisanego następnego kroku w tym oknie.</p>}</section>
      <section><h4>Blokery</h4>{rollup.blockers.length ? <ul>{rollup.blockers.map((blocker, index) => <li key={blocker.date + ':' + index}><span>{blocker.date}</span>{blocker.text}</li>)}</ul> : <p>Brak zapisanych blockerów w tym oknie.</p>}</section>
    </div>
    <p className="o-rollup-coverage">Podsumowanie używa wyłącznie istniejących immutable raportów dziennych — brakujące dni nie są uzupełniane przez AI.</p>
  </article>;
}

function DailyReport({ report }: { report: OrganizerReport }) {
  return <article className="o-daily-report" aria-label="Raport osobistego dnia">
    <div className="o-report-meta"><span>{report.source === 'schedule' ? 'Z harmonogramu' : 'Na wywołanie'}</span><time>{new Date(report.generatedAt).toLocaleString('pl-PL', { timeZone: report.timezone })}</time></div>
    <div className="o-report-totals"><p><strong>{report.done.length}</strong> ukończone</p><p><strong>{report.unfinished.length}</strong> otwarte priorytety</p><p><strong>{Math.floor(report.seconds / 60)}</strong> min pracy</p></div>
    <div className="o-report-columns"><section><h3>Co skończone</h3>{report.done.length ? report.done.map(e => <details key={e.id}><summary>{label(e)}</summary><p className="o-fulltext">{e.text}</p></details>) : <p>Nie oznaczono ukończonej pracy.</p>}</section>
      <section><h3>Do dokończenia</h3>{report.unfinished.length ? report.unfinished.map(e => <details key={e.id}><summary>{label(e)}</summary><p className="o-fulltext">{e.text}</p>{e.nextStep && <p>Następny krok: {e.nextStep}</p>}</details>) : <p>Nie zostały otwarte priorytety.</p>}</section></div>
    {report.nextStep && <div className="o-report-next"><span>Najbliższy krok</span><p>{report.nextStep}</p></div>}
    {report.notes && <p className="o-fulltext">{report.notes}</p>}
    {report.blocker && <p className="o-fulltext">Przeszkoda: {report.blocker}</p>}
    <p className="o-footnote">{report.blockOpen ? 'Raport uwzględnia trwający blok w chwili zapisu. ' : ''}Zapis zachowuje stan dnia. Oznaczenia ukończenia są Twoją deklaracją.</p>
  </article>;
}
export default function Organizer({ identity, api, onNavigate, onTool, onLogout, workspace, workspaceView, workspaceName, globalError, onClearGlobalError, projects, schedules, modelReady, onSchedule }: Props) {
  const [data, setData] = useState<OrganizerSnapshot>();
  const [chosenDate, setChosenDate] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [connection, setConnection] = useState<'loading' | 'ok' | 'offline'>('loading');
  const [busy, setBusy] = useState(false);
  const [focused, setFocused] = useState(false);
  const [capture, setCapture] = useState('');
  const [list, setList] = useState<List>('inbox');
  const [pageEntries, setPageEntries] = useState<OrganizerEntry[]>([]);
  const [cursor, setCursor] = useState<string | undefined>();
  const [pageLoaded, setPageLoaded] = useState(false);
  const [editor, setEditor] = useState<OrganizerEntry>();
  const [duration, setDuration] = useState(25);
  const [budget, setBudget] = useState('90');
  const [timezone, setTimezone] = useState('Europe/Amsterdam');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [eveningOpen, setEveningOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [scheduleAt, setScheduleAt] = useState('21:00');
  const [scheduleBusy, setScheduleBusy] = useState(false);
  const [selectedReportId, setSelectedReportId] = useState('');
  const [notes, setNotes] = useState('');
  const [blocker, setBlocker] = useState('');
  const [tomorrowId, setTomorrowId] = useState('');
  const [, setTick] = useState(0);
  const apiRef = useRef(api), dateRef = useRef(chosenDate), busyRef = useRef(false);
  const sequence = useRef(0), anchor = useRef({ server: Date.now(), client: performance.now() });
  const captureRef = useRef<HTMLTextAreaElement>(null);
  const pageSequence = useRef(0), readFailed = useRef(false);
  apiRef.current = api; dateRef.current = chosenDate;
  function accept(snapshot: OrganizerSnapshot) {
    anchor.current = { server: Date.parse(snapshot.serverNow), client: performance.now() };
    setData(snapshot); setConnection('ok');
  }
  async function load(date = dateRef.current) {
    const seq = ++sequence.current;
    try {
      const snapshot = await apiRef.current<OrganizerSnapshot>('/api/organizer' + (date ? '?date=' + encodeURIComponent(date) : ''));
      if (seq === sequence.current) { if (readFailed.current) { setError(''); readFailed.current = false; } accept(snapshot); }
    } catch (e) {
      if (seq === sequence.current) { readFailed.current = true; setConnection('offline'); setError(e instanceof Error ? e.message : 'Brak połączenia. Ponów odczyt.'); }
    }
  }
  useEffect(() => {
    void load();
    const poll = setInterval(() => { if (!busyRef.current) void load(); }, 3000);
    const resume = () => { if (!busyRef.current && document.visibilityState === 'visible') void load(); };
    document.addEventListener('visibilitychange', resume);
    const ticker = setInterval(() => setTick(x => x + 1), 500);
    return () => { sequence.current++; clearInterval(poll); clearInterval(ticker); document.removeEventListener('visibilitychange', resume); };
  }, [identity.tenantId, identity.subject]);
  useEffect(() => { if (!busyRef.current) void load(chosenDate); }, [chosenDate]);
  useEffect(() => {
    if (workspace && !focused) document.getElementById('o-workspace-panel')?.scrollIntoView({ behavior: 'instant', block: 'start' });
  }, [workspaceView]);
  useEffect(() => { setPageEntries([]); setCursor(undefined); setPageLoaded(false); pageSequence.current++; }, [list, chosenDate]);
  useEffect(() => { if (data) setPageEntries(old => old.map(e => data.entries.find(x => x.id === e.id) || e)); }, [data]);

  async function act(body: Record<string, unknown>): Promise<boolean> {
    if (!data || busyRef.current || chosenDate && chosenDate !== data.date) return false;
    busyRef.current = true; setBusy(true); setError(''); setNotice('');
    const seq = ++sequence.current;
    try {
      const snapshot = await apiRef.current<OrganizerSnapshot>('/api/organizer', 'POST', { ...body, date: data.date });
      if (seq === sequence.current) accept(snapshot);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nie zapisano zmiany. Spróbuj ponownie.');
      await load(); return false;
    } finally { busyRef.current = false; setBusy(false); }
  }
  async function more() {
    if (busyRef.current || (pageLoaded && !cursor)) return;
    const seq = ++pageSequence.current, bucket = list;
    busyRef.current = true; setBusy(true); setError('');
    try {
      const page = await apiRef.current<Page<OrganizerEntry>>('/api/organizer/inbox?status=' + bucket + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''));
      if (seq === pageSequence.current) {
        setPageEntries(old => [...new Map([...old, ...page.items].map(e => [e.id, e])).values()]);
        setCursor(page.nextCursor); setPageLoaded(true);
      }
    } catch (e) { setError(e instanceof Error ? e.message : 'Nie udało się odczytać listy.'); }
    finally { busyRef.current = false; setBusy(false); }
  }

  if (!data) return <div className="o-loading"><strong>OSA</strong><p>{connection === 'offline' ? error : 'Otwieram Twój dzień…'}</p>{connection === 'offline' && <button onClick={() => load()}>Ponów połączenie</button>}</div>;
  const { plan, settings, activeBlock } = data;
  const readOnly = identity.role === 'reader', disabled = busy || readOnly || !!chosenDate && chosenDate !== data.date;
  const entries = new Map([...pageEntries, ...data.entries].map(e => [e.id, e]));
  const closed = !!plan.closureId;
  const closure = data.closures.find(c => c.id === plan.closureId);
  const priorityRecords = closed && closure ? [...closure.done, ...closure.unfinished] : [...entries.values()];
  const priorities = plan.priorityIds.map(id => priorityRecords.find(e => e.id === id)).filter((e): e is OrganizerEntry => !!e);
  const current = activeBlock ? entries.get(activeBlock.entryId) : closed ? undefined : entries.get(plan.currentEntryId);
  const now = anchor.current.server + performance.now() - anchor.current.client;
  const elapsed = activeBlock ? secondsAt(activeBlock, now) : 0;
  const remaining = activeBlock ? Math.max(0, activeBlock.plannedSeconds - elapsed) : duration * 60;
  const planned = priorities.filter(e => e.status !== 'done').reduce((n, e) => n + e.estimateMinutes, 0);
  const done = data.entries.filter(e => plan.completedIds.includes(e.id));
  const daySeconds = data.blocks.filter(b => b.date === data.date).reduce((n, b) => n + secondsAt(b, now), 0);
  const selectedList = [...entries.values()].filter(e => (e.status === list || list === 'later' && e.status === 'ready') && (['done', 'archived'].includes(list) || !plan.priorityIds.includes(e.id))).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  const percent = activeBlock ? Math.min(100, elapsed / activeBlock.plannedSeconds * 100) : 0;
  const dateTitle = new Intl.DateTimeFormat('pl-PL', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(data.date + 'T12:00:00Z'));
  const tomorrowDate = nextDate(data.date);
  const tomorrowPlan = data.plans.find(p => p.date === tomorrowDate);
  const reports = data.reports || [];
  const dayReport = reports.find(r => r.id === selectedReportId) || reports.find(r => r.id === plan.reportId) || reports.find(r => r.date === data.date);
  const reportByDate = latestReportsByDate(reports);
  const latestDayReport = reportByDate.get(data.date);
  const threeDayReport = reportRollup(reports, data.date, 3);
  const weeklyReport = reportRollup(reports, data.date, 7);
  const personalSchedule = schedules.find(s => s.ownerSubject === identity.subject && s.enabled);
  const activeProjects = projects.filter(p => !['completed', 'cancelled'].includes(p.status));
  function openEditor(entry: OrganizerEntry) { setError(''); setEditor(entry); }
  const taskContext = current ? ['Praca: ' + current.text, 'Następny krok: ' + (current.nextStep || 'do ustalenia'), 'Dzień: ' + data.date, 'Dostępny czas: ' + plan.availableMinutes + ' min.', 'To jest kontekst użytkownika, nie niezależny dowód wykonania.'].join('\n') : '';

  return <div className={'o-shell' + (focused ? ' o-focused' : '')}>
    <main className="o-main">
      <div className="o-intro"><button className="o-brand" aria-label="OSA — Mój dzień" onClick={() => { setFocused(false); setChosenDate(''); onNavigate('day'); }}><span>OSA</span><small>build</small></button><p>Twoja przestrzeń.<br /><strong>Twój następny ruch.</strong></p><div className={'o-connection ' + connection}><i />{connection === 'ok' ? 'Zapisane w OSA' : 'Brak połączenia'}</div></div>
      <div className="o-dayline"><div><span className="o-date">{dateTitle}</span><span className="o-private">Twoja prywatna przestrzeń</span></div>
        {focused ? <button className="o-focus-exit" onClick={() => setFocused(false)}>Wyjdź ze skupienia</button> : <div className="o-day-actions"><label className="o-date-picker"><span className="sr-only">Wybierz dzień</span><input type="date" aria-label="Wybierz dzień" value={data.date} disabled={busy} onChange={e => { if (e.target.value) { setChosenDate(e.target.value); setEveningOpen(false); } }} /></label><button disabled={busy} onClick={() => { setBudget(String(plan.availableMinutes)); setTimezone(settings.timezone); setSettingsOpen(x => !x); }}>Mam {plan.availableMinutes} min</button><button className="o-evening-button" onClick={() => { setEveningOpen(true); setTimeout(() => document.getElementById('o-evening')?.scrollIntoView({ behavior: 'instant', block: 'start' }), 0); }}>{closed ? 'Zapis dnia' : 'Domknij dzień'}</button></div>}
      </div>
      {globalError && <div className="o-error" role="alert"><p>{globalError}</p><button aria-label="Zamknij błąd" onClick={onClearGlobalError}>×</button></div>}
      {readOnly && <p className="o-callout">Konto z dostępem do odczytu. Możesz przeglądać własny plan.</p>}
      {error && !editor && <div className="o-error" role="alert"><p>{error}</p><button aria-label="Zamknij błąd" onClick={() => setError('')}>×</button></div>}
      {notice && <p className="o-notice" role="status">{notice}</p>}
      {connection === 'offline' && <div className="o-callout">Pokazuję ostatni odczyt. <button onClick={() => load()}>Ponów odczyt</button></div>}
      {settingsOpen && !focused && <form className="o-settings" onSubmit={async e => { e.preventDefault(); if (await act({ action: 'settings', version: plan.version, availableMinutes: Number(budget), settingsVersion: settings.version, timezone })) setSettingsOpen(false); }}>
        <div><label htmlFor="o-budget">Dostępny czas tego dnia w minutach</label><input id="o-budget" type="number" min={0} max={720} value={budget} onChange={e => setBudget(e.target.value)} required /></div>
        <div><label htmlFor="o-timezone">Strefa czasowa</label><input id="o-timezone" value={timezone} onChange={e => setTimezone(e.target.value)} required /></div>
        <button className="o-primary" disabled={disabled || closed}>Zapisz czas</button><button type="button" onClick={() => setSettingsOpen(false)}>Zamknij</button>
      </form>}
      <section className="o-now" aria-labelledby="o-now-title">
        <div className="o-now-copy">
          <div className="o-now-label"><span>Teraz</span><div><i />{closed && !activeBlock ? 'Dzień domknięty' : activeBlock?.status === 'paused' ? 'Blok w pauzie' : activeBlock ? 'Jedna rzecz w toku' : 'Twój następny ruch'}</div></div>
          <h1 id="o-now-title">{current ? label(current) : closed ? 'Odłóż ten dzień.\nWrócisz jutro.' : 'Ustaw swój dzień.'}</h1>
          {current ? <>
            <div className="o-next-step"><span>Następny krok</span><p>{activeBlock?.nextStep || current.nextStep || 'Zapisz pierwszy mały krok. To wystarczy, żeby zacząć.'}</p>{!activeBlock && <button onClick={() => openEditor(current)} disabled={disabled || closed}>{current.nextStep ? 'Edytuj zadanie' : 'Zapisz następny krok'}</button>}</div>
            <div className="o-now-actions"><button className="o-primary" disabled={disabled || !!activeBlock || closed} onClick={async () => { if (await act({ action: 'block.start', id: current.id, version: plan.version, settingsVersion: settings.version, minutes: duration })) { setFocused(true); setNotice('Blok rozpoczęty. Teraz tylko ta jedna rzecz.'); } }}>Rozpocznij blok <span>↗</span></button><button disabled={disabled || !!activeBlock || closed} onClick={() => act({ action: 'complete', id: current.id, version: current.version })}>Oznacz ukończenie</button>{!focused && <button className="o-quiet" onClick={() => setFocused(true)}>Skup się</button>}</div>
            {activeBlock?.date !== undefined && activeBlock.date !== data.date && <p className="o-callout">Otwarty blok pochodzi z {activeBlock.date}. Zakończ go przed nową pracą.</p>}
          </> : <>
            <p className="o-now-empty">{closed ? 'Twój zapis jest poniżej. Jedna wybrana praca może czekać na jutro.' : 'Zapisz to, co masz w głowie. Wybierz trzy priorytety i jeden pierwszy krok.'}</p>
            {!closed && <button className="o-primary" onClick={() => { setFocused(false); setTimeout(() => { captureRef.current?.focus(); captureRef.current?.scrollIntoView({ behavior: 'instant', block: 'center' }); }, 0); }}>Zrzuć myśli do skrzynki <span>↓</span></button>}
          </>}
        </div>
        <aside className="o-block" aria-label="Blok pracy">
          <div className="o-timer-circle" style={{ '--progress': percent + '%' } as CSSProperties}><div className="o-timer-inner"><span>{activeBlock?.status === 'paused' ? 'Pauza' : activeBlock ? remaining ? 'Zostało' : 'Czas minął' : 'Twój blok'}</span><strong className="o-timer" aria-label="Czas bloku">{clock(remaining)}</strong><small>{activeBlock ? Math.floor(elapsed / 60) + ' min pracy' : 'Jedna rzecz. Bez przeskakiwania.'}</small></div></div>
          {activeBlock ? <div className="o-block-actions"><button className="o-primary" disabled={disabled} onClick={() => act({ action: activeBlock.status === 'running' ? 'block.pause' : 'block.resume', id: activeBlock.id, version: activeBlock.version })}>{activeBlock.status === 'running' ? 'Pauza' : 'Wznów blok'}</button><button disabled={disabled} onClick={() => act({ action: 'block.finish', id: activeBlock.id, version: activeBlock.version })}>Zakończ blok</button></div> : <div className="o-durations" aria-label="Długość bloku">{[5, 15, 25, 50].map(m => <button key={m} aria-pressed={duration === m} disabled={closed} onClick={() => setDuration(m)}>{m} min</button>)}</div>}
          <p className="o-block-note">{activeBlock ? 'Stan bloku jest zapisany. Możesz wrócić po odświeżeniu.' : 'Start potrzebuje wybranego zadania i następnego kroku.'}</p>
        </aside>
      </section>
      {!focused && <>
        <div className="o-day-layout">
          <section className="o-priorities" aria-labelledby="o-priorities-title"><div className="o-section-heading"><h2 id="o-priorities-title">Na dziś</h2><span>{priorities.length} / 3 priorytety</span></div>
            <div className="o-budget-line"><span><b>{planned}</b> min zaplanowane</span><span>z {plan.availableMinutes} dostępnych</span><div className="o-budget-track"><i style={{ width: Math.min(100, plan.availableMinutes ? planned / plan.availableMinutes * 100 : planned ? 100 : 0) + '%' }} /></div></div>
            {planned > plan.availableMinutes && <p className="o-budget-warning" role="status">Plan przekracza Twój czas o {planned - plan.availableMinutes} min. Skróć krok lub odłóż jedną sprawę.</p>}
            <div className="o-priority-list">{priorities.map((e, i) => <article className={'o-priority' + (current?.id === e.id ? ' o-selected' : '') + (e.status === 'done' ? ' o-done' : '')} key={e.id}>
              <span className="o-order">{e.status === 'done' ? '✓' : String(i + 1).padStart(2, '0')}</span><div><button className="o-entry-title" onClick={() => openEditor(e)}>{label(e)}</button><p>{e.status === 'done' ? 'Ukończone' : e.nextStep || 'Jeszcze bez następnego kroku'}</p></div><span className="o-estimate">{e.estimateMinutes} min</span>
              <div className="o-priority-actions"><button disabled={disabled || closed || e.status === 'done' || !!activeBlock && activeBlock.entryId !== e.id} aria-pressed={current?.id === e.id} onClick={() => act({ action: 'select', id: e.id, version: plan.version })}>{current?.id === e.id ? 'Teraz' : 'Wybierz'}</button><button className="o-remove" aria-label={'Zdejmij z dziś: ' + label(e)} disabled={disabled || closed || activeBlock?.entryId === e.id} onClick={() => act({ action: 'priority.remove', id: e.id, version: plan.version })}>×</button></div>
            </article>)}
              {Array.from({ length: 3 - priorities.length }, (_, i) => <div className="o-priority-slot" key={i}><span className="o-order">{String(priorities.length + i + 1).padStart(2, '0')}</span><span>{priorities.length === 0 && i === 0 ? 'Wybierz pierwszą pracę ze skrzynki.' : 'Miejsce może zostać puste.'}</span></div>)}
            </div>
            <div className="o-day-progress"><span><i />{done.length ? done.length + ' ukończone' : 'Jeszcze nic nie oznaczono jako ukończone'}</span><span>{Math.floor(daySeconds / 60)} min w blokach</span></div>
          </section>
          <section className="o-capture" aria-labelledby="o-capture-title"><div className="o-section-heading"><h2 id="o-capture-title">Zrzuć z głowy</h2><span>Do skrzynki</span></div><p>Pomysł, zadanie, pytanie. Zachowaj je i wróć do jednej rzeczy.</p>
            <form onSubmit={async e => { e.preventDefault(); if (await act({ action: 'capture', text: capture })) { setCapture(''); setList('inbox'); setNotice('Zapisane w skrzynce. Wybierzesz, kiedy się tym zajmiesz.'); } }}><label className="sr-only" htmlFor="o-capture">Myśl do skrzynki</label><textarea id="o-capture" ref={captureRef} maxLength={4000} value={capture} onChange={e => setCapture(e.target.value)} placeholder="Co siedzi Ci w głowie?" required /><div className="o-capture-actions"><span>{capture.length} / 4000</span><button className="o-primary" disabled={disabled || !capture.trim()}>Zapisz w skrzynce <span>+</span></button></div></form>
            <small>Wpis czeka tutaj, dopóki sam go nie wybierzesz.</small>
          </section>
        </div>
        <section className="o-workbench" aria-label="Pracownia OSA">
          <div className="o-workbench-heading"><div><h2>Pracownia OSA</h2><p>Projekty, narzędzia i nauka. Twój dzień zostaje tutaj.</p></div><span>{activeProjects.length} aktywne projekty</span></div>
          <nav className="o-workspace-nav" aria-label="Przestrzenie OSA">
            {([['day', 'Mój dzień'], ['room', 'Projekty'], ['engines', 'Narzędzia'], ['runs', 'Wykonania'], ['proof', 'Dowody i zgody'], ['learn', 'Akademia / Certyfikat'], ['rhythm', 'Rytm / raporty'], ['platform', 'Platforma']] as const).map(([id, title]) =>
              <button key={id} aria-pressed={workspaceView === id} onClick={() => onNavigate(id)}>{title}{id === 'room' && activeProjects.length > 0 && <small>{activeProjects.length}</small>}</button>)}
          </nav>
          <section className="o-tools-context" aria-label="Narzędzia dla bieżącego zadania">
            <div><h3>{current ? 'Z kontekstem bieżącej pracy' : 'Wybierz narzędzie'}</h3><p>{modelReady ? 'Model połączony.' : 'Prompt God i raporty działają lokalnie. Pozostałe silniki potrzebują modelu.'}</p></div>
            <div className="o-tool-links">{tools.map(([id, title]) => <button key={id} onClick={() => id === 'certificate' ? onNavigate('learn') : onTool(id, taskContext)}>{title}<span aria-hidden="true">↗</span></button>)}</div>
          </section>
          {workspace && <section className="o-workspace-panel" id="o-workspace-panel" aria-label={workspaceName}><div className="o-workspace-heading"><h2>{workspaceName}</h2><button onClick={() => onNavigate('day')}>Zamknij pracownię</button></div>{workspace}</section>}
        </section>
        <section className="o-personal-reports" aria-label="Raporty osobiste">
          {workspaceView === 'rhythm' && <div className="o-report-dashboard" aria-label="Dashboard raportów OSA">
            <div className="o-report-dashboard-heading"><div><span>RAPORTY / 1 · 3 · 7 DNI</span><h2>Stan pracy i następne ruchy.</h2></div><p>Jedno źródło prawdy: zapisane raporty dzienne. Bez modelu, bez dopowiadania brakujących faktów.</p></div>
            <section className="o-report-today" aria-label="Raport dzienny">
              <div className="o-rollup-heading"><div><span>DZIŚ / RAPORT DZIENNY</span><h3>{data.date}</h3></div><span>{latestDayReport ? 'snapshot zapisany' : 'czeka na raport'}</span></div>
              {latestDayReport ? <DailyReport report={latestDayReport} /> : <div className="o-report-empty"><strong>Brak raportu dziennego dla tego dnia.</strong><p>Wygeneruj go ręcznie albo zostaw aktywny harmonogram raz dziennie. Dashboard nie wymyśla brakujących danych.</p></div>}
            </section>
            <div className="o-report-window-grid">
              <ReportRollupView title="Ostatnie 3 dni" rollup={threeDayReport} />
              <ReportRollupView title="Tydzień / ostatnie 7 dni" rollup={weeklyReport} />
            </div>
          </div>}
          <div className="o-reports-heading"><div><h2>Raport dnia</h2><p>{personalSchedule ? 'Wieczorem o ' + String(personalSchedule.hour).padStart(2, '0') + ':' + String(personalSchedule.minute).padStart(2, '0') + ' · ' + personalSchedule.timezone : 'Ukończone, otwarte sprawy i jeden następny krok.'}</p></div><div className="o-actions"><button className="o-primary" disabled={disabled} onClick={async () => { if (await act({ action: 'report.generate' })) { setSelectedReportId(''); setReportOpen(true); } }}>Wygeneruj raport</button>{dayReport && <button onClick={() => setReportOpen(open => !open)}>{reportOpen ? 'Zwiń raport' : 'Pokaż raport'}</button>}</div></div>
          {!personalSchedule && identity.role === 'owner' && <form className="o-schedule-form" onSubmit={async e => { e.preventDefault(); if (scheduleBusy) return; setScheduleBusy(true); try { const [hour, minute] = scheduleAt.split(':').map(Number); await onSchedule(hour!, minute!, settings.timezone); } finally { setScheduleBusy(false); } }}><label htmlFor="o-schedule-time">Raport co wieczór</label><input id="o-schedule-time" aria-label="Godzina raportu wieczornego" type="time" value={scheduleAt} onChange={e => setScheduleAt(e.target.value)} required /><button disabled={disabled || scheduleBusy}>Włącz raport wieczorny</button><span>Raport powstaje, gdy OSA działa.</span></form>}
          {reportOpen && dayReport && <DailyReport report={dayReport} />}
          {reports.length > 1 && <details className="o-report-history"><summary>Historia raportów</summary><div>{reports.map(report => <button key={report.id} onClick={() => { setSelectedReportId(report.id); setReportOpen(true); }}>{report.date}<span>{new Date(report.generatedAt).toLocaleTimeString('pl-PL', { timeZone: report.timezone, hour: '2-digit', minute: '2-digit' })}</span></button>)}</div>{data.coverage.reportsHaveMore && <p>Wyświetlono ostatnie 30 raportów oraz raport wybranego dnia.</p>}</details>}
        </section>
        <section className="o-inbox" aria-label="Zapisane sprawy">
          <div className="o-inbox-heading"><nav className="o-list-tabs" aria-label="Listy organizera">{(Object.keys(listLabels) as List[]).map(bucket => <button key={bucket} aria-pressed={list === bucket} onClick={() => setList(bucket)}>{listLabels[bucket]}{bucket === 'inbox' && <span>{[...entries.values()].filter(e => e.status === 'inbox').length}{data.coverage.entriesHaveMore ? '+' : ''}</span>}</button>)}</nav><span className="o-list-hint">{list === 'inbox' ? 'Zapisane nie znaczy zaplanowane.' : list === 'archived' ? 'Możesz przywrócić pełną treść.' : list === 'later' ? 'Nie wszystko musi wydarzyć się dziś.' : 'Twoje oznaczenia ukończenia.'}</span></div>
          {selectedList.length ? selectedList.map(e => <article className="o-inbox-row" key={e.id}><div><button className="o-entry-title" onClick={() => openEditor(e)}>{label(e)}</button>{e.nextStep && <p>{e.nextStep}</p>}</div><span className="o-estimate">{e.estimateMinutes} min</span><div className="o-inbox-actions">{e.status === 'archived' ? <button disabled={disabled} onClick={() => act({ action: 'restore', id: e.id, version: e.version })}>Przywróć</button> : <>
            {e.status !== 'done' && <button disabled={disabled || closed} onClick={() => act({ action: 'priority.add', id: e.id, version: plan.version })}>Na dziś</button>}
            {e.status === 'inbox' && <button className="o-quiet" disabled={disabled} onClick={() => act({ action: 'move', id: e.id, version: e.version, status: 'later' })}>Później</button>}
            <button className="o-quiet" disabled={disabled} onClick={() => act({ action: 'move', id: e.id, version: e.version, status: 'archived' })}>Archiwizuj</button>
          </>}</div></article>) : <div className="o-list-empty"><span>{list === 'inbox' ? 'Skrzynka ma miejsce na Twoje myśli.' : list === 'later' ? 'Nic nie czeka na później.' : list === 'archived' ? 'Archiwum jest puste.' : 'Oznacz ukończenie, gdy praca będzie gotowa.'}</span><p>{list === 'inbox' ? 'Zapisz myśl powyżej. Nie musisz od razu znać całego planu.' : 'Tutaj pojawią się Twoje zapisane sprawy.'}</p></div>}
          {data.coverage.entriesHaveMore && (!pageLoaded || cursor) && <button className="o-load-more" disabled={busy} onClick={more}>Pokaż starsze wpisy</button>}
        </section>
        <section id="o-evening" className={'o-evening' + (eveningOpen || closed ? ' o-evening-open' : '')} aria-label="Domknięcie dnia">
          <div className="o-evening-heading"><div><span>Na koniec dnia</span><h2>Zostaw sobie dobry punkt powrotu.</h2><p>Co skończone, co zostało i jeden następny ruch.</p></div>{!closed && <button onClick={() => setEveningOpen(x => !x)}>{eveningOpen ? 'Zwiń domknięcie' : 'Domknij dzień'}</button>}</div>
          {closed && closure ? <><Closure report={closure} /><button className="o-primary o-tomorrow-link" onClick={() => { setChosenDate(closure.tomorrowDate); setEveningOpen(false); }}>Przejdź do jutra</button></> : eveningOpen && <form className="o-evening-form" onSubmit={async e => { e.preventDefault(); if (await act({ action: 'close', version: plan.version, notes, blocker, tomorrowId, tomorrowVersion: tomorrowPlan?.version || 0 })) { setNotes(''); setBlocker(''); setTomorrowId(''); setNotice('Dzień domknięty. Zapis i punkt powrotu są zachowane.'); } }}>
            <div className="o-evening-summary"><div><b>{done.length}</b><span>ukończone</span></div><div><b>{priorities.filter(e => e.status !== 'done').length}</b><span>niedokończone priorytety</span></div><div><b>{Math.floor(daySeconds / 60)}</b><span>min w blokach</span></div></div>
            <div className="o-evening-inputs"><div><label htmlFor="o-notes">Co dziś zadziałało?</label><textarea id="o-notes" value={notes} onChange={e => setNotes(e.target.value)} maxLength={4000} placeholder="Jedna rzecz, którą chcesz zachować…" /></div><div><label htmlFor="o-blocker">Co zatrzymało pracę?</label><textarea id="o-blocker" value={blocker} onChange={e => setBlocker(e.target.value)} maxLength={2000} placeholder="Konkretna przeszkoda, bez oceniania siebie…" /></div></div>
            <label htmlFor="o-tomorrow">Jedna praca na jutro</label><select id="o-tomorrow" value={tomorrowId} onChange={e => setTomorrowId(e.target.value)}><option value="">Wybiorę później</option>{[...entries.values()].filter(e => !['done', 'archived'].includes(e.status)).map(e => <option key={e.id} value={e.id}>{label(e)}</option>)}</select>
            {activeBlock && <p className="o-budget-warning">Najpierw zakończ otwarty blok pracy. Domknięcie zapisuje gotowy stan dnia.</p>}
            <div className="o-actions"><button className="o-primary" disabled={disabled || !!activeBlock}>Zapisz i domknij dzień</button><span>Ten zapis zachowuje stan dnia i Twoje notatki.</span></div>
          </form>}
        </section>
        {data.closures.some(c => c.date !== data.date) && <details className="o-history"><summary>Poprzednie domknięcia</summary>{data.closures.filter(c => c.date !== data.date).map(c => <button key={c.id} onClick={() => { setChosenDate(c.date); setEveningOpen(true); }}>{c.date}<span>{c.done.length} ukończone · {Math.floor(c.seconds / 60)} min</span></button>)}</details>}
      </>}
    </main>
    <footer className="o-footer"><span>OSA <i />Twoje miejsce do pracy.</span><div><span>{identity.subject} · prywatny organizer</span><button aria-label="Wyloguj" onClick={async () => { try { await onLogout(); } catch (e) { setError(e instanceof Error ? e.message : 'Nie udało się wylogować.'); } }}>Wyloguj</button></div></footer>
    {editor && <EntryEditor key={editor.id + ':' + editor.version} entry={editor} busy={busy} error={error} readOnly={readOnly || closed && plan.priorityIds.includes(editor.id) || activeBlock?.entryId === editor.id} onSave={act} onClose={() => { setEditor(undefined); setError(''); }} onReload={() => { const latest = data.entries.find(e => e.id === editor.id); if (latest) { setEditor(latest); setError(''); } }} />}
  </div>;
}
