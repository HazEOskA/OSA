import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { schema, SqlTx } from './sql.js';
import type { Query } from './sql.js';
import type { Store, Tx } from './store.js';
const gates = new Map<string, Promise<unknown>>();
export class SqliteStore implements Store {
  readonly kind = 'sqlite' as const;
  private db: DatabaseSync;
  private path: string;
  private tx: SqlTx;
  constructor(path: string) {
    this.path = path === ':memory:' ? 'memory:' + Math.random() : resolve(path);
    if (path !== ':memory:') mkdirSync(dirname(this.path), { recursive: true });
    this.db = new DatabaseSync(path === ':memory:' ? path : this.path);
    this.db.exec(
      'PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;',
    );
    for (const statement of schema) this.db.exec(statement);
    const query: Query = async (sql, values = []) => {
      const statement = this.db.prepare(sql);
      // SQLite uses parameter names while pg uses ordered positional binds.
      const params = Object.fromEntries(
        values.map((v, i) => ['$' + (i + 1), v]),
      );
      if (/^\s*SELECT/i.test(sql)) {
        return {
          rows: statement.all(
            params as Record<string, string | number | null>,
          ) as Record<string, unknown>[],
          rowCount: 0,
        };
      }
      const r = statement.run(params as Record<string, string | number | null>);
      return { rows: [], rowCount: Number(r.changes) };
    };
    this.tx = new SqlTx(query);
  }
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const previous = gates.get(this.path) || Promise.resolve();
    const run = previous.catch(() => undefined).then(fn);
    gates.set(this.path, run);
    return run;
  }
  transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.serial(async () => {
      this.db.exec('BEGIN IMMEDIATE');
      try {
        const result = await fn(this.tx);
        this.db.exec('COMMIT');
        return result;
      } catch (e) {
        this.db.exec('ROLLBACK');
        throw e;
      }
    });
  }
  read<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.serial(() => fn(this.tx));
  }
  async close() {
    await this.serial(async () => this.db.close());
  }
}
