import { Pool, QueryResult, QueryResultRow } from 'pg';

// Single shared connection pool for the whole backend. Only the Notification
// Module uses this today (see backend/src/notifications/) — every other
// backend module (auth, OTP, AI Assistant) still uses its own in-memory or
// file-backed store, per docs/ProjectAnalysis.md. This file exists so any
// future module needing real Postgres access has one place to get it,
// rather than each module opening its own pool.
let pool: Pool | null = null;

export const isDatabaseConfigured = (): boolean => Boolean(process.env.DATABASE_URL);

export const getPool = (): Pool => {
  if (!pool) {
    if (!isDatabaseConfigured()) {
      throw new Error(
        'DATABASE_URL is not configured. Apply database/setup.sql to a PostgreSQL instance ' +
        'and set DATABASE_URL in your .env file before using Notification Module persistence.'
      );
    }
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
  }
  return pool;
};

// Test-only seam: lets notification.repository.test.ts inject a pg-mem-backed Pool instead of
// opening a real connection, so repository/service logic can be verified against the actual
// notify.* schema DDL without a live Postgres instance. Never called from production code.
export const setPoolForTesting = (customPool: Pool): void => {
  pool = customPool;
};
export const resetPoolForTesting = (): void => {
  pool = null;
};

// Thin query helper — every repository in this backend should go through this
// (rather than importing `pg` directly) so connection lifecycle/config stays
// centralized in one place.
export const query = <T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<QueryResult<T>> => getPool().query<T>(text, params);

// Runs `work` inside a single client checked out from the pool, wrapped in a
// transaction (BEGIN/COMMIT/ROLLBACK) — used by the notification repository
// for its "create one Notification + fan out N UserNotifications" write,
// which must be atomic.
export const withTransaction = async <T>(
  work: (runQuery: typeof query) => Promise<T>
): Promise<T> => {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const scopedQuery = (<U extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]) =>
      client.query<U>(text, params)) as typeof query;
    const result = await work(scopedQuery);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};
