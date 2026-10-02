import { digest } from '../../kernel/src/guards.js';
import { OsaError } from '../../kernel/src/contracts.js';
import type {
  AuditEvent,
  Entity,
  Kind,
  Page,
  Run,
} from '../../kernel/src/contracts.js';
import type { Tx } from './store.js';
export type Query = (
  sql: string,
  parameters?: unknown[],
) => Promise<{ rows: Record<string, unknown>[]; rowCount: number }>;
export const schema = [
  `CREATE TABLE IF NOT EXISTS osa_entities (
    tenant_id TEXT NOT NULL, kind TEXT NOT NULL, id TEXT NOT NULL,
    version INTEGER NOT NULL, created_at TEXT NOT NULL, data TEXT NOT NULL,
    status TEXT, available_at BIGINT, lease_until BIGINT, idem_key TEXT, mission_id TEXT,
    PRIMARY KEY(tenant_id,kind,id))`,
  `CREATE INDEX IF NOT EXISTS osa_entities_list ON osa_entities(tenant_id,kind,created_at,id)`,
  `CREATE INDEX IF NOT EXISTS osa_runs_queue ON osa_entities(kind,status,available_at,lease_until)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS osa_runs_idem ON osa_entities(tenant_id,idem_key) WHERE kind='run'`,
  `CREATE INDEX IF NOT EXISTS osa_evidence_mission ON osa_entities(tenant_id,kind,mission_id)`,
  `CREATE TABLE IF NOT EXISTS osa_events (tenant_id TEXT NOT NULL, seq BIGINT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(tenant_id,seq))`,
  `CREATE TABLE IF NOT EXISTS osa_schema (version INTEGER PRIMARY KEY)`,
  `INSERT INTO osa_schema(version) VALUES(1) ON CONFLICT DO NOTHING`,
];
export class SqlTx implements Tx {
  constructor(private query: Query) {}
  async get<T extends Entity>(tenant: string, kind: Kind, id: string) {
    const { rows } = await this.query(
      'SELECT data FROM osa_entities WHERE tenant_id=$1 AND kind=$2 AND id=$3',
      [tenant, kind, id],
    );
    return rows[0] ? (JSON.parse(String(rows[0].data)) as T) : undefined;
  }
  async put<T extends Entity>(
    kind: Kind,
    entity: T,
    expectedVersion: number,
  ): Promise<T> {
    const next = { ...entity, version: expectedVersion + 1 };
    const extra = next as T & {
      status?: string;
      availableAt?: number;
      leaseUntil?: number;
      idempotencyKey?: string;
      nextRunAt?: number;
      missionId?: string;
    };
    const values = [
      next.tenantId,
      kind,
      next.id,
      next.version,
      next.createdAt,
      JSON.stringify(next),
      extra.status || null,
      extra.availableAt ?? extra.nextRunAt ?? 0,
      extra.leaseUntil || 0,
      extra.idempotencyKey || null,
      extra.missionId || null,
    ];
    let changed: number;
    if (!expectedVersion) {
      const r = await this.query(
        'INSERT INTO osa_entities(tenant_id,kind,id,version,created_at,data,status,available_at,lease_until,idem_key,mission_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT DO NOTHING',
        values,
      );
      changed = r.rowCount;
    } else {
      const r = await this.query(
        'UPDATE osa_entities SET version=$4,created_at=$5,data=$6,status=$7,available_at=$8,lease_until=$9,idem_key=$10,mission_id=$11 WHERE tenant_id=$1 AND kind=$2 AND id=$3 AND version=$12',
        [...values, expectedVersion],
      );
      changed = r.rowCount;
    }
    if (!changed)
      throw new OsaError(
        'VERSION_CONFLICT',
        'Dane zmieniły się. Odśwież widok i ponów świadomie.',
        409,
      );
    return next;
  }
  async list<T extends Entity>(
    tenant: string,
    kind: Kind,
    limit = 50,
    cursor?: string,
  ): Promise<Page<T>> {
    limit = Math.max(1, Math.min(200, limit));
    let pair: string[] | undefined;
    if (cursor) {
      try {
        pair = JSON.parse(Buffer.from(cursor, 'base64url').toString());
      } catch {
        throw new OsaError('INVALID_CURSOR', 'Nieprawidłowy kursor.');
      }
      if (
        !Array.isArray(pair) ||
        pair.length !== 2 ||
        pair.some((x) => typeof x !== 'string')
      )
        throw new OsaError('INVALID_CURSOR', 'Nieprawidłowy kursor.');
    }
    const values: unknown[] = [tenant, kind, limit + 1];
    let where = '';
    if (pair) {
      values.push(pair[0], pair[1]);
      where = ' AND (created_at<$4 OR (created_at=$4 AND id<$5))';
    }
    const { rows } = await this.query(
      `SELECT data FROM osa_entities WHERE tenant_id=$1 AND kind=$2${where} ORDER BY created_at DESC,id DESC LIMIT $3`,
      values,
    );
    const items = rows
      .slice(0, limit)
      .map((r) => JSON.parse(String(r.data)) as T);
    const last = items.at(-1);
    return {
      items,
      nextCursor:
        rows.length > limit && last
          ? Buffer.from(JSON.stringify([last.createdAt, last.id])).toString(
              'base64url',
            )
          : undefined,
    };
  }
  async count(tenant: string, kind: Kind) {
    const { rows } = await this.query(
      'SELECT COUNT(*) AS n FROM osa_entities WHERE tenant_id=$1 AND kind=$2',
      [tenant, kind],
    );
    return Number(rows[0]?.n || 0);
  }
  async events(tenant: string, after = 0, limit = 100) {
    const { rows } = await this.query(
      'SELECT data FROM osa_events WHERE tenant_id=$1 AND seq>$2 ORDER BY seq LIMIT $3',
      [tenant, after, Math.min(200, limit)],
    );
    return rows.map((r) => JSON.parse(String(r.data)) as AuditEvent);
  }
  async append(input: Omit<AuditEvent, 'seq' | 'digest' | 'previousDigest'>) {
    const { rows } = await this.query(
      'SELECT data FROM osa_events WHERE tenant_id=$1 ORDER BY seq DESC LIMIT 1',
      [input.tenantId],
    );
    const previous = rows[0]
      ? (JSON.parse(String(rows[0].data)) as AuditEvent)
      : undefined;
    const unsigned = {
      ...input,
      seq: (previous?.seq || 0) + 1,
      previousDigest: previous?.digest || 'GENESIS',
    };
    const event = { ...unsigned, digest: digest(unsigned) };
    await this.query(
      'INSERT INTO osa_events(tenant_id,seq,data) VALUES($1,$2,$3)',
      [event.tenantId, event.seq, JSON.stringify(event)],
    );
    return event;
  }
  async runnable(now: number) {
    const { rows } = await this.query(
      "SELECT data FROM osa_entities WHERE kind='run' AND ((status='queued' AND available_at<=$1) OR (status='running' AND lease_until<$1)) ORDER BY available_at,id LIMIT 1",
      [now],
    );
    return rows[0] ? (JSON.parse(String(rows[0].data)) as Run) : undefined;
  }
  async dueSchedules(now: number) {
    const { rows } = await this.query(
      "SELECT tenant_id,id FROM osa_entities WHERE kind='schedule' AND available_at<=$1 ORDER BY available_at LIMIT 20",
      [now],
    );
    return rows.map((r) => ({
      tenantId: String(r.tenant_id),
      id: String(r.id),
    }));
  }
  async byIdempotency(tenant: string, key: string) {
    const { rows } = await this.query(
      "SELECT data FROM osa_entities WHERE tenant_id=$1 AND kind='run' AND idem_key=$2",
      [tenant, key],
    );
    return rows[0] ? (JSON.parse(String(rows[0].data)) as Run) : undefined;
  }
  async evidenceForMission(tenant: string, missionId: string) {
    const { rows } = await this.query(
      "SELECT data FROM osa_entities WHERE tenant_id=$1 AND kind='evidence' AND mission_id=$2 ORDER BY created_at DESC LIMIT 200",
      [tenant, missionId],
    );
    return rows.map(
      (r) =>
        JSON.parse(
          String(r.data),
        ) as import('../../kernel/src/contracts.js').Evidence,
    );
  }
}
