import assert from 'node:assert/strict';
import test from 'node:test';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { QueryResult, QueryResultRow } from 'pg';
import { createAccount, resendInvitation, AccountServiceDependencies } from './accounts.service.js';
import { AccountConflictError, AccountAuthorizationError } from './accounts.errors.js';
import { CreateAccountInput, ProvisioningActor } from './accounts.types.js';

const actor: ProvisioningActor = {
  id: 'usr-1',
  email: 'admin@example.com',
  role: 'Admin',
  departmentId: 1
};

const input: CreateAccountInput = {
  fullName: 'Ayesha Khan',
  username: 'ayesha.khan',
  email: 'ayesha@example.com',
  password: 'Strong#123',
  baseRole: 'Team_Member',
  departmentId: 2
};

const result = <T extends QueryResultRow>(rows: T[], rowCount = rows.length): QueryResult<T> => ({
  command: '',
  rowCount,
  oid: 0,
  fields: [],
  rows
});

interface HarnessOptions {
  emailFails?: boolean;
  databaseFails?: boolean;
  authFails?: boolean;
}

const harness = (options: HarnessOptions = {}) => {
  const calls = {
    authPassword: '',
    emailPassword: '',
    deleteIds: [] as string[],
    databaseWrites: 0,
    invitationUpdates: 0,
    authPayload: undefined as Record<string, unknown> | undefined,
    profileInsertSql: ''
  };
  const admin = {
    createUser: async (payload: Record<string, unknown>) => {
      calls.authPayload = payload;
      calls.authPassword = String(payload.password || '');
      return options.authFails
        ? { data: { user: null }, error: { message: 'Auth unavailable' } }
        : { data: { user: { id: 'auth-99' } }, error: null };
    },
    deleteUser: async (id: string) => {
      calls.deleteIds.push(id);
      return { data: {}, error: null };
    }
  };
  const query = async <T extends QueryResultRow>(sql: string): Promise<QueryResult<T>> => {
    if (sql.includes('FROM org.departments')) {
      return result([{ departmentid: 2, departmentname: 'Engineering' }] as unknown as T[]);
    }
    if (sql.includes('EXISTS (SELECT 1 FROM iam.users')) {
      return result([{ emailmatch: false, usernamematch: false }] as unknown as T[]);
    }
    if (sql.includes('UPDATE iam.users SET invitationsentatutc')) {
      calls.invitationUpdates += 1;
      return result([{ invitationsentatutc: '2026-07-30T12:00:00.000Z' }] as unknown as T[]);
    }
    throw new Error(`Unexpected query: ${sql}`);
  };
  const transaction = async <T>(work: (run: typeof query) => Promise<T>): Promise<T> => {
    if (options.databaseFails) {
      const error = Object.assign(new Error('duplicate key'), {
        code: '23505',
        constraint: 'ux_users_organization_username_ci'
      });
      throw error;
    }
    const run = async <U extends QueryResultRow>(sql: string): Promise<QueryResult<U>> => {
      calls.databaseWrites += 1;
      if (sql.includes('SELECT roleid FROM iam.roles')) return result([{ roleid: 4 }] as unknown as U[]);
      if (sql.includes('INSERT INTO iam.users')) {
        calls.profileInsertSql = sql;
        return result([{ userid: 99 }] as unknown as U[]);
      }
      return result([] as U[], 1);
    };
    return work(run);
  };
  const dependencies = {
    query,
    withTransaction: transaction,
    supabase: () => ({ auth: { admin } }) as unknown as SupabaseClient,
    sendCredentials: async (payload: { password: string }) => {
      calls.emailPassword = payload.password;
      if (options.emailFails) throw new Error('SMTP unavailable');
    },
    sendPasswordReset: async () => undefined
  } as unknown as AccountServiceDependencies;
  return { calls, dependencies };
};

test('provisions an active account with a permanent Auth password and records a sent credential email', async () => {
  const { calls, dependencies } = harness();
  const created = await createAccount(actor, input, dependencies);
  assert.equal(calls.authPassword, input.password);
  assert.equal(calls.emailPassword, input.password);
  assert.equal(calls.invitationUpdates, 1);
  assert.equal(created.invitationStatus, 'sent');
  assert.equal(created.account.accountStatus, 'Active');
  assert.match(calls.profileInsertSql, /'Active'/);
  assert.equal('app_metadata' in (calls.authPayload || {}), false);
  assert.equal('password' in created.account, false);
});

test('SMTP failure preserves the Auth identity and active profile with email_failed status', async () => {
  const { calls, dependencies } = harness({ emailFails: true });
  const created = await createAccount(actor, input, dependencies);
  assert.equal(created.invitationStatus, 'email_failed');
  assert.equal(created.account.accountStatus, 'Active');
  assert.deepEqual(calls.deleteIds, []);
  assert.ok(calls.databaseWrites > 0);
  assert.equal(calls.invitationUpdates, 0);
});

test('database failure compensates the new Auth identity and translates username races', async () => {
  const { calls, dependencies } = harness({ databaseFails: true });
  await assert.rejects(() => createAccount(actor, input, dependencies), AccountConflictError);
  assert.deepEqual(calls.deleteIds, ['auth-99']);
  assert.equal(calls.emailPassword, '');
});

test('Auth failure creates no profile and HR cannot create privileged roles', async () => {
  const authFailure = harness({ authFails: true });
  await assert.rejects(() => createAccount(actor, input, authFailure.dependencies));
  assert.equal(authFailure.calls.databaseWrites, 0);

  const hrActor = { ...actor, role: 'HR' as const };
  await assert.rejects(
    () => createAccount(hrActor, { ...input, baseRole: 'Admin' }, harness().dependencies),
    AccountAuthorizationError
  );
});

test('credential-email recovery sends a reset link without attempting to recover the permanent password', async () => {
  let emailed: Record<string, unknown> | undefined;
  const dependencies = {
    query: async <T extends QueryResultRow>(sql: string): Promise<QueryResult<T>> => {
      if (sql.includes('GROUP BY u.userid')) {
        return result([{
          userid: 99,
          authuserid: 'auth-99',
          email: 'ayesha@example.com',
          displayname: 'Ayesha Khan',
          departmentid: 2,
          accountstatus: 'Active',
          createdbyuserid: 1,
          invitationsentatutc: null,
          rolecode: 'TeamMember'
        }] as unknown as T[]);
      }
      if (sql.includes('UPDATE iam.users SET invitationsentatutc')) return result([] as T[], 1);
      throw new Error(`Unexpected query: ${sql}`);
    },
    withTransaction: async () => { throw new Error('not used'); },
    supabase: () => ({
      auth: {
        admin: {
          generateLink: async () => ({
            data: { properties: { action_link: 'https://auth.example/reset-token' } },
            error: null
          })
        }
      }
    }) as unknown as SupabaseClient,
    sendCredentials: async () => { throw new Error('credential sender must not be used'); },
    sendPasswordReset: async (payload: Record<string, unknown>) => { emailed = payload; }
  } as unknown as AccountServiceDependencies;

  await resendInvitation(actor, 'usr-99', dependencies);
  assert.equal(emailed?.actionLink, 'https://auth.example/reset-token');
  assert.equal('password' in (emailed || {}), false);
});
