import { SqliteStore } from './sqlite.js';
import { PostgresStore } from './postgres.js';
export async function openStore(env = process.env) {
  if (env.OSA_DB_KIND === 'postgres') {
    if (!env.DATABASE_URL)
      throw new Error('DATABASE_URL jest wymagany dla Postgres.');
    const store = new PostgresStore(env.DATABASE_URL);
    await store.init();
    return store;
  }
  if (env.OSA_DB_KIND && env.OSA_DB_KIND !== 'sqlite')
    throw new Error('Nieobsługiwany adapter danych.');
  return new SqliteStore(env.OSA_SQLITE_PATH || './data/osa.sqlite');
}
