import { useEffect, useRef, useState } from 'react';
import Organizer from './Organizer';
import type {
  Approval,
  AuditEvent,
  Evidence,
  Identity,
  LearningSession,
  Mission,
  Run,
  Schedule,
} from '../../../packages/kernel/src/contracts';
import { catalog } from '../../../packages/engines/src/catalog';
import type { Kernel } from '../../../packages/kernel/src/service';
type Report = Awaited<ReturnType<Kernel['report']>>;
type Boot = {
  identity: Identity;
  report: Report;
  approvals: Approval[];
  schedules: Schedule[];
  learning: LearningSession[];
  integrations: { id: string; status: string; detail: string }[];
};
type View =
  'day' | 'room' | 'engines' | 'runs' | 'proof' | 'learn' | 'rhythm' | 'platform';
const areas = [
  { id: 'day', name: 'Mój dzień', mark: '◉' },
  { id: 'room', name: 'Projekty', mark: '01' },
  { id: 'engines', name: 'Narzędzia', mark: '02' },
  { id: 'runs', name: 'Wykonania', mark: '03' },
  { id: 'proof', name: 'Proof & zgody', mark: '04' },
  { id: 'learn', name: 'Akademia / Certyfikat', mark: '05' },
  { id: 'rhythm', name: 'Rytm / raporty', mark: '06' },
  { id: 'platform', name: 'Platforma', mark: '07' },
] as const;
const statuses: Record<string, string> = {
  queued: 'W kolejce',
  running: 'Wykonywane',
  succeeded: 'Wykonane',
  failed: 'Błąd',
  cancelled: 'Anulowane',
  draft: 'Szkic',
  active: 'W toku',
  completed: 'Zamknięte',
};
export default function App() {
  const [boot, setBoot] = useState<Boot>();
  const [identity, setIdentity] = useState<Identity>();
  const [csrf, setCsrf] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [view, setView] = useState<View>('day');
  const [selected, setSelected] = useState('');
  const [token, setToken] = useState('');
  const [title, setTitle] = useState('');
  const [step, setStep] = useState('');
  const [artifact, setArtifact] = useState('');
  const [engineId, setEngineId] = useState('prompt');
  const [context, setContext] = useState('');
  const [url, setUrl] = useState('');
  const [webSearch, setWebSearch] = useState(false);
  const [attachMission, setAttachMission] = useState(false);
  const [result, setResult] = useState<Run>();
  const [filter, setFilter] = useState('');
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [auditValid, setAuditValid] = useState<boolean>();
  const [sessionId, setSessionId] = useState('');
  const [observation, setObservation] = useState('');
  const [exam, setExam] = useState(false);
  const [sharing, setSharing] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const [minutes, setMinutes] = useState(25);
  const [remaining, setRemaining] = useState(1500);
  const [running, setRunning] = useState(false);
  const elapsed = useRef(0);
  const started = useRef(0);
  const deadline = useRef(0);
  const [clock, setClock] = useState(Date.now());
  const [at, setAt] = useState('21:00');
  const [timezone, setTimezone] = useState('Europe/Amsterdam');
  const [focused, setFocused] = useState(false);
  const mission =
    boot?.report.missions.find((m) => m.id === selected) ||
    boot?.report.missions.find(
      (m) => !['completed', 'cancelled'].includes(m.status),
    );
  const learning = boot?.learning.find((s) => s.id === sessionId);
  const engine = catalog.find((e) => e.id === engineId)!;
  async function api<T>(
    path: string,
    method = 'GET',
    body?: unknown,
  ): Promise<T> {
    const response = await fetch(path, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-OSA-CSRF': csrf },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
    });
    const data = await response.json();
    if (!response.ok) {
      if (response.status === 401) {
        setIdentity(undefined);
        setBoot(undefined);
      }
      throw new Error(data.error?.message || 'Nie udało się wykonać operacji.');
    }
    return data;
  }
  async function refresh() {
    const data = await api<Boot>('/api/bootstrap');
    setBoot(data);
    setIdentity(data.identity);
    setResult((old) =>
      old ? data.report.runs.find((r) => r.id === old.id) || old : undefined,
    );
  }
  async function work(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Operacja nie powiodła się.');
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    fetch('/api/auth/me')
      .then(async (r) => {
        if (r.ok) {
          const data = await r.json();
          setIdentity(data.identity);
          setCsrf(data.csrf || '');
          const b = await fetch('/api/bootstrap');
          if (b.ok) setBoot(await b.json());
        }
      })
      .catch(() => setError('Brak połączenia z backendem OSA.'))
      .finally(() => setReady(true));
    return () => stream.current?.getTracks().forEach((t) => t.stop());
  }, []);
  useEffect(() => {
    if (!identity) return;
    let active = true;
    const poll = setInterval(() => {
      fetch('/api/bootstrap')
        .then(async (r) => {
          if (!active) return;
          if (r.status === 401) {
            setIdentity(undefined);
            setBoot(undefined);
            return;
          }
          if (r.ok) {
            const b: Boot = await r.json();
            setBoot(b);
            setResult((old) =>
              old
                ? b.report.runs.find((x) => x.id === old.id) || old
                : undefined,
            );
          }
        })
        .catch(() => undefined);
    }, 2500);
    return () => {
      active = false;
      clearInterval(poll);
    };
  }, [identity?.subject]);
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => {
      const n = Math.max(0, Math.ceil((deadline.current - Date.now()) / 1000));
      setRemaining(n);
      setClock(Date.now());
      if (!n) {
        elapsed.current += (Date.now() - started.current) / 1000;
        setRunning(false);
      }
    }, 500);
    return () => clearInterval(t);
  }, [running]);
  useEffect(() => {
    if (sharing && video.current && stream.current) {
      video.current.srcObject = stream.current;
      void video.current.play();
    }
  }, [sharing]);
  function stopShare() {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    setSharing(false);
  }
  function navigate(v: View) {
    stopShare();
    setView(v);
    setError('');
  }
  async function patchMission(body: Record<string, unknown>) {
    if (!mission || busy) return;
    if (typeof body.stepId === 'string' && typeof body.done === 'boolean') {
      setBoot(
        (current) =>
          current && {
            ...current,
            report: {
              ...current.report,
              missions: current.report.missions.map((m) =>
                m.id === mission.id
                  ? {
                      ...m,
                      steps: m.steps.map((s) =>
                        s.id === body.stepId
                          ? { ...s, done: body.done as boolean }
                          : s,
                      ),
                    }
                  : m,
              ),
            },
          },
      );
    }
    await work(async () => {
      try {
        await api('/api/missions/' + mission.id, 'PATCH', {
          version: mission.version,
          ...body,
        });
      } finally {
        await refresh();
      }
    });
  }
  async function enqueue(
    id = engineId,
    data: Record<string, unknown> = { context, url, webSearch },
  ) {
    await work(async () => {
      const run = await api<Run>('/api/runs', 'POST', {
        engine: id,
        input: data,
        idempotencyKey: crypto.randomUUID(),
        missionId: attachMission ? mission?.id : undefined,
      });
      setResult(run);
      await refresh();
    });
  }
  async function share() {
    try {
      if (!navigator.mediaDevices?.getDisplayMedia)
        throw new Error(
          'Ta przeglądarka nie udostępnia wyboru okna. Wklej obserwację.',
        );
      stream.current = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false,
      });
      stream.current.getVideoTracks()[0].onended = stopShare;
      setSharing(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Udostępnianie anulowane.');
    }
  }
  async function frame() {
    if (!learning || !video.current?.videoWidth) return;
    await work(async () => {
      const v = video.current!,
        canvas = document.createElement('canvas');
      const scale = Math.min(1, 800 / v.videoWidth, 600 / v.videoHeight);
      canvas.width = v.videoWidth * scale;
      canvas.height = v.videoHeight * scale;
      canvas.getContext('2d')!.drawImage(v, 0, 0, canvas.width, canvas.height);
      let quality = 0.5,
        image = canvas.toDataURL('image/jpeg', quality).split(',')[1];
      while (image.length > 60000 && quality > 0.1) {
        quality -= 0.1;
        image = canvas.toDataURL('image/jpeg', quality).split(',')[1];
      }
      if (image.length > 60000)
        throw new Error(
          'Kadr jest zbyt duży. Zmniejsz wybrane okno albo dodaj notatkę.',
        );
      await api('/api/learning/' + learning.id + '/frame', 'POST', {
        image,
        context: observation,
      });
      await refresh();
    });
  }
  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      setError('Zaznacz tekst wyniku i skopiuj ręcznie.');
    }
  }
  const RunOutput = ({ run }: { run: Run }) => (
    <article className="output">
      <div className="linehead">
        <span>EXECUTION / {run.id.slice(0, 8)}</span>
        <span className={'state ' + run.status}>{statuses[run.status]}</span>
      </div>
      <h3>{catalog.find((e) => e.id === run.engine)?.title || run.engine}</h3>
      <p className="fine">
        Próba {run.attempt}/{run.maxAttempts} ·{' '}
        {run.output?.producer || run.workerId || 'czeka na worker'}
      </p>
      {run.error && <p className="error-inline">{run.error}</p>}
      {run.output ? (
        <>
          <button className="textbutton" onClick={() => copy(run.output!.text)}>
            Kopiuj wynik ↗
          </button>
          <pre>{run.output.text}</pre>
          {run.output.sources.map((s) => (
            <a
              className="source"
              key={s.url}
              href={s.url}
              target="_blank"
              rel="noreferrer"
            >
              {s.title} ↗
            </a>
          ))}
        </>
      ) : (
        <p>Wynik pojawi się po wykonaniu przez worker.</p>
      )}
      <div className="actions">
        {['queued', 'running'].includes(run.status) && (
          <button
            onClick={() =>
              work(async () => {
                await api('/api/runs/' + run.id + '/cancel', 'POST', {});
                await refresh();
              })
            }
          >
            Anuluj wykonanie
          </button>
        )}
        {run.status === 'failed' && (
          <button
            onClick={() =>
              work(async () => {
                await api('/api/runs/' + run.id + '/retry', 'POST', {});
                await refresh();
              })
            }
          >
            Ponów świadomie
          </button>
        )}
      </div>
    </article>
  );
  if (!ready) return <div className="loading">OSA / ŁĄCZENIE Z KERNELEM</div>;
  if (!identity)
    return (
      <div className="login-scene">
        <div className="login-art">
          <div className="tag">
            OSA<span>BUILD YOUR OWN SYSTEM</span>
          </div>
          <div className="kernel-symbol">
            <span>INTENCJA</span>
            <b>OSA</b>
            <span>EXECUTION / PROOF</span>
          </div>
          <h1>
            Twój system.
            <br />
            <em>Twój kierunek.</em>
          </h1>
          <p>
            Kernel, runtime i Control Room.
            <br />
            Jedna infrastruktura dla Twojego frameworka.
          </p>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void work(async () => {
              const res = await api<{ identity: Identity; csrf: string }>(
                '/api/auth/login',
                'POST',
                { token },
              );
              setCsrf(res.csrf);
              setIdentity(res.identity);
              setToken('');
              await refresh();
            });
          }}
        >
          <div className="eyebrow">WEJŚCIE DO PRYWATNEJ PRZESTRZENI</div>
          <h2>Otwórz swój dzień.</h2>
          <label htmlFor="token">Token dostępu</label>
          <input
            id="token"
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            required
            autoComplete="current-password"
          />
          <button className="primary" disabled={busy}>
            Wejdź do OSA ↗
          </button>
          <p className="fine">
            Token tworzysz lokalnie przez <code>npm run setup</code>. Konta i
            role należą do Twojej infrastruktury.
          </p>
          {error && (
            <p role="alert" className="error-inline">
              {error}
            </p>
          )}
        </form>
      </div>
    );
  if (view === 'day') return <Organizer identity={identity} api={api}
    onNavigate={(v) => navigate(v)}
    onTool={(id, taskContext) => { setEngineId(id); setContext(taskContext); setUrl(''); setWebSearch(false); setResult(undefined); setAttachMission(false); navigate('engines'); }}
    onLogout={async () => { stopShare(); await api('/api/auth/logout', 'POST', {}); setIdentity(undefined); setBoot(undefined); setContext(''); setArtifact(''); setTitle(''); setObservation(''); setResult(undefined); setView('day'); }} />;
  return (
    <div className={'app ' + (focused ? 'focus' : '')}>
      <div className="identity-line">
        <button className="tag" onClick={() => navigate('day')}>
          OSA<span>CONTROL ROOM / KERNEL 0.1</span>
        </button>
        <span className="identity-name">
          <i />
          {identity.subject} / {identity.tenantId}
        </span>
        <div>
          <button className="textbutton" onClick={() => navigate('day')}>Mój dzień</button>
          <button className="textbutton" onClick={() => setFocused(!focused)}>
            {focused ? 'Pokaż ekosystem' : 'Focus'}
          </button>
          <button
            className="textbutton"
            onClick={() =>
              work(async () => {
                stopShare();
                await api('/api/auth/logout', 'POST', {});
                setIdentity(undefined);
                setBoot(undefined);
                setContext('');
                setArtifact('');
                setTitle('');
                setObservation('');
                setResult(undefined);
              })
            }
          >
            Wyloguj
          </button>
        </div>
      </div>
      {error && (
        <div role="alert" className="error-banner">
          {error}
          <button aria-label="Zamknij błąd" onClick={() => setError('')}>
            ×
          </button>
        </div>
      )}
      <main>
        {view === 'room' && (
          <>
            <div className="room-heading">
              <div>
                <div className="eyebrow">INTENTION → EXECUTION → EVIDENCE</div>
                <h1>{mission?.title || 'Ustaw kierunek.'}</h1>
                <p className="next">
                  <span>NASTĘPNY RUCH</span>
                  {mission?.steps.find((s) => !s.done)?.title ||
                    'Jedna misja. Jeden konkretny rezultat.'}
                </p>
              </div>
              <div className="runtime-orbit">
                <div className="orbit-ring" />
                <b>
                  {boot?.report.runs.filter((r) => r.status === 'running')
                    .length || 0}
                </b>
                <span>AKTYWNE WYKONANIA</span>
                <small>
                  WŁASNY RUNTIME /{' '}
                  {boot?.integrations.find((x) => x.id === 'worker')?.status}
                </small>
              </div>
            </div>
            <div className="signalbar">
              <div>
                <b>
                  {boot?.report.missions.filter(
                    (m) => !['completed', 'cancelled'].includes(m.status),
                  ).length || 0}
                </b>
                <span>MISJE</span>
              </div>
              <div>
                <b>
                  {boot?.report.runs.filter((r) => r.status === 'queued')
                    .length || 0}
                </b>
                <span>KOLEJKA</span>
              </div>
              <div>
                <b>
                  {boot?.report.evidence.filter(
                    (e) => e.kind === 'verification' && e.verdict === 'passed',
                  ).length || 0}
                </b>
                <span>WYNIKI KONTROLI</span>
              </div>
              <div>
                <b>
                  {boot?.approvals.filter((a) => a.status === 'pending')
                    .length || 0}
                </b>
                <span>CZEKA NA ZGODĘ</span>
              </div>
              <button className="textbutton" onClick={() => navigate('runs')}>
                Obserwuj runtime →
              </button>
            </div>
            <section className="mission-stage">
              <div className="mission-track">
                <div className="linehead">01 / TWOJE MISJE</div>
                <form
                  className="row-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void work(async () => {
                      const m = await api<Mission>('/api/missions', 'POST', {
                        title,
                      });
                      setSelected(m.id);
                      setTitle('');
                      await refresh();
                    });
                  }}
                >
                  <input
                    aria-label="Nowa misja"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Dodaj jeden cel…"
                    maxLength={240}
                    required
                  />
                  <button disabled={busy}>+</button>
                </form>
                {boot?.report.missions.map((m) => (
                  <button
                    className={
                      'mission-row ' + (mission?.id === m.id ? 'selected' : '')
                    }
                    key={m.id}
                    onClick={() => setSelected(m.id)}
                  >
                    <small>
                      {statuses[m.status]} /{' '}
                      {m.steps.filter((s) => s.done).length}/{m.steps.length}
                    </small>
                    <strong>{m.title}</strong>
                    <span>↗</span>
                  </button>
                ))}
                {!boot?.report.missions.length && (
                  <p className="empty">
                    Nie ma jeszcze misji. Nazwij rezultat, który chcesz
                    osiągnąć.
                  </p>
                )}
              </div>
              <div className="mission-work">
                <div className="linehead">02 / PLAN I WYKONANIE</div>
                {mission ? (
                  <>
                    <h2>{mission.title}</h2>
                    <p className="fine">
                      Wersja {mission.version} · {statuses[mission.status]} ·
                      zamknięcie to deklaracja użytkownika.
                    </p>
                    <div className="steps">
                      {mission.steps.map((s, i) => (
                        <label key={s.id}>
                          <span>{String(i + 1).padStart(2, '0')}</span>
                          <input
                            type="checkbox"
                            checked={s.done}
                            disabled={
                              busy ||
                              ['completed', 'cancelled'].includes(
                                mission.status,
                              )
                            }
                            onChange={(e) =>
                              patchMission({
                                stepId: s.id,
                                done: e.target.checked,
                              })
                            }
                          />
                          <strong>{s.title}</strong>
                        </label>
                      ))}
                    </div>
                    {!['completed', 'cancelled'].includes(mission.status) && (
                      <>
                        <form
                          className="row-form"
                          onSubmit={(e) => {
                            e.preventDefault();
                            void patchMission({ addStep: step });
                            setStep('');
                          }}
                        >
                          <input
                            aria-label="Nowy krok"
                            value={step}
                            onChange={(e) => setStep(e.target.value)}
                            required
                            maxLength={240}
                            placeholder="Następny krok…"
                          />
                          <button disabled={busy}>Dodaj</button>
                        </form>
                        <div className="actions">
                          <button
                            className="primary"
                            onClick={() => {
                              setAttachMission(true);
                              navigate('engines');
                            }}
                          >
                            Uruchom silnik ↗
                          </button>
                          <button
                            onClick={() =>
                              patchMission({ status: 'completed' })
                            }
                            disabled={busy}
                          >
                            Zamknij z artefaktem
                          </button>
                          <button
                            onClick={() =>
                              patchMission({
                                status: 'completed',
                                requireVerification: true,
                              })
                            }
                            disabled={busy}
                          >
                            Zamknij z kontrolą
                          </button>
                        </div>
                      </>
                    )}
                  </>
                ) : (
                  <div className="empty">
                    Wybierz misję, żeby zobaczyć plan.
                  </div>
                )}
              </div>
              <div className="proof-track">
                <div className="linehead">03 / DOWÓD</div>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void work(async () => {
                      await api('/api/evidence', 'POST', {
                        content: artifact,
                        missionId: mission?.id,
                      });
                      setArtifact('');
                      await refresh();
                    });
                  }}
                >
                  <label htmlFor="artifact">Artefakt pracy</label>
                  <textarea
                    id="artifact"
                    value={artifact}
                    onChange={(e) => setArtifact(e.target.value)}
                    required
                    maxLength={24000}
                    placeholder="Log, link, wynik pracy…"
                  />
                  <button disabled={busy || !mission}>Zapisz artefakt</button>
                </form>
                {boot?.report.evidence
                  .filter((e) => e.missionId === mission?.id)
                  .slice(0, 5)
                  .map((e) => (
                    <div className="proof-row" key={e.id}>
                      <span
                        className={e.kind === 'verification' ? 'green' : ''}
                      >
                        {e.kind === 'verification'
                          ? e.verdict
                          : 'ZAPIS / ' + e.kind}
                      </span>
                      <small>{e.digest.slice(0, 16)}</small>
                      <p>{e.content.slice(0, 120)}</p>
                    </div>
                  ))}
              </div>
            </section>
            <section className="launch-ribbon">
              <div className="linehead">EKOSYSTEM / WSPÓLNY KERNEL</div>
              {catalog
                .filter(
                  (e) => !['daily-report', 'verify-syntax'].includes(e.id),
                )
                .map((e, i) => (
                  <button
                    key={e.id}
                    onClick={() => {
                      setEngineId(e.id);
                      setContext('');
                      setResult(undefined);
                      navigate('engines');
                    }}
                  >
                    <span>{String(i + 1).padStart(2, '0')}</span>
                    <strong>{e.title}</strong>
                    <span>↗</span>
                  </button>
                ))}
            </section>
          </>
        )}
        {view === 'engines' && (
          <>
            <div className="view-heading">
              <div className="eyebrow">OSA ENGINES / TRWAŁE WYKONANIA</div>
              <h1>Silniki Twojej pracy.</h1>
              <p>
                Każde wywołanie trafia do kernela i kolejki. Wynik, źródła i
                dowód zostają związane z wykonaniem.
              </p>
            </div>
            <div className="engine-lane">
              {catalog.map((e) => (
                <button
                  key={e.id}
                  className={engineId === e.id ? 'selected' : ''}
                  onClick={() => {
                    setEngineId(e.id);
                    setResult(undefined);
                  }}
                >
                  <small>{e.area}</small>
                  {e.title}
                </button>
              ))}
            </div>
            <section className="engine-stage">
              <div className="engine-copy">
                <span className="giant-index">
                  {String(
                    catalog.findIndex((e) => e.id === engineId) + 1,
                  ).padStart(2, '0')}
                </span>
                <h2>{engine.title}</h2>
                <p>{engine.description}</p>
                <div className="kernel-note">
                  <span>CORE CONTRACT</span>
                  <p>Wejście → run ID → kolejka → worker → wynik → evidence.</p>
                  <p>
                    {['prompt', 'daily-report', 'verify-syntax'].includes(
                      engineId,
                    )
                      ? 'Działa lokalnie bez modelu AI.'
                      : 'Wymaga skonfigurowanego modelu na backendzie. Brak konfiguracji wraca jako jawny błąd zadania.'}
                  </p>
                </div>
              </div>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void enqueue();
                }}
              >
                <label htmlFor="engine-context">
                  {engineId === 'verify-syntax'
                    ? 'Kod JavaScript'
                    : 'Cel i kontekst'}
                </label>
                <textarea
                  id="engine-context"
                  value={context}
                  onChange={(e) => setContext(e.target.value)}
                  required={!['daily-report'].includes(engineId)}
                  maxLength={64000}
                  placeholder={engine.input}
                />
                {['profile', 'leads', 'research', 'radar'].includes(
                  engineId,
                ) && (
                  <>
                    <label htmlFor="source-url">Publiczna strona HTTPS</label>
                    <input
                      id="source-url"
                      type="url"
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      placeholder="https://…"
                    />
                  </>
                )}
                {['research', 'leads', 'radar'].includes(engineId) && (
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={webSearch}
                      onChange={(e) => setWebSearch(e.target.checked)}
                    />
                    Wyszukaj aktualne źródła przez skonfigurowany model
                  </label>
                )}
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={attachMission}
                    onChange={(e) => setAttachMission(e.target.checked)}
                  />
                  Powiąż z misją: {mission?.title || 'nie wybrano'}
                </label>
                <div className="actions">
                  <button className="primary" disabled={busy}>
                    Zleć wykonanie ↗
                  </button>
                  <span className="fine">
                    Mailing tworzy draft. Akcje zewnętrzne wymagają osobnej
                    zgody i adaptera.
                  </span>
                </div>
              </form>
            </section>
            {result && <RunOutput run={result} />}
          </>
        )}
        {view === 'runs' && (
          <>
            <div className="view-heading">
              <div className="eyebrow">EXECUTION TRACE / WORKER</div>
              <h1>Widzisz, co się dzieje.</h1>
              <p>
                Kolejka, próby, błędy i wyniki. Zadania przetrwają restart API.
              </p>
            </div>
            <input
              aria-label="Szukaj wykonań"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Szukaj silnika lub fragmentu wyniku…"
            />
            <div className="execution-list">
              {boot?.report.runs
                .filter((r) =>
                  (r.engine + ' ' + r.output?.text)
                    .toLowerCase()
                    .includes(filter.toLowerCase()),
                )
                .map((r) => (
                  <details key={r.id}>
                    <summary>
                      <span className={'state ' + r.status}>
                        {statuses[r.status]}
                      </span>
                      <strong>
                        {catalog.find((e) => e.id === r.engine)?.title}
                      </strong>
                      <small>
                        {r.attempt}/{r.maxAttempts} ·{' '}
                        {new Date(r.createdAt).toLocaleString('pl-PL')}
                      </small>
                    </summary>
                    <RunOutput run={r} />
                  </details>
                ))}
            </div>
            {!boot?.report.runs.length && (
              <p className="empty">
                Uruchom pierwszy silnik. Tu zobaczysz jego przebieg.
              </p>
            )}
            <p className="fine">
              Pokrycie: {boot?.report.coverage.runs.included}/
              {boot?.report.coverage.runs.total}. Pełna paginacja jest dostępna
              przez API / SDK.
            </p>
          </>
        )}
        {view === 'proof' && (
          <>
            <div className="view-heading">
              <div className="eyebrow">CLAIM ≠ PROOF</div>
              <h1>Dowód ma pochodzenie.</h1>
              <p>
                Digest sprawdza integralność; wynik parsera potwierdza wykonaną
                kontrolę składni. Tekst AI pozostaje draftem.
              </p>
            </div>
            <div className="proof-stage">
              <section>
                <div className="linehead">
                  EVIDENCE / POWIĄZANIE Z WYKONANIEM
                </div>
                {boot?.report.evidence.map((e) => (
                  <details key={e.id}>
                    <summary>
                      <span
                        className={
                          e.kind === 'verification' ? 'green' : 'muted'
                        }
                      >
                        {e.kind}
                      </span>
                      <strong>{e.producer}</strong>
                      <span>{e.verdict}</span>
                    </summary>
                    <pre>{e.content}</pre>
                    <code className="digest">{e.digest}</code>
                    <button
                      onClick={() =>
                        work(async () => {
                          const checked = await api<{
                            integrity: boolean;
                            binding: boolean;
                            executionVerified: boolean;
                          }>('/api/evidence/' + e.id + '/verify');
                          setError(
                            `Weryfikacja: integralność ${checked.integrity ? 'OK' : 'BŁĄD'}, powiązanie ${checked.binding ? 'OK' : 'BŁĄD'}, wykonana kontrola ${checked.executionVerified ? 'TAK' : 'NIE'}.`,
                          );
                        })
                      }
                    >
                      Sprawdź integralność i binding
                    </button>
                  </details>
                ))}
              </section>
              <section>
                <div className="linehead">APPROVAL / HASH PAYLOADU</div>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void work(async () => {
                      await api('/api/approvals', 'POST', {
                        action: 'mail.send',
                        payload: {
                          draft: artifact,
                          note: 'Wysyłka wymaga skonfigurowanego adaptera poczty.',
                        },
                      });
                      setArtifact('');
                      await refresh();
                    });
                  }}
                >
                  <label htmlFor="approval">
                    Draft / treść do zatwierdzenia
                  </label>
                  <textarea
                    id="approval"
                    value={artifact}
                    onChange={(e) => setArtifact(e.target.value)}
                    required
                    placeholder="Wklej konkretny draft i odbiorcę…"
                  />
                  <button disabled={busy}>Utwórz wniosek o zgodę</button>
                </form>
                <p className="fine">
                  Zgoda dotyczy dokładnego payloadu. Nie uruchamia
                  niepodłączonego transportu.
                </p>
                {boot?.approvals.map((a) => (
                  <div className="approval-row" key={a.id}>
                    <strong>
                      {a.action} / {a.status}
                    </strong>
                    <pre>{JSON.stringify(a.payload, null, 2)}</pre>
                    <code className="digest">{a.payloadDigest}</code>
                    {a.status === 'pending' && (
                      <div className="actions">
                        {['approved', 'rejected'].map((decision) => (
                          <button
                            key={decision}
                            disabled={busy || identity.role !== 'owner'}
                            onClick={() =>
                              work(async () => {
                                await api(
                                  '/api/approvals/' + a.id + '/decide',
                                  'POST',
                                  { decision, payloadDigest: a.payloadDigest },
                                );
                                await refresh();
                              })
                            }
                          >
                            {decision === 'approved'
                              ? 'Zatwierdź payload'
                              : 'Odrzuć'}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </section>
            </div>
            <section className="audit">
              <div className="linehead">AUDIT / ŁAŃCUCH ZDARZEŃ</div>
              <button
                onClick={() =>
                  work(async () => {
                    const data = await api<{
                      events: AuditEvent[];
                      valid: boolean;
                    }>('/api/events');
                    setEvents(data.events);
                    setAuditValid(data.valid);
                  })
                }
              >
                Odczytaj i sprawdź łańcuch
              </button>
              {auditValid !== undefined && (
                <p>
                  Integralność strony łańcucha: {auditValid ? 'OK' : 'BŁĄD'}
                </p>
              )}
              {events.map((e) => (
                <div className="event" key={e.seq}>
                  <small>{e.seq.toString().padStart(3, '0')}</small>
                  <strong>{e.type}</strong>
                  <span>{e.subject}</span>
                  <code>{e.digest.slice(0, 14)}</code>
                </div>
              ))}
            </section>
          </>
        )}
        {view === 'learn' && (
          <>
            <div className="view-heading">
              <div className="eyebrow">OSA ACADEMY / CERTIFICATE LAB</div>
              <h1>Ucz się na własnym kodzie.</h1>
              <p>
                Sesja zachowuje konkretne obserwacje. Po niej powstaje raport,
                ćwiczenia naprawcze i następny krok.
              </p>
            </div>
            <div className="learning-stage">
              <section>
                <div className="linehead">SESJE NAUKI</div>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void work(async () => {
                      const s = await api<LearningSession>(
                        '/api/learning',
                        'POST',
                        { title, exam },
                      );
                      setSessionId(s.id);
                      setTitle('');
                      await refresh();
                    });
                  }}
                >
                  <label htmlFor="learning-title">Temat / cel nauki</label>
                  <input
                    id="learning-title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    required
                    placeholder="Async / przepływ / moduł repo…"
                  />
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={exam}
                      onChange={(e) => setExam(e.target.checked)}
                    />
                    Trwający oceniany egzamin
                  </label>
                  <button className="primary" disabled={busy}>
                    Rozpocznij sesję
                  </button>
                </form>
                {boot?.learning.map((s) => (
                  <button
                    className={
                      'session-row ' + (sessionId === s.id ? 'selected' : '')
                    }
                    key={s.id}
                    onClick={() => {
                      stopShare();
                      setSessionId(s.id);
                    }}
                  >
                    <strong>{s.title}</strong>
                    <span>
                      {s.status} / {s.observations.length} obserwacji
                    </span>
                  </button>
                ))}
                <button
                  className="textbutton"
                  onClick={() => {
                    setEngineId('academy');
                    navigate('engines');
                  }}
                >
                  Otwórz Akademię Czytania Kodu ↗
                </button>
              </section>
              <section>
                <div className="linehead">
                  BROWSER SESSION / TYLKO JAWNE UDOSTĘPNIENIE
                </div>
                {learning ? (
                  <>
                    <h2>{learning.title}</h2>
                    {learning.exam ? (
                      <p className="error-inline">
                        Analiza egzaminu jest wyłączona po stronie API. Zapisuj
                        własne notatki; naukę analizuj po egzaminie.
                      </p>
                    ) : (
                      <>
                        <p className="fine">
                          Podgląd zostaje w Twojej przeglądarce. Kadr wysyłasz
                          wyłącznie przyciskiem; obraz nie trafia do trwałego
                          magazynu OSA.
                        </p>
                        <div className="actions">
                          <button
                            onClick={sharing ? stopShare : share}
                            disabled={learning.status !== 'active'}
                          >
                            {sharing
                              ? 'Zatrzymaj udostępnianie'
                              : 'Wybierz okno nauki ↗'}
                          </button>
                          {sharing && (
                            <button onClick={frame} disabled={busy}>
                              Przeanalizuj ten kadr
                            </button>
                          )}
                        </div>
                        {sharing && (
                          <video
                            className="browser-preview"
                            ref={video}
                            autoPlay
                            muted
                            playsInline
                          />
                        )}
                      </>
                    )}
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        void work(async () => {
                          await api(
                            '/api/learning/' + learning.id + '/observe',
                            'POST',
                            { text: observation },
                          );
                          setObservation('');
                          await refresh();
                        });
                      }}
                    >
                      <label htmlFor="observation">
                        Odpowiedź / trudność / obserwacja
                      </label>
                      <textarea
                        id="observation"
                        value={observation}
                        onChange={(e) => setObservation(e.target.value)}
                        required
                        maxLength={2000}
                        placeholder="Co odpowiedziałeś? Gdzie utknąłeś?"
                      />
                      <button disabled={busy || learning.status !== 'active'}>
                        Zapisz obserwację
                      </button>
                    </form>
                    {learning.observations.map((o, i) => (
                      <div className="observation" key={i}>
                        <small>
                          {new Date(o.at).toLocaleTimeString('pl-PL')}
                        </small>
                        <p>{o.text}</p>
                      </div>
                    ))}
                    <button
                      className="primary"
                      disabled={
                        busy || learning.exam || learning.status === 'completed'
                      }
                      onClick={() =>
                        work(async () => {
                          const s = await api<LearningSession>(
                            '/api/learning/' + learning.id + '/finish',
                            'POST',
                            {},
                          );
                          stopShare();
                          await refresh();
                          if (s.reportRunId) {
                            const r = await api<Run>(
                              '/api/runs/' + s.reportRunId,
                            );
                            setResult(r);
                          }
                        })
                      }
                    >
                      Zakończ i zleć raport ↗
                    </button>
                    {learning.reportRunId && (
                      <button
                        onClick={() =>
                          work(async () => {
                            setResult(
                              await api<Run>(
                                '/api/runs/' + learning.reportRunId,
                              ),
                            );
                          })
                        }
                      >
                        Odczytaj raport sesji
                      </button>
                    )}
                  </>
                ) : (
                  <p className="empty">Wybierz albo rozpocznij sesję nauki.</p>
                )}
              </section>
            </div>
            {result && <RunOutput run={result} />}
          </>
        )}
        {view === 'rhythm' && (
          <>
            <div className="view-heading">
              <div className="eyebrow">RYTM / SCHEDULER</div>
              <h1>Jedna rzecz. W swoim czasie.</h1>
              <p>
                Blok skupienia w przeglądarce. Raport wieczorny uruchamiany
                przez trwały harmonogram workera.
              </p>
            </div>
            <div className="rhythm-stage">
              <section>
                <div className="linehead">FOCUS / TWÓJ BLOK</div>
                <div className="timer">
                  {String(Math.floor(remaining / 60)).padStart(2, '0')}
                  <span>:</span>
                  {String(remaining % 60).padStart(2, '0')}
                </div>
                <label htmlFor="focus-title">Cel sesji</label>
                <input
                  id="focus-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Jedna konkretna rzecz…"
                />
                <label htmlFor="minutes">Długość bloku w minutach</label>
                <input
                  id="minutes"
                  type="number"
                  min={1}
                  max={180}
                  value={minutes}
                  disabled={running}
                  onChange={(e) => {
                    const value = Math.max(
                      1,
                      Math.min(180, Number(e.target.value)),
                    );
                    setMinutes(value);
                    setRemaining(value * 60);
                    elapsed.current = 0;
                  }}
                />
                <div className="actions">
                  <button
                    className="primary"
                    onClick={() => {
                      if (running) {
                        elapsed.current +=
                          (Date.now() - started.current) / 1000;
                        setRunning(false);
                      } else {
                        if (!remaining) setRemaining(minutes * 60);
                        started.current = Date.now();
                        deadline.current =
                          Date.now() + (remaining || minutes * 60) * 1000;
                        setRunning(true);
                      }
                    }}
                  >
                    {running ? 'Pauza' : 'Start'} ↗
                  </button>
                  <button
                    disabled={busy}
                    onClick={() =>
                      work(async () => {
                        const seconds = Math.floor(
                          elapsed.current +
                            (running
                              ? (Date.now() - started.current) / 1000
                              : 0),
                        );
                        await api('/api/focus', 'POST', { title, seconds });
                        elapsed.current = 0;
                        setRunning(false);
                        setRemaining(minutes * 60);
                        await refresh();
                      })
                    }
                  >
                    Zapisz sesję
                  </button>
                </div>
                <p className="fine">
                  Czas jest deklaracją klienta; timer nie działa po zamknięciu
                  strony.
                </p>
              </section>
              <section>
                <div className="linehead">RAPORT WIECZORNY / BACKEND</div>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void work(async () => {
                      const [hour, minute] = at.split(':').map(Number);
                      await api('/api/schedules', 'POST', {
                        title: 'Raport wieczorny',
                        hour,
                        minute,
                        timezone,
                      });
                      await refresh();
                    });
                  }}
                >
                  <label htmlFor="schedule-at">Godzina</label>
                  <input
                    id="schedule-at"
                    type="time"
                    value={at}
                    onChange={(e) => setAt(e.target.value)}
                    required
                  />
                  <label htmlFor="timezone">Strefa IANA</label>
                  <input
                    id="timezone"
                    value={timezone}
                    onChange={(e) => setTimezone(e.target.value)}
                    required
                  />
                  <button className="primary" disabled={busy}>
                    Dodaj harmonogram
                  </button>
                </form>
                {boot?.schedules.map((s) => (
                  <div className="schedule-row" key={s.id}>
                    <h3>{s.title}</h3>
                    <p>
                      {s.hour}:{String(s.minute).padStart(2, '0')} /{' '}
                      {s.timezone}
                    </p>
                    <small>
                      Następny termin:{' '}
                      {s.enabled
                        ? new Date(s.nextRunAt).toLocaleString('pl-PL')
                        : 'wyłączony'}
                    </small>
                    <button
                      onClick={() =>
                        work(async () => {
                          await api('/api/schedules/' + s.id, 'PATCH', {
                            enabled: !s.enabled,
                          });
                          await refresh();
                        })
                      }
                    >
                      {s.enabled ? 'Wyłącz' : 'Włącz'}
                    </button>
                  </div>
                ))}
                <div className="actions">
                  <button
                    onClick={() => enqueue('daily-report', {})}
                    disabled={busy}
                  >
                    Utwórz raport teraz
                  </button>
                </div>
                <p className="fine">
                  Scheduler pracuje w API z embedded workerem lub osobnym
                  procesie worker. Restart nie usuwa terminu.
                </p>
              </section>
            </div>
            {result && <RunOutput run={result} />}
          </>
        )}
        {view === 'platform' && (
          <>
            <div className="view-heading">
              <div className="eyebrow">
                OSA INFRASTRUCTURE / FRAMEWORK FOUNDATION
              </div>
              <h1>
                Jedna infrastruktura.
                <br />
                <em>Cały ekosystem.</em>
              </h1>
            </div>
            <div className="architecture">
              <span>IDENTITY</span>
              <span>MISSION</span>
              <span>EXECUTION</span>
              <span>APPROVAL</span>
              <span>EVIDENCE</span>
              <span>EVENT</span>
            </div>
            <div className="platform-stage">
              <section>
                <div className="linehead">WŁASNY KOD / KONTRAKTY</div>
                <h2>Kernel jest wspólny.</h2>
                <p>
                  Control Room, TypeScript SDK i MCP korzystają z tego samego
                  API. SQLite uruchamia lokalne środowisko; PostgreSQL
                  przechowuje dane współdzielone przez API i workery.
                </p>
                <pre>
                  apps/api auth, HTTP, Control Room\napps/mcp pięć narzędzi /
                  stdio\npackages/kernel kontrakty i polityki\npackages/store
                  SQLite / PostgreSQL\npackages/runtime worker /
                  scheduler\npackages/engines 12 silników\npackages/sdk klient
                  frameworka\ninfra Docker / Compose / CI
                </pre>
                <a
                  href="https://github.com/HazEOskA/OSA"
                  target="_blank"
                  rel="noreferrer"
                >
                  Repozytorium OSA ↗
                </a>
                <a
                  className="source"
                  href="https://platform.openai.com/"
                  target="_blank"
                  rel="noreferrer"
                >
                  OpenAI Developer Platform ↗
                </a>
              </section>
              <section>
                <div className="linehead">INTEGRACJE / JAWNY STAN</div>
                {boot?.integrations.map((i) => (
                  <div className="integration" key={i.id}>
                    <div>
                      <strong>{i.id.toUpperCase()}</strong>
                      <span>{i.status}</span>
                    </div>
                    <p>{i.detail}</p>
                  </div>
                ))}
                <div className="integration">
                  <strong>OSA SHELL</strong>
                  <p>
                    Ten sam interfejs i API. Pakowanie systemowe i uprawnienia
                    hosta są oddzielnym etapem po pomiarach na laptopie.
                  </p>
                </div>
              </section>
            </div>
          </>
        )}
      </main>
      <nav className="command-dock" aria-label="Nawigacja OSA">
        {areas.map((a) => (
          <button
            key={a.id}
            className={view === a.id ? 'active' : ''}
            onClick={() => navigate(a.id)}
          >
            <small>{a.mark}</small>
            {a.name}
          </button>
        ))}
      </nav>
      <footer>
        OSA / YOUR INFRASTRUCTURE <span>IDENTITY · EXECUTION · PROOF</span>
      </footer>
    </div>
  );
}
