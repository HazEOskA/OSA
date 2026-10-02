import type { Store, Tx } from '../../store/src/store.js';
import { OsaError } from './contracts.js';
import type {
  Approval,
  AuditEvent,
  EngineResult,
  Evidence,
  FocusSession,
  Identity,
  LearningSession,
  Mission,
  Run,
  Schedule,
} from './contracts.js';
import {
  canonical,
  dateKey,
  digest,
  id,
  nextDaily,
  object,
  owner,
  requireWrite,
  text,
} from './guards.js';
export const engineIds = [
  'prompt',
  'daily-report',
  'verify-syntax',
  'profile',
  'leads',
  'research',
  'mail',
  'radar',
  'review',
  'academy',
  'labs',
  'certificate',
] as const;
export class Kernel {
  constructor(
    readonly store: Store,
    readonly now = () => Date.now(),
  ) {}
  private base(identity: Identity) {
    return {
      id: id(),
      tenantId: identity.tenantId,
      version: 0,
      createdAt: new Date(this.now()).toISOString(),
    };
  }
  private event(
    tx: Tx,
    identity: Identity,
    type: string,
    entityId: string,
    payload: Record<string, unknown> = {},
  ) {
    return tx.append({
      tenantId: identity.tenantId,
      subject: identity.subject,
      type,
      entityId,
      at: new Date(this.now()).toISOString(),
      payload,
    });
  }
  private async find<
    T extends Mission | Run | Evidence | Approval | Schedule | LearningSession,
  >(
    tx: Tx,
    identity: Identity,
    kind: 'mission' | 'run' | 'evidence' | 'approval' | 'schedule' | 'learning',
    entityId: string,
  ) {
    const entity = await tx.get<T>(identity.tenantId, kind, entityId);
    if (!entity)
      throw new OsaError('NOT_FOUND', 'Nie znaleziono obiektu.', 404);
    return entity;
  }
  async createMission(identity: Identity, input: Record<string, unknown>) {
    requireWrite(identity);
    const mission: Mission = {
      ...this.base(identity),
      title: text(input.title, 'Cel', 240),
      description: text(input.description, 'Opis', 6000, true),
      status: 'draft',
      steps: [],
    };
    return this.store.transaction(async (tx) => {
      const saved = await tx.put('mission', mission, 0);
      await this.event(tx, identity, 'mission.created', saved.id, {
        title: saved.title,
      });
      return saved;
    });
  }
  async updateMission(
    identity: Identity,
    missionId: string,
    input: Record<string, unknown>,
  ) {
    requireWrite(identity);
    return this.store.transaction(async (tx) => {
      const old = await this.find<Mission>(tx, identity, 'mission', missionId);
      if (input.version !== old.version)
        throw new OsaError(
          'VERSION_CONFLICT',
          'Odśwież misję przed zmianą.',
          409,
        );
      if (['completed', 'cancelled'].includes(old.status))
        throw new OsaError('CLOSED', 'Zamknięta misja jest niezmienna.', 409);
      const next = { ...old };
      if (input.title !== undefined) next.title = text(input.title, 'Cel', 240);
      if (input.description !== undefined)
        next.description = text(input.description, 'Opis', 6000, true);
      if (input.addStep !== undefined) {
        if (old.steps.length >= 50)
          throw new OsaError('LIMIT', 'Maksymalnie 50 kroków.');
        next.steps = [
          ...old.steps,
          { id: id(), title: text(input.addStep, 'Krok', 240), done: false },
        ];
        next.status = 'active';
      }
      if (input.stepId !== undefined) {
        if (typeof input.done !== 'boolean')
          throw new OsaError('INVALID_INPUT', 'Stan kroku musi być boolean.');
        if (!old.steps.some((s) => s.id === input.stepId))
          throw new OsaError('NOT_FOUND', 'Nie znaleziono kroku.', 404);
        next.steps = old.steps.map((s) =>
          s.id === input.stepId ? { ...s, done: input.done as boolean } : s,
        );
      }
      if (input.status === 'cancelled') {
        next.status = 'cancelled';
        next.closedAt = new Date(this.now()).toISOString();
      }
      if (input.status === 'active') next.status = 'active';
      if (input.status === 'completed') {
        if (!next.steps.length || next.steps.some((s) => !s.done))
          throw new OsaError(
            'INCOMPLETE',
            'Wykonaj wszystkie kroki przed zamknięciem.',
          );
        const evidence = await tx.evidenceForMission(
          identity.tenantId,
          missionId,
        );
        if (!evidence.length)
          throw new OsaError(
            'NO_EVIDENCE',
            'Dodaj artefakt lub wynik weryfikacji.',
          );
        if (
          input.requireVerification === true &&
          !evidence.some(
            (e) => e.kind === 'verification' && e.verdict === 'passed',
          )
        )
          throw new OsaError(
            'NO_VERIFIED_PROOF',
            'Brak niezależnego wyniku wykonanej kontroli.',
          );
        next.status = 'completed';
        next.closedAt = new Date(this.now()).toISOString();
      }
      const saved = await tx.put('mission', next, old.version);
      await this.event(tx, identity, 'mission.updated', saved.id, {
        status: saved.status,
        version: saved.version,
      });
      return saved;
    });
  }
  async addEvidence(identity: Identity, input: Record<string, unknown>) {
    requireWrite(identity);
    const content = text(input.content, 'Artefakt', 24000),
      missionId = text(input.missionId, 'Misja', 80, true) || undefined;
    return this.store.transaction(async (tx) => {
      if (missionId)
        await this.find<Mission>(tx, identity, 'mission', missionId);
      const evidence: Evidence = {
        ...this.base(identity),
        missionId,
        content,
        kind: 'user-artifact',
        digest: digest(content),
        producer: identity.subject,
        verdict: 'declared',
      };
      const saved = await tx.put('evidence', evidence, 0);
      await this.event(tx, identity, 'evidence.recorded', saved.id, {
        missionId: missionId || null,
        digest: saved.digest,
        kind: saved.kind,
      });
      return saved;
    });
  }
  async verifyEvidence(identity: Identity, evidenceId: string) {
    return this.store.read(async (tx) => {
      const evidence = await this.find<Evidence>(
        tx,
        identity,
        'evidence',
        evidenceId,
      );
      let binding = true;
      if (evidence.runId) {
        const run = await this.find<Run>(tx, identity, 'run', evidence.runId);
        binding =
          run.status === 'succeeded' &&
          run.requestDigest === evidence.runDigest &&
          run.output?.text === evidence.content;
      }
      return {
        evidence,
        integrity: digest(evidence.content) === evidence.digest,
        binding,
        executionVerified:
          evidence.kind === 'verification' &&
          evidence.verdict === 'passed' &&
          binding,
      };
    });
  }
  private async enqueueTx(
    tx: Tx,
    identity: Identity,
    input: Record<string, unknown>,
    origin?: { requestedBy?: string; trigger: 'manual' | 'schedule' },
  ) {
    const engine = text(input.engine, 'Silnik', 60);
    if (!(engineIds as readonly string[]).includes(engine))
      throw new OsaError('UNKNOWN_ENGINE', 'Nieznany silnik.');
    const data = object(input.input),
      key = text(input.idempotencyKey, 'Klucz idempotencji', 160);
    if (engine === 'certificate' && data.exam === true)
      throw new OsaError(
        'EXAM_ACTIVE',
        'Analiza trwającego ocenianego egzaminu jest wyłączona.',
        409,
      );
    const missionId = text(input.missionId, 'Misja', 80, true) || undefined;
    if (missionId) {
      const m = await this.find<Mission>(tx, identity, 'mission', missionId);
      if (m.status === 'cancelled' || m.status === 'completed')
        throw new OsaError('CLOSED', 'Misja jest zamknięta.', 409);
    }
    const requestDigest = digest({ engine, input: data, missionId });
    const existing = await tx.byIdempotency(identity.tenantId, key);
    if (existing) {
      const requestedBy = origin ? origin.requestedBy : identity.subject;
      if (existing.requestedBy && existing.requestedBy !== requestedBy)
        throw new OsaError('IDEMPOTENCY_CONFLICT', 'Ten klucz należy do innego użytkownika.', 409);
      if (existing.requestDigest !== requestDigest)
        throw new OsaError(
          'IDEMPOTENCY_CONFLICT',
          'Ten klucz opisuje inne wejście.',
          409,
        );
      return existing;
    }
    const run: Run = {
      ...this.base(identity),
      requestedBy: origin ? origin.requestedBy : identity.subject,
      trigger: origin?.trigger || 'manual',
      missionId,
      engine,
      input: data,
      status: 'queued',
      attempt: 0,
      maxAttempts: 3,
      availableAt: this.now(),
      leaseUntil: 0,
      claimToken: '',
      workerId: '',
      idempotencyKey: key,
      requestDigest,
    };
    const saved = await tx.put('run', run, 0);
    await this.event(tx, identity, 'run.queued', saved.id, {
      engine,
      requestDigest,
      missionId: missionId || null,
    });
    return saved;
  }
  async enqueue(identity: Identity, input: Record<string, unknown>) {
    requireWrite(identity);
    return this.store.transaction((tx) => this.enqueueTx(tx, identity, input));
  }
  async cancel(identity: Identity, runId: string) {
    requireWrite(identity);
    return this.store.transaction(async (tx) => {
      const old = await this.find<Run>(tx, identity, 'run', runId);
      if (!['queued', 'running'].includes(old.status))
        throw new OsaError('TERMINAL', 'To zadanie już się zakończyło.', 409);
      const saved = await tx.put(
        'run',
        {
          ...old,
          status: 'cancelled',
          finishedAt: new Date(this.now()).toISOString(),
          leaseUntil: 0,
          claimToken: '',
        },
        old.version,
      );
      await this.event(tx, identity, 'run.cancelled', runId);
      return saved;
    });
  }
  async retry(identity: Identity, runId: string) {
    requireWrite(identity);
    return this.store.transaction(async (tx) => {
      const old = await this.find<Run>(tx, identity, 'run', runId);
      if (old.status !== 'failed')
        throw new OsaError(
          'INVALID_STATE',
          'Ponowić można zadanie zakończone błędem.',
          409,
        );
      const saved = await tx.put(
        'run',
        {
          ...old,
          status: 'queued',
          attempt: 0,
          availableAt: this.now(),
          error: undefined,
          finishedAt: undefined,
          leaseUntil: 0,
          claimToken: '',
        },
        old.version,
      );
      await this.event(tx, identity, 'run.retry_requested', runId);
      return saved;
    });
  }
  async claim(workerId: string, leaseMs = 30000) {
    return this.store.transaction(async (tx) => {
      const run = await tx.runnable(this.now());
      if (!run) return undefined;
      const identity: Identity = {
        tenantId: run.tenantId,
        subject: 'worker:' + workerId,
        role: 'owner',
      };
      if (run.attempt >= run.maxAttempts) {
        await tx.put(
          'run',
          {
            ...run,
            status: 'failed',
            error: 'LEASE_RETRIES_EXHAUSTED',
            finishedAt: new Date(this.now()).toISOString(),
            claimToken: '',
            leaseUntil: 0,
          },
          run.version,
        );
        await this.event(tx, identity, 'run.failed', run.id, {
          reason: 'lease retries exhausted',
        });
        return undefined;
      }
      const next: Run = {
        ...run,
        status: 'running',
        attempt: run.attempt + 1,
        workerId,
        claimToken: id(),
        leaseUntil: this.now() + leaseMs,
        startedAt: run.startedAt || new Date(this.now()).toISOString(),
      };
      const saved = await tx.put('run', next, run.version);
      await this.event(tx, identity, 'run.claimed', run.id, {
        attempt: saved.attempt,
        workerId,
      });
      return saved;
    });
  }
  async heartbeat(run: Run, leaseMs = 30000) {
    return this.store.transaction(async (tx) => {
      const old = await tx.get<Run>(run.tenantId, 'run', run.id);
      if (
        !old ||
        old.status !== 'running' ||
        old.claimToken !== run.claimToken ||
        old.leaseUntil < this.now()
      )
        return false;
      await tx.put(
        'run',
        { ...old, leaseUntil: this.now() + leaseMs },
        old.version,
      );
      return true;
    });
  }
  async settle(
    run: Run,
    result: EngineResult | undefined,
    failure?: { message: string; retryable: boolean },
  ) {
    return this.store.transaction(async (tx) => {
      const old = await tx.get<Run>(run.tenantId, 'run', run.id);
      if (
        !old ||
        old.status !== 'running' ||
        old.claimToken !== run.claimToken ||
        old.leaseUntil < this.now()
      )
        return false;
      const identity: Identity = {
        tenantId: run.tenantId,
        subject: 'worker:' + run.workerId,
        role: 'owner',
      };
      if (failure) {
        const retry = failure.retryable && old.attempt < old.maxAttempts;
        const next: Run = {
          ...old,
          status: retry ? 'queued' : 'failed',
          availableAt: this.now() + Math.min(30000, 500 * 2 ** old.attempt),
          leaseUntil: 0,
          claimToken: '',
          error: failure.message.slice(0, 1000),
          finishedAt: retry ? undefined : new Date(this.now()).toISOString(),
        };
        await tx.put('run', next, old.version);
        await this.event(
          tx,
          identity,
          retry ? 'run.retry_scheduled' : 'run.failed',
          run.id,
          { error: next.error || '', attempt: old.attempt },
        );
        return true;
      }
      if (!result) throw new OsaError('NO_RESULT', 'Brak wyniku silnika.');
      const saved = await tx.put(
        'run',
        {
          ...old,
          status: 'succeeded',
          output: result,
          error: undefined,
          claimToken: '',
          leaseUntil: 0,
          finishedAt: new Date(this.now()).toISOString(),
        },
        old.version,
      );
      const kind: Evidence['kind'] =
        run.engine === 'verify-syntax'
          ? 'verification'
          : run.engine === 'daily-report'
            ? 'report'
            : result.producer.startsWith('openai/')
              ? 'ai-draft'
              : 'user-artifact';
      const proof: Evidence = {
        ...this.base(identity),
        missionId: run.missionId,
        runId: run.id,
        content: result.text,
        digest: digest(result.text),
        runDigest: run.requestDigest,
        kind,
        producer: result.producer,
        verdict: result.verdict,
      };
      await tx.put('evidence', proof, 0);
      await this.event(tx, identity, 'run.succeeded', run.id, {
        evidenceId: proof.id,
        resultDigest: proof.digest,
        verdict: result.verdict,
        version: saved.version,
      });
      return true;
    });
  }
  async requestApproval(identity: Identity, input: Record<string, unknown>) {
    requireWrite(identity);
    const action = text(input.action, 'Akcja', 100),
      payload = object(input.payload);
    return this.store.transaction(async (tx) => {
      const a: Approval = {
        ...this.base(identity),
        action,
        payload,
        payloadDigest: digest({ action, payload }),
        status: 'pending',
      };
      const saved = await tx.put('approval', a, 0);
      await this.event(tx, identity, 'approval.requested', a.id, {
        payloadDigest: a.payloadDigest,
        action,
      });
      return saved;
    });
  }
  async decideApproval(
    identity: Identity,
    approvalId: string,
    input: Record<string, unknown>,
  ) {
    owner(identity);
    return this.store.transaction(async (tx) => {
      const a = await this.find<Approval>(tx, identity, 'approval', approvalId);
      if (a.status !== 'pending')
        throw new OsaError('DECIDED', 'Zgoda już została rozstrzygnięta.', 409);
      if (input.payloadDigest !== a.payloadDigest)
        throw new OsaError(
          'PAYLOAD_CHANGED',
          'Zatwierdzenie nie pasuje do payloadu.',
          409,
        );
      if (!['approved', 'rejected'].includes(String(input.decision)))
        throw new OsaError('INVALID_INPUT', 'Wybierz approved albo rejected.');
      const saved = await tx.put(
        'approval',
        {
          ...a,
          status: input.decision as 'approved' | 'rejected',
          decisionBy: identity.subject,
          decidedAt: new Date(this.now()).toISOString(),
        },
        a.version,
      );
      await this.event(tx, identity, 'approval.decided', a.id, {
        status: saved.status,
        payloadDigest: a.payloadDigest,
      });
      return saved;
    });
  }
  async createSchedule(identity: Identity, input: Record<string, unknown>) {
    owner(identity);
    const hour = Number(input.hour),
      minute = Number(input.minute),
      timezone = text(input.timezone, 'Strefa', 80);
    const nextRunAt = nextDaily(this.now(), hour, minute, timezone);
    return this.store.transaction(async (tx) => {
      const schedule: Schedule = {
        ...this.base(identity),
        ownerSubject: identity.subject,
        title: text(input.title, 'Nazwa', 240),
        enabled: true,
        engine: 'daily-report',
        hour,
        minute,
        timezone,
        nextRunAt,
      };
      const saved = await tx.put('schedule', schedule, 0);
      await this.event(tx, identity, 'schedule.created', saved.id, {
        nextRunAt,
      });
      return saved;
    });
  }
  async toggleSchedule(
    identity: Identity,
    scheduleId: string,
    enabled: boolean,
  ) {
    owner(identity);
    return this.store.transaction(async (tx) => {
      const s = await this.find<Schedule>(tx, identity, 'schedule', scheduleId);
      const saved = await tx.put(
        'schedule',
        {
          ...s,
          enabled,
          nextRunAt: enabled
            ? nextDaily(this.now(), s.hour, s.minute, s.timezone)
            : Number.MAX_SAFE_INTEGER,
        },
        s.version,
      );
      await this.event(tx, identity, 'schedule.toggled', s.id, { enabled });
      return saved;
    });
  }
  async tickSchedules() {
    return this.store.transaction(async (tx) => {
      let n = 0;
      for (const candidate of await tx.dueSchedules(this.now())) {
        const s = await tx.get<Schedule>(
          candidate.tenantId,
          'schedule',
          candidate.id,
        );
        if (!s?.enabled) continue;
        const identity: Identity = {
          tenantId: s.tenantId,
          subject: 'scheduler',
          role: 'owner',
        };
        const run = await this.enqueueTx(tx, identity, {
          engine: 'daily-report',
          input: {
            date: dateKey(s.nextRunAt, s.timezone),
            timezone: s.timezone,
          },
          idempotencyKey: `schedule:${s.id}:${dateKey(s.nextRunAt, s.timezone)}`,
        }, { requestedBy: s.ownerSubject, trigger: 'schedule' });
        await tx.put(
          'schedule',
          {
            ...s,
            nextRunAt: nextDaily(this.now(), s.hour, s.minute, s.timezone),
            lastRunId: run.id,
          },
          s.version,
        );
        await this.event(tx, identity, 'schedule.triggered', s.id, {
          runId: run.id,
        });
        n++;
      }
      return n;
    });
  }
  async createLearning(identity: Identity, input: Record<string, unknown>) {
    requireWrite(identity);
    return this.store.transaction(async (tx) => {
      const s: LearningSession = {
        ...this.base(identity),
        title: text(input.title, 'Cel nauki', 240),
        status: 'active',
        exam: input.exam === true,
        observations: [],
      };
      const saved = await tx.put('learning', s, 0);
      await this.event(tx, identity, 'learning.started', s.id, {
        exam: s.exam,
      });
      return saved;
    });
  }
  async observe(
    identity: Identity,
    sessionId: string,
    input: Record<string, unknown>,
  ) {
    requireWrite(identity);
    return this.store.transaction(async (tx) => {
      const s = await this.find<LearningSession>(
        tx,
        identity,
        'learning',
        sessionId,
      );
      if (s.status !== 'active')
        throw new OsaError('CLOSED', 'Sesja zakończona.', 409);
      if (s.observations.length >= 100)
        throw new OsaError('LIMIT', 'Maksymalnie 100 obserwacji w sesji.');
      const saved = await tx.put(
        'learning',
        {
          ...s,
          observations: [
            ...s.observations,
            {
              at: new Date(this.now()).toISOString(),
              text: text(input.text, 'Obserwacja', 2000),
            },
          ],
        },
        s.version,
      );
      await this.event(tx, identity, 'learning.observed', s.id, {
        count: saved.observations.length,
      });
      return saved;
    });
  }
  async finishLearning(identity: Identity, sessionId: string) {
    requireWrite(identity);
    return this.store.transaction(async (tx) => {
      const s = await this.find<LearningSession>(
        tx,
        identity,
        'learning',
        sessionId,
      );
      if (s.exam)
        throw new OsaError(
          'EXAM_ACTIVE',
          'Nie analizujemy trwającego ocenianego egzaminu.',
          409,
        );
      if (s.status === 'completed') return s;
      const run = await this.enqueueTx(tx, identity, {
        engine: 'certificate',
        input: {
          context: `Cel: ${s.title}\nObserwacje użytkownika:\n${s.observations.map((o) => o.at + ' ' + o.text).join('\n')}`,
          exam: false,
        },
        idempotencyKey: 'learning-report:' + s.id,
      });
      const saved = await tx.put(
        'learning',
        { ...s, status: 'completed', reportRunId: run.id },
        s.version,
      );
      await this.event(tx, identity, 'learning.completed', s.id, {
        reportRunId: run.id,
      });
      return saved;
    });
  }
  async saveFocus(identity: Identity, input: Record<string, unknown>) {
    requireWrite(identity);
    const seconds = Number(input.seconds);
    if (!Number.isInteger(seconds) || seconds < 1 || seconds > 86400)
      throw new OsaError('INVALID_INPUT', 'Czas sesji: 1–86400 sekund.');
    const finishedAt = new Date(this.now()).toISOString();
    return this.store.transaction(async (tx) => {
      const s: FocusSession = {
        ...this.base(identity),
        title: text(input.title, 'Cel', 240),
        seconds,
        finishedAt,
        startedAt: new Date(this.now() - seconds * 1000).toISOString(),
      };
      const saved = await tx.put('focus', s, 0);
      await this.event(tx, identity, 'focus.recorded', s.id, {
        seconds,
        measurement: 'client-declared',
      });
      return saved;
    });
  }
  async report(identity: Identity, date?: string) {
    return this.store.read(async (tx) => {
      const [
        { items: missions },
        { items: runs },
        { items: proof },
        { items: focus },
        totalMissions,
        totalRuns,
        totalEvidence,
      ] = await Promise.all([
        tx.list<Mission>(identity.tenantId, 'mission', 200),
        tx.list<Run>(identity.tenantId, 'run', 200),
        tx.list<Evidence>(identity.tenantId, 'evidence', 200),
        tx.list<FocusSession>(identity.tenantId, 'focus', 200),
        tx.count(identity.tenantId, 'mission'),
        tx.count(identity.tenantId, 'run'),
        tx.count(identity.tenantId, 'evidence'),
      ]);
      return {
        date: date || dateKey(this.now(), 'Europe/Amsterdam'),
        generatedAt: new Date(this.now()).toISOString(),
        coverage: {
          missions: { included: missions.length, total: totalMissions },
          runs: { included: runs.length, total: totalRuns },
          evidence: { included: proof.length, total: totalEvidence },
        },
        missions,
        runs,
        evidence: proof,
        focus,
        nextSteps: missions
          .filter((m) => !['completed', 'cancelled'].includes(m.status))
          .map((m) => ({
            missionId: m.id,
            title: m.title,
            next:
              m.steps.find((s) => !s.done)?.title ||
              'Dodaj następny krok lub dowód',
          })),
      };
    });
  }
  async audit(identity: Identity, after = 0) {
    return this.store.read(async (tx) => {
      const events = await tx.events(identity.tenantId, after, 200);
      let previous = after ? undefined : 'GENESIS';
      const valid = events.every((e) => {
        const { digest: hash, ...unsigned } = e;
        const ok =
          digest(unsigned) === hash &&
          (previous === undefined || e.previousDigest === previous);
        previous = e.digest;
        return ok;
      });
      return {
        events,
        valid,
        scope: after ? 'page-integrity' : 'chain-from-genesis',
        nextAfter: events.at(-1)?.seq || after,
      };
    });
  }
}
