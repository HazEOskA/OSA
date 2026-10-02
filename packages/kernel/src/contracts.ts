export type Role = 'owner' | 'builder' | 'reader';
export interface Identity {
  tenantId: string;
  subject: string;
  role: Role;
}
export type MissionStatus = 'draft' | 'active' | 'completed' | 'cancelled';
export interface Step {
  id: string;
  title: string;
  done: boolean;
}
export interface Entity {
  id: string;
  tenantId: string;
  version: number;
  createdAt: string;
}
export interface Mission extends Entity {
  title: string;
  description: string;
  status: MissionStatus;
  steps: Step[];
  closedAt?: string;
}
export type RunStatus =
  'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
export interface Run extends Entity {
  missionId?: string;
  engine: string;
  input: Record<string, unknown>;
  status: RunStatus;
  attempt: number;
  maxAttempts: number;
  availableAt: number;
  leaseUntil: number;
  claimToken: string;
  workerId: string;
  output?: EngineResult;
  error?: string;
  startedAt?: string;
  finishedAt?: string;
  idempotencyKey: string;
  requestDigest: string;
}
export interface Source {
  url: string;
  title: string;
  capturedAt: string;
}
export interface EngineResult {
  text: string;
  producer: string;
  verdict: 'draft' | 'passed' | 'failed' | 'report';
  sources: Source[];
  metadata?: Record<string, unknown>;
}
export interface Evidence extends Entity {
  missionId?: string;
  runId?: string;
  kind: 'user-artifact' | 'ai-draft' | 'verification' | 'report';
  content: string;
  digest: string;
  producer: string;
  verdict: string;
  runDigest?: string;
}
export interface Approval extends Entity {
  action: string;
  payload: Record<string, unknown>;
  payloadDigest: string;
  status: 'pending' | 'approved' | 'rejected';
  decisionBy?: string;
  decidedAt?: string;
}
export interface Schedule extends Entity {
  title: string;
  enabled: boolean;
  engine: 'daily-report';
  hour: number;
  minute: number;
  timezone: string;
  nextRunAt: number;
  lastRunId?: string;
}
export interface LearningSession extends Entity {
  title: string;
  status: 'active' | 'completed';
  exam: boolean;
  observations: { at: string; text: string }[];
  reportRunId?: string;
}
export interface FocusSession extends Entity {
  title: string;
  startedAt: string;
  finishedAt: string;
  seconds: number;
}
export interface AuditEvent {
  seq: number;
  tenantId: string;
  subject: string;
  type: string;
  entityId: string;
  at: string;
  payload: Record<string, unknown>;
  previousDigest: string;
  digest: string;
}
export type Kind =
  | 'mission'
  | 'run'
  | 'evidence'
  | 'approval'
  | 'schedule'
  | 'learning'
  | 'focus'
  | 'session';
export interface Page<T> {
  items: T[];
  nextCursor?: string;
}
export interface EngineContext {
  identity: Identity;
  signal: AbortSignal;
  run: Run;
}
export interface Engine {
  id: string;
  title: string;
  execute(
    input: Record<string, unknown>,
    context: EngineContext,
  ): Promise<EngineResult>;
}
export class OsaError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
    public retryable = false,
  ) {
    super(message);
  }
}
