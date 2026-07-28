import { Pool, QueryResult, QueryResultRow } from 'pg';
import { isSupabaseServiceConfigured, getSupabaseServiceClient } from './supabase.js';
import type { SupabaseClient } from '@supabase/supabase-js';

function resolveDbUrl(): string {
  return process.env.DATABASE_URL || process.env.SUPABASE_DATABASE_URL || '';
}

function resolveSupabaseProjectUrl(): string {
  return process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
}

// SSL is required by hosted Postgres (Supabase) but unsupported by a plain local install (e.g.
// Chocolatey's default Postgres has no SSL configured) -- forcing it on unconditionally makes
// local dev fail with "The server does not support SSL connections". Deployed environments are
// the only ones with VERCEL/NODE_ENV=production set, which is exactly the same signal
// server.ts already uses to distinguish "running on Vercel" from local dev.
function resolveSslOption(): { rejectUnauthorized: boolean } | undefined {
  const isDeployed = process.env.VERCEL === '1' || process.env.NODE_ENV === 'production';
  return isDeployed ? { rejectUnauthorized: false } : undefined;
}

let pool: Pool | null = null;

export const isDatabaseConfigured = (): boolean => Boolean(resolveDbUrl());
export const isSupabaseAvailable = (): boolean => isSupabaseServiceConfigured() || isDatabaseConfigured();

export const getPool = (): Pool => {
  if (!pool) {
    const dbUrl = resolveDbUrl();
    if (!dbUrl) {
      const hasSupabaseProject = Boolean(resolveSupabaseProjectUrl());
      throw new Error(
        'DATABASE_URL is not configured.\n\n' +
        (hasSupabaseProject
          ? 'A Supabase project URL is configured. To connect:\n' +
            '1. Go to Supabase Dashboard > Project Settings > Database\n' +
            '2. Copy the Connection Pooling URI (Session mode, port 5432)\n' +
            '3. Set it as DATABASE_URL in your .env file\n'
          : 'Set DATABASE_URL to your PostgreSQL connection string in your .env file.\n' +
            'If using Supabase, also set SUPABASE_URL or VITE_SUPABASE_URL.')
      );
    }
    pool = new Pool({ connectionString: dbUrl, ssl: resolveSslOption() });
  }
  return pool;
};

export const getSupabaseClient = (): SupabaseClient | null => {
  if (!isSupabaseServiceConfigured()) return null;
  try {
    return getSupabaseServiceClient();
  } catch {
    return null;
  }
};

export const setPoolForTesting = (customPool: Pool): void => {
  pool = customPool;
};
export const resetPoolForTesting = (): void => {
  pool = null;
};

export const bootstrapDatabase = async (): Promise<void> => {
  const dbUrl = resolveDbUrl();
  if (!dbUrl) return;

  const bootPool = new Pool({ connectionString: dbUrl, ssl: resolveSslOption() });
  try {
    await bootPool.query(`
      INSERT INTO org.Organizations (OrganizationId, OrganizationCode, OrganizationName)
      OVERRIDING SYSTEM VALUE
      VALUES (1, 'WORKSYNC', 'WorkSync Inc.')
      ON CONFLICT (OrganizationId) DO NOTHING
    `);

    await bootPool.query(`
      INSERT INTO iam.Roles (RoleCode, RoleName, IsSystemRole, IsTemporary, Description)
      VALUES
        ('Administrator', 'Administrator', TRUE, FALSE, 'Organization-wide administration'),
        ('TeamMember', 'Team Member', TRUE, FALSE, 'Standard authenticated user'),
        ('TeamLead', 'Temporary Team Lead', TRUE, TRUE, 'Project-scoped temporary responsibility'),
        ('HRRepresentative', 'Temporary HR Representative', TRUE, TRUE, 'Attendance-scoped temporary responsibility')
      ON CONFLICT (RoleCode) DO NOTHING
    `);

    // Matches database/23_system_actor_bootstrap.sql exactly -- kept here too (not just in
    // setup.sql's \ir list) because setup.sql only ever runs once, by hand, at initial
    // provisioning. Any database this app points at later (a fresh Supabase project, a
    // teammate's local DB, a restored backup) needs this row before the first registration can
    // succeed, so it's re-applied idempotently on every boot instead of requiring a manual
    // psql -f step each time DATABASE_URL changes.
    await bootPool.query(`
      INSERT INTO iam.Users (OrganizationId, Email, GivenName, FamilyName, DisplayName, Designation, AccountStatus)
      VALUES (1, 'system@worksync.internal', 'System', 'WorkSync', 'WorkSync System', 'System Actor', 'Locked')
      ON CONFLICT (OrganizationId, Email) DO NOTHING
    `);

    console.log('[Database] Bootstrap seeding complete ✓');
  } catch (err: any) {
    console.warn(`[Database] Bootstrap seed skipped (tables may not exist yet): ${err.message}`);
  } finally {
    await bootPool.end();
  }
};

export const query = <T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<QueryResult<T>> => getPool().query<T>(text, params);

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
