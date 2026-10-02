import pg from 'pg';
import { schema, SqlTx } from './sql.js';
import type { Store, Tx } from './store.js';
export class PostgresStore implements Store {
  readonly kind = 'postgres' as const;
  private pool: pg.Pool;
  constructor(url: string) {
    this.pool = new pg.Pool({
      connectionString: url,
      max: 10,
      connectionTimeoutMillis: 5000,
      statement_timeout: 10000,
    });
  }
  async init() {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(734043391)');
      for (const sql of schema) await client.query(sql);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }
  async transaction<T>(fn: (tx: Tx) => Promise<T>) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // v1 serializes short database mutations; provider I/O never runs inside this lock.
      // This preserves event chains/idempotency and lease fencing across worker processes.
      await client.query('SELECT pg_advisory_xact_lock(734043391)');
      const result = await fn(
        new SqlTx(async (sql, values) => {
          const r = await client.query(sql, values);
          return { rows: r.rows, rowCount: r.rowCount || 0 };
        }),
      );
      await client.query('COMMIT');
      return result;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }
  async read<T>(fn: (tx: Tx) => Promise<T>) {
    return fn(
      new SqlTx(async (sql, values) => {
        const r = await this.pool.query(sql, values);
        return { rows: r.rows, rowCount: r.rowCount || 0 };
      }),
    );
  }
  async close() {
    await this.pool.end();
  }
}
