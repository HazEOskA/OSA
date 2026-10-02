import type {
  AuditEvent,
  Entity,
  Kind,
  Page,
  Run,
} from '../../kernel/src/contracts.js';
export interface Tx {
  get<T extends Entity>(
    tenant: string,
    kind: Kind,
    id: string,
  ): Promise<T | undefined>;
  put<T extends Entity>(
    kind: Kind,
    entity: T,
    expectedVersion: number,
  ): Promise<T>;
  list<T extends Entity>(
    tenant: string,
    kind: Kind,
    limit?: number,
    cursor?: string,
  ): Promise<Page<T>>;
  count(tenant: string, kind: Kind): Promise<number>;
  append(
    event: Omit<AuditEvent, 'seq' | 'digest' | 'previousDigest'>,
  ): Promise<AuditEvent>;
  events(tenant: string, after?: number, limit?: number): Promise<AuditEvent[]>;
  runnable(now: number): Promise<Run | undefined>;
  dueSchedules(now: number): Promise<{ tenantId: string; id: string }[]>;
  byIdempotency(tenant: string, key: string): Promise<Run | undefined>;
  evidenceForMission(
    tenant: string,
    missionId: string,
  ): Promise<import('../../kernel/src/contracts.js').Evidence[]>;
}
export interface Store {
  transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
  read<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  kind: 'sqlite' | 'postgres';
}
