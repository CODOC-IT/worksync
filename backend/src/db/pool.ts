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

    // Mirrors database/18_notify_seed.sql's notify.NotificationTypes rows -- and ONLY those rows,
    // never that file's iam.Users/work.Projects/work.Tasks demo fixtures, which must never be
    // injected into a real database. Re-applied idempotently on every boot for exactly the same
    // reason as the system-actor row above: 18_notify_seed.sql only runs via setup.sql's
    // one-time, by-hand `psql -f` provisioning step, so any database this app is later pointed
    // at (a fresh Supabase project, a restored backup, a teammate's local DB) ends up with the
    // notify.* TABLES but none of their reference DATA.
    //
    // This is not cosmetic: notification.service.ts's publishEvent() resolves the event's
    // TypeCode against this table first and THROWS ("Unknown notification type ...") when it
    // finds nothing -- so an empty NotificationTypes table silently breaks *every* notification
    // for *every* role app-wide, while the rest of the app keeps working normally, which is a
    // genuinely confusing failure to diagnose from the UI. Seeding here makes the notification
    // module self-provisioning against whatever database DATABASE_URL points at.
    const notificationTypes: Array<[string, string, string]> = [
      // Task
      ['task_assigned', 'Task', 'High'], ['task_reassigned', 'Task', 'High'],
      ['task_updated', 'Task', 'Normal'], ['task_status_changed', 'Task', 'Normal'],
      ['task_priority_changed', 'Task', 'Normal'], ['task_due_date_changed', 'Task', 'Normal'],
      ['task_review_requested', 'Task', 'High'], ['task_review_approved', 'Task', 'High'],
      ['task_review_rejected', 'Task', 'High'], ['task_completed', 'Task', 'Normal'],
      ['task_deleted', 'Task', 'Normal'], ['task_due_today', 'Task', 'High'],
      ['task_due_tomorrow', 'Task', 'Normal'], ['task_overdue', 'Task', 'High'],
      ['checklist_completed', 'Task', 'Low'], ['comment_added', 'Task', 'Normal'],
      ['mention', 'Chat', 'Normal'], ['attachment_uploaded', 'Task', 'Low'],
      // Project
      ['project_created', 'Project', 'Normal'], ['project_updated', 'Project', 'Low'],
      ['project_archived', 'Project', 'Normal'], ['project_restored', 'Project', 'Normal'],
      ['project_deleted', 'Project', 'High'], ['project_member_added', 'Project', 'Normal'],
      ['project_member_removed', 'Project', 'Normal'],
      // Approvals / system / admin
      ['approval', 'Approval', 'High'], ['user_registered', 'System', 'Normal'],
      ['user_role_changed', 'System', 'High'], ['user_deactivated', 'System', 'High'],
      ['workspace_created', 'System', 'Normal'], ['workspace_deleted', 'System', 'High'],
      ['backup_completed', 'System', 'Low'], ['backup_failed', 'System', 'Critical'],
      ['security_alert', 'System', 'Critical'], ['audit_alert', 'System', 'High'],
      ['system_maintenance', 'System', 'Normal'], ['attendance', 'Attendance', 'Normal'],
      ['task', 'Task', 'Normal'], ['system', 'System', 'Low'],
      // Attendance
      ['attendance_check_in', 'Attendance', 'Low'], ['attendance_check_out', 'Attendance', 'Low'],
      ['attendance_late_check_in', 'Attendance', 'Normal'], ['attendance_absent', 'Attendance', 'High'],
      ['attendance_correction_submitted', 'Attendance', 'Normal'],
      ['attendance_correction_approved', 'Attendance', 'Normal'],
      ['attendance_correction_rejected', 'Attendance', 'Normal'],
      // Break
      ['break_started', 'Break', 'Low'], ['break_ended', 'Break', 'Low'],
      ['break_exceeded', 'Break', 'High'], ['break_reminder', 'Break', 'Normal'],
      ['break_approved', 'Break', 'Normal'], ['break_rejected', 'Break', 'Normal'],
      // Reports
      ['report_weekly_generated', 'Report', 'Normal'], ['report_monthly_generated', 'Report', 'Normal'],
      ['report_sprint_ready', 'Report', 'Normal'], ['report_productivity_ready', 'Report', 'Normal'],
      ['report_project_completion', 'Report', 'High'],
      // Project Chat
      ['chat_reply', 'Chat', 'Normal'], ['chat_new_message', 'Chat', 'Low'],
      ['chat_file_shared', 'Chat', 'Normal'], ['chat_thread_reply', 'Chat', 'Normal'],
      ['chat_announcement', 'Chat', 'High'],
      // AI Assistant
      ['ai_sprint_generated', 'AI', 'Normal'], ['ai_tasks_generated', 'AI', 'Normal'],
      ['ai_meeting_summarized', 'AI', 'Normal'], ['ai_deadline_suggested', 'AI', 'Normal'],
      ['ai_overdue_detected', 'AI', 'High'], ['ai_recommendation_available', 'AI', 'Low']
    ];
    // Mandatory types are the ones a user may not opt out of, matching 18_notify_seed.sql.
    const MANDATORY_TYPES = new Set(['backup_failed', 'security_alert']);
    const typeValuePlaceholders = notificationTypes
      .map((_, index) => `($${index * 4 + 1}, $${index * 4 + 2}, $${index * 4 + 3}, $${index * 4 + 4}, TRUE)`)
      .join(', ');
    await bootPool.query(
      `INSERT INTO notify.NotificationTypes
         (TypeCode, CategoryCode, DefaultPriority, IsMandatory, DefaultEnabled)
       VALUES ${typeValuePlaceholders}
       ON CONFLICT (TypeCode) DO NOTHING`,
      notificationTypes.flatMap(([typeCode, categoryCode, defaultPriority]) => [
        typeCode, categoryCode, defaultPriority, MANDATORY_TYPES.has(typeCode)
      ])
    );

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
