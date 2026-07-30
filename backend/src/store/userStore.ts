import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';
import { UserRecord, UserRole } from '../types.js';
import { isDatabaseConfigured, query, withTransaction } from '../db/pool.js';
import { fromUserPk, toUserPk } from '../utils/idMapping.js';

const ROLE_TO_DB: Record<UserRole, string> = {
  Admin: 'Administrator',
  Team_Lead: 'TeamLead',
  HR: 'HRRepresentative',
  Team_Member: 'TeamMember'
};

const DB_TO_ROLE: Record<string, UserRole> = {
  Administrator: 'Admin',
  TeamLead: 'Team_Lead',
  HRRepresentative: 'HR',
  TeamMember: 'Team_Member'
};

const STATUS_MAP: Record<string, 'active' | 'inactive' | 'away'> = {
  Active: 'active',
  Pending: 'inactive',
  Locked: 'inactive',
  Deactivated: 'inactive'
};

// The GrantedByUserId for every self-service registration's initial role grant. Never a real
// registrant's own id (it's a fixed, permanently-Locked row seeded once by
// database/23_system_actor_bootstrap.sql, before any real user can occupy it) -- so unlike a
// hardcoded numeric id, this can never coincide with the very user being granted the role and
// trip iam.UserRoles' CK_UserRoles_NoSelfGrant check.
const SYSTEM_ACTOR_EMAIL = 'system@worksync.internal';
let systemActorUserIdCache: number | null = null;

const getSystemActorUserId = async (): Promise<number> => {
  if (systemActorUserIdCache !== null) return systemActorUserIdCache;
  const result = await query<{ userid: number }>(
    'SELECT userid FROM iam.users WHERE organizationid = 1 AND email = $1',
    [SYSTEM_ACTOR_EMAIL]
  );
  if (!result.rows[0]) {
    throw new Error(
      'System actor user not found -- run database/23_system_actor_bootstrap.sql (included in setup.sql) before registering users.'
    );
  }
  systemActorUserIdCache = result.rows[0].userid;
  return systemActorUserIdCache;
};

const USER_QUERY = `
  SELECT u.userid, u.email, u.displayname, u.designation,
         u.accountstatus, u.createdatutc,
         r.rolecode, d.departmentname,
         uc.passwordhash, uc.passwordalgorithm
  FROM iam.users u
  LEFT JOIN iam.userroles ur ON ur.userid = u.userid
    AND ur.revokedatutc IS NULL
    AND (ur.endsatutc IS NULL OR ur.endsatutc > now())
  LEFT JOIN iam.roles r ON r.roleid = ur.roleid
  LEFT JOIN org.departments d ON d.departmentid = u.departmentid
  LEFT JOIN iam.usercredentials uc ON uc.userid = u.userid
`;

interface DbUserRow {
  userid: number;
  email: string;
  displayname: string;
  designation: string | null;
  accountstatus: string;
  createdatutc: string;
  rolecode: string | null;
  departmentname: string | null;
  passwordhash: Buffer | null;
  passwordalgorithm: string | null;
}

interface DbRoleRow {
  roleid: number;
  istemporary: boolean;
}

interface DbDepartmentRow {
  departmentid: number;
}

function rowToUserRecord(row: DbUserRow): UserRecord {
  return {
    id: fromUserPk(row.userid),
    name: row.displayname,
    email: row.email,
    // Accounts without a credential must never receive an application fallback password.
    passwordHash: row.passwordhash?.toString('utf-8') || '',
    role: row.rolecode ? (DB_TO_ROLE[row.rolecode] || 'Team_Member') : 'Team_Member',
    department: row.departmentname || 'Engineering',
    avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
    title: row.designation || 'Team Member',
    status: STATUS_MAP[row.accountstatus] || 'active',
    createdAt: row.createdatutc ? new Date(row.createdatutc).toISOString() : new Date().toISOString()
  };
}

const toDepartmentCode = (name: string): string => {
  const cleaned = name.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return (cleaned || 'DEPARTMENT').slice(0, 24);
};

class UserStore {
  private dbAvailable: boolean = false;
  private fallbackUsers: Map<string, UserRecord> = new Map();
  private initialized = false;
  private dbLoadStarted = false;

  constructor() {
    if (this.isLegacyFileAuthEnabled()) {
      this.initFileStore();
    }
  }

  private isLegacyFileAuthEnabled(): boolean {
    return process.env.NODE_ENV !== 'production'
      && process.env.ENABLE_LEGACY_FILE_AUTH === 'true';
  }

  private async ensureInit(): Promise<void> {
    if (this.initialized) return;
    if (this.dbLoadStarted) return;
    this.dbLoadStarted = true;
    this.initialized = true;

    if (isDatabaseConfigured()) {
      try {
        const result = await query<DbUserRow>(
          USER_QUERY + ' WHERE u.organizationid = 1 ORDER BY u.userid'
        );
        this.dbAvailable = true;
        // A configured database is authoritative. Clear local fallback users
        // so registrations from a previous database are not carried forward.
        this.fallbackUsers.clear();
        for (const row of result.rows) {
          const user = rowToUserRecord(row);
          this.fallbackUsers.set(user.email.toLowerCase(), user);
        }
        if (result.rows.length > 0) {
          console.log(`[UserStore] Connected to Supabase — loaded ${result.rows.length} users ✓`);
        }

        await this.alignDatabaseUserSequence();

        return;
      } catch (err: any) {
        console.warn(`[UserStore] Database query failed (${err.message}), falling back to file store.`);
      }
    }
  }

  private async alignDatabaseUserSequence(): Promise<void> {
    if (process.env.NODE_ENV === 'test') return;

    try {
      // Imports and seed scripts can insert explicit IDs without advancing the
      // serial sequence. Align it before accepting a registration so the next
      // INSERT receives an unused primary key.
      await query(`
        SELECT setval(
          'iam.users_userid_seq',
          COALESCE(MAX(userid), 1),
          MAX(userid) IS NOT NULL
        )
        FROM iam.users
      `);
    } catch (err: any) {
      // Report an environment/schema mismatch without preventing the current
      // user list from loading.
      console.warn(`[UserStore] User ID sequence alignment skipped: ${err.message}`);
    }
  }

  private async getOrCreateDepartmentId(name: string): Promise<number | null> {
    if (!this.dbAvailable) return null;
    const normalized = name.trim();
    if (!normalized) return null;

    const existing = await query<DbDepartmentRow>(
      `SELECT departmentid FROM org.departments
       WHERE organizationid = 1 AND lower(departmentname) = lower($1)
       LIMIT 1`,
      [normalized]
    );
    if (existing.rows[0]) return existing.rows[0].departmentid;

    const baseCode = toDepartmentCode(normalized);
    for (let attempt = 0; attempt < 25; attempt += 1) {
      const code = attempt === 0 ? baseCode : `${baseCode.slice(0, 20)}_${attempt}`;
      try {
        const inserted = await query<DbDepartmentRow>(
          `INSERT INTO org.departments (organizationid, departmentcode, departmentname)
           VALUES (1, $1, $2)
           RETURNING departmentid`,
          [code, normalized]
        );
        return inserted.rows[0]?.departmentid ?? null;
      } catch (error: any) {
        if (!String(error?.message || '').includes('duplicate')) throw error;
      }
    }

    const retry = await query<DbDepartmentRow>(
      `SELECT departmentid FROM org.departments
       WHERE organizationid = 1 AND lower(departmentname) = lower($1)
       LIMIT 1`,
      [normalized]
    );
    return retry.rows[0]?.departmentid ?? null;
  }

  private async getRoleDetails(role: UserRole): Promise<DbRoleRow> {
    const roleCode = ROLE_TO_DB[role];
    const roleResult = await query<DbRoleRow>(
      'SELECT roleid, istemporary FROM iam.roles WHERE rolecode = $1',
      [roleCode]
    );
    const found = roleResult.rows[0];
    if (!found) {
      throw new Error(`Database role ${roleCode} is not configured.`);
    }
    return found;
  }

  private initFileStore(): void {
    const dataRoot = process.env.VERCEL === '1'
      ? '/tmp/database'
      : path.resolve(process.cwd(), 'database');
    const filePath = path.resolve(dataRoot, 'users_db.json');

    try {
      if (!fs.existsSync(filePath)) {
        console.warn('[UserStore] Legacy file authentication enabled, but no user file exists.');
        return;
      }

      const parsedUsers: UserRecord[] = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      for (const user of parsedUsers) {
        this.fallbackUsers.set(user.email.toLowerCase(), user);
      }
      console.warn(`[UserStore] Legacy file authentication enabled for ${this.fallbackUsers.size} users.`);
    } catch (err: any) {
      this.fallbackUsers.clear();
      console.error(`[UserStore] Legacy user file could not be loaded: ${err.message}`);
    }
  }

  private persistFile(filePath: string): void {
    if (!this.isLegacyFileAuthEnabled()) return;

    try {
      fs.writeFileSync(filePath, JSON.stringify(Array.from(this.fallbackUsers.values()), null, 2), 'utf-8');
    } catch (err: any) {
      console.error(`[UserStore] Persist error: ${err.message}`);
    }
  }

  private getFileStorePath(): string {
    const DATA_ROOT = process.env.VERCEL === '1'
      ? '/tmp/database'
      : path.resolve(process.cwd(), 'database');
    return path.resolve(DATA_ROOT, 'users_db.json');
  }

  public async syncUsersToDb(): Promise<void> {
    if (!isDatabaseConfigured()) return;
    await this.ensureInit();
  }

  public findByEmail(email: string): UserRecord | undefined {
    return this.fallbackUsers.get(email.toLowerCase());
  }

  public async findByEmailAsync(email: string): Promise<UserRecord | undefined> {
    await this.ensureInit();
    if (!this.dbAvailable) return this.fallbackUsers.get(email.toLowerCase());

    try {
      const result = await query<DbUserRow>(
        USER_QUERY + ' WHERE u.email = $1 AND u.organizationid = 1',
        [email.toLowerCase()]
      );
      if (result.rows[0]) {
        const dbUser = rowToUserRecord(result.rows[0]);
        // Database identity, credentials, and roles are authoritative. Never fill missing
        // credentials or elevated roles from the legacy local file.
        this.fallbackUsers.set(dbUser.email.toLowerCase(), dbUser);
        return dbUser;
      }
    } catch (err: any) {
      console.warn(`[UserStore] DB findByEmail failed: ${err.message}`);
      return undefined;
    }
    return undefined;
  }

  public findByName(name: string): UserRecord | undefined {
    const normalised = name.trim().toLowerCase();
    return Array.from(this.fallbackUsers.values()).find(
      (u) => u.name.trim().toLowerCase() === normalised
    );
  }

  public findById(id: string): UserRecord | undefined {
    return Array.from(this.fallbackUsers.values()).find((user) => user.id === id);
  }

  // Unlike every other accessor in this class, this one is safe to call before login/
  // registration has warmed the cache on this process (e.g. the very first request a fresh
  // serverless instance handles) -- so it must hydrate itself rather than silently returning
  // whatever happens to already be in `fallbackUsers` (which, on a cold instance, is nothing).
  public async getAllUsers(): Promise<UserRecord[]> {
    await this.ensureInit();
    return Array.from(this.fallbackUsers.values());
  }

  public hasRole(role: UserRole): boolean {
    return Array.from(this.fallbackUsers.values()).some((user) => user.role === role);
  }

  public async createUser(userData: {
    name: string;
    email: string;
    password: string;
    role: UserRole;
    department: string;
    title?: string;
  }): Promise<UserRecord> {
    await this.ensureInit();

    const existing = await this.findByEmailAsync(userData.email);
    if (existing) {
      throw new Error(
        existing.status === 'inactive'
          ? 'An account with this email already exists and is currently deactivated. Reactivate the existing account instead of creating a new one.'
          : 'An account with this email already exists.'
      );
    }

    if (userData.role === 'Admin' && this.hasRole('Admin')) {
      throw new Error('An Administrator account already exists. Only one Admin is permitted.');
    }
    if (userData.role === 'HR' && this.hasRole('HR')) {
      throw new Error('An HR Specialist account already exists. Only one HR is permitted.');
    }

    const passwordHash = bcrypt.hashSync(userData.password, 10);

    if (this.dbAvailable) {
      try {
        const orgId = 1;
        const [givenName, ...familyParts] = userData.name.trim().split(/\s+/);
        const familyName = familyParts.join(' ') || givenName;

        const role = await this.getRoleDetails(userData.role);
        const systemActorUserId = await getSystemActorUserId();
        const departmentId = await this.getOrCreateDepartmentId(userData.department);

        // Users + credentials + role grant are inserted atomically so a failure cannot leave
        // an orphaned user row that permanently occupies the email without a usable account.
        const userId = await withTransaction(async (runQuery) => {
          const insertUser = await runQuery<{ userid: number }>(
            `INSERT INTO iam.users (organizationid, departmentid, email, givenname, familyname, displayname, designation, accountstatus)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'Active')
             RETURNING userid`,
            [orgId, departmentId, userData.email.toLowerCase(), givenName, familyName, userData.name, userData.title || null]
          );
          const newUserId = insertUser.rows[0].userid;

          await runQuery(
            `INSERT INTO iam.usercredentials (userid, passwordhash, passwordalgorithm)
             VALUES ($1, $2, 'bcryptjs')`,
            [newUserId, Buffer.from(passwordHash, 'utf-8')]
          );

          // TeamLead/HRRepresentative are marked temporary in the schema, whose trigger
          // requires EndsAtUtc. A far-future expiry preserves the existing signup behavior.
          const endsAtUtc = role.istemporary
            ? new Date(Date.now() + 10 * 365 * 24 * 60 * 60 * 1000)
            : null;
          await runQuery(
            `INSERT INTO iam.userroles (userid, roleid, grantedbyuserid, endsatutc)
             VALUES ($1, $2, $3, $4)`,
            [newUserId, role.roleid, systemActorUserId, endsAtUtc]
          );

          return newUserId;
        });

        const newUser: UserRecord = {
          id: fromUserPk(userId),
          name: userData.name,
          email: userData.email.toLowerCase(),
          passwordHash,
          role: userData.role,
          department: userData.department,
          avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
          title: userData.title || `${userData.role.replace('_', ' ')} Specialist`,
          status: 'active',
          createdAt: new Date().toISOString()
        };

        this.fallbackUsers.set(newUser.email, newUser);
        console.log(`[UserStore] Created user in Supabase: ${newUser.name} (id=${userId}) ✓`);
        return newUser;
      } catch (err: any) {
        console.error(`[UserStore] DB createUser failed: ${err.message}`);
        throw new Error('Database user creation failed.');
      }
    }

    if (isDatabaseConfigured()) {
      throw new Error('The configured database is currently unavailable. Please try again.');
    }

    if (!this.isLegacyFileAuthEnabled()) {
      throw new Error('User registration is unavailable because database persistence is not configured.');
    }

    const maxUserId = Array.from(this.fallbackUsers.values())
      .map(u => parseInt(u.id.replace('usr-', ''), 10))
      .filter(n => !isNaN(n) && n < 1000000000000)
      .reduce((max, n) => Math.max(max, n), 0);
    const nextId = maxUserId + 1;

    const newUser: UserRecord = {
      id: `usr-${nextId}`,
      name: userData.name,
      email: userData.email.toLowerCase(),
      passwordHash,
      role: userData.role,
      department: userData.department,
      avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
      title: userData.title || `${userData.role.replace('_', ' ')} Specialist`,
      status: 'active',
      createdAt: new Date().toISOString()
    };

    this.fallbackUsers.set(newUser.email, newUser);
    this.persistFile(this.getFileStorePath());
    console.log(`[UserStore] Created user in file store: ${newUser.name} ✓`);
    return newUser;
  }

  public async updateManagedUser(
    userId: string,
    updates: Partial<Pick<UserRecord, 'name' | 'email' | 'role' | 'department' | 'title'>>,
    actorId: string
  ): Promise<Omit<UserRecord, 'passwordHash'>> {
    await this.ensureInit();
    const user = this.findById(userId);
    if (!user) throw new Error('User not found.');

    const nextRole = updates.role || user.role;
    const nextEmail = (updates.email || user.email).trim().toLowerCase();
    const nextName = (updates.name || user.name).trim();
    const nextDepartment = (updates.department || user.department).trim() || user.department;
    const nextTitle = (updates.title || user.title).trim() || user.title;

    if (!nextName) throw new Error('Name is required.');
    if (!nextEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nextEmail)) throw new Error('A valid email is required.');
    if (!nextDepartment) throw new Error('Department is required.');

    const duplicate = Array.from(this.fallbackUsers.values()).find(
      (existing) => existing.id !== userId && existing.email.toLowerCase() === nextEmail
    );
    if (duplicate) throw new Error('A user with this email already exists.');

    const activeAdminsCount = Array.from(this.fallbackUsers.values()).filter((entry) => entry.role === 'Admin' && entry.status === 'active').length;
    if (user.role === 'Admin' && nextRole !== 'Admin' && user.status === 'active' && activeAdminsCount <= 1) {
      throw new Error('Cannot change the role of the sole active Admin account.');
    }

    if (nextRole === 'Admin' && user.role !== 'Admin' && this.hasRole('Admin')) {
      throw new Error('An Administrator account already exists. Only one Admin is permitted.');
    }
    if (nextRole === 'HR' && user.role !== 'HR' && this.hasRole('HR')) {
      throw new Error('An HR Specialist account already exists. Only one HR is permitted.');
    }

    if (this.dbAvailable) {
      try {
        const uid = toUserPk(userId);
        const [givenName, ...familyParts] = nextName.split(/\s+/);
        const familyName = familyParts.join(' ') || givenName;
        const departmentId = await this.getOrCreateDepartmentId(nextDepartment);

        await query(
          `UPDATE iam.users
           SET departmentid = $1,
               email = $2,
               givenname = $3,
               familyname = $4,
               displayname = $5,
               designation = $6,
               updatedatutc = CURRENT_TIMESTAMP
           WHERE userid = $7`,
          [departmentId, nextEmail, givenName, familyName, nextName, nextTitle, uid]
        );

        if (nextRole !== user.role) {
          const actorPk = toUserPk(actorId);
          await query(
            `UPDATE iam.userroles
             SET revokedatutc = CURRENT_TIMESTAMP,
                 revokedbyuserid = $2,
                 revocationreason = 'Role updated from members module'
             WHERE userid = $1 AND revokedatutc IS NULL`,
            [uid, actorPk]
          );

          const role = await this.getRoleDetails(nextRole);
          const systemActorUserId = await getSystemActorUserId();
          const endsAtUtc = role.istemporary
            ? new Date(Date.now() + 10 * 365 * 24 * 60 * 60 * 1000)
            : null;

          await query(
            `INSERT INTO iam.userroles (userid, roleid, grantedbyuserid, endsatutc)
             VALUES ($1, $2, $3, $4)`,
            [uid, role.roleid, systemActorUserId, endsAtUtc]
          );
        }
      } catch (err: any) {
        console.warn(`[UserStore] DB updateManagedUser failed: ${err.message}`);
        throw new Error('Database user update failed.');
      }
    }

    const oldEmail = user.email.toLowerCase();
    this.fallbackUsers.delete(oldEmail);
    user.name = nextName;
    user.email = nextEmail;
    user.role = nextRole;
    user.department = nextDepartment;
    user.title = nextTitle;
    this.fallbackUsers.set(user.email.toLowerCase(), user);
    this.persistFile(this.getFileStorePath());
    return this.sanitizeUser(user);
  }

  public async deactivateManagedUser(userId: string): Promise<Omit<UserRecord, 'passwordHash'>> {
    await this.ensureInit();
    const user = this.findById(userId);
    if (!user) throw new Error('User not found.');
    if (user.status === 'inactive') return this.sanitizeUser(user);

    const activeAdminsCount = Array.from(this.fallbackUsers.values()).filter((entry) => entry.role === 'Admin' && entry.status === 'active').length;
    if (user.role === 'Admin' && activeAdminsCount <= 1) {
      throw new Error('Cannot deactivate the sole active Admin account.');
    }

    if (this.dbAvailable) {
      try {
        await query(
          `UPDATE iam.users
           SET accountstatus = 'Deactivated',
               deactivatedatutc = CURRENT_TIMESTAMP,
               updatedatutc = CURRENT_TIMESTAMP
           WHERE userid = $1`,
          [toUserPk(userId)]
        );
      } catch (err: any) {
        console.warn(`[UserStore] DB deactivateManagedUser failed: ${err.message}`);
        throw new Error('Database user deactivation failed.');
      }
    }

    user.status = 'inactive';
    this.persistFile(this.getFileStorePath());
    return this.sanitizeUser(user);
  }

  public async reactivateManagedUser(userId: string): Promise<Omit<UserRecord, 'passwordHash'>> {
    await this.ensureInit();
    const user = this.findById(userId);
    if (!user) throw new Error('User not found.');
    if (user.status === 'active') return this.sanitizeUser(user);

    if (user.role === 'Admin') {
      const otherActiveAdmin = Array.from(this.fallbackUsers.values()).some(
        (entry) => entry.id !== userId && entry.role === 'Admin' && entry.status === 'active'
      );
      if (otherActiveAdmin) {
        throw new Error('An active Administrator account already exists. Only one Admin is permitted.');
      }
    }
    if (user.role === 'HR') {
      const otherActiveHr = Array.from(this.fallbackUsers.values()).some(
        (entry) => entry.id !== userId && entry.role === 'HR' && entry.status === 'active'
      );
      if (otherActiveHr) {
        throw new Error('An active HR account already exists. Only one HR is permitted.');
      }
    }

    if (this.dbAvailable) {
      try {
        await query(
          `UPDATE iam.users
           SET accountstatus = 'Active',
               deactivatedatutc = NULL,
               updatedatutc = CURRENT_TIMESTAMP
           WHERE userid = $1`,
          [toUserPk(userId)]
        );
      } catch (err: any) {
        console.warn(`[UserStore] DB reactivateManagedUser failed: ${err.message}`);
        throw new Error('Database user reactivation failed.');
      }
    }

    user.status = 'active';
    this.persistFile(this.getFileStorePath());
    return this.sanitizeUser(user);
  }

  public async deleteManagedUser(userId: string): Promise<void> {
    await this.ensureInit();
    const user = this.findById(userId);
    if (!user) throw new Error('User not found.');
    if (user.status !== 'inactive') throw new Error('Only deactivated accounts can be deleted.');

    if (this.dbAvailable) {
      try {
        const uid = toUserPk(userId);
        await withTransaction(async (runQuery) => {
          await runQuery('DELETE FROM iam.userroles WHERE userid = $1', [uid]);
          await runQuery('DELETE FROM iam.usercredentials WHERE userid = $1', [uid]);
          await runQuery('DELETE FROM iam.userprofiles WHERE userid = $1', [uid]);
          await runQuery('DELETE FROM notify.notificationpreferences WHERE userid = $1', [uid]);
          await runQuery('DELETE FROM config.usersettings WHERE userid = $1', [uid]);
          await runQuery('DELETE FROM iam.users WHERE userid = $1', [uid]);
        });
      } catch (err: any) {
        console.warn(`[UserStore] DB deleteManagedUser failed: ${err.message}`);
        throw new Error('This deactivated account still has related workspace records and cannot be deleted permanently.');
      }
    }

    this.fallbackUsers.delete(user.email.toLowerCase());
    this.persistFile(this.getFileStorePath());
  }

  public sanitizeUser(user: UserRecord): Omit<UserRecord, 'passwordHash'> {
    const { passwordHash, ...sanitized } = user;
    return sanitized;
  }

  public async updatePassword(email: string, newPasswordHash: string): Promise<void> {
    await this.ensureInit();
    const user = await this.findByEmailAsync(email);
    if (!user) throw new Error('User not found.');

    if (this.dbAvailable) {
      try {
        const uid = toUserPk(user.id);
        await query(
          `INSERT INTO iam.usercredentials (userid, passwordhash, passwordalgorithm, passwordchangedatutc)
           VALUES ($1, $2, 'bcryptjs', CURRENT_TIMESTAMP)
           ON CONFLICT (userid) DO UPDATE
           SET passwordhash = EXCLUDED.passwordhash,
               passwordalgorithm = EXCLUDED.passwordalgorithm,
               passwordchangedatutc = CURRENT_TIMESTAMP`,
          [uid, Buffer.from(newPasswordHash, 'utf-8')]
        );
      } catch (err: any) {
        console.warn(`[UserStore] DB updatePassword failed: ${err.message}`);
        throw new Error('Database password update failed.');
      }
    } else if (!this.isLegacyFileAuthEnabled()) {
      throw new Error('Password updates require database persistence.');
    }

    user.passwordHash = newPasswordHash;
    this.fallbackUsers.set(user.email.toLowerCase(), user);
    this.persistFile(this.getFileStorePath());
    console.log(`[UserStore] Password updated for ${email} ✓`);
  }

  public async updateDisplayName(userId: string, name: string): Promise<Omit<UserRecord, 'passwordHash'>> {
    await this.ensureInit();
    const user = this.findById(userId);
    if (!user) throw new Error('User not found.');

    if (this.dbAvailable) {
      try {
        const uid = toUserPk(userId);
        const [givenName, ...familyParts] = name.trim().split(/\s+/);
        const familyName = familyParts.join(' ') || givenName;
        await query(
          `UPDATE iam.users SET displayname = $1, givenname = $2, familyname = $3, updatedatutc = CURRENT_TIMESTAMP
           WHERE userid = $4`,
          [name, givenName, familyName, uid]
        );
      } catch (err: any) {
        console.warn(`[UserStore] DB updateDisplayName failed: ${err.message}`);
      }
    }

    user.name = name;
    this.persistFile(this.getFileStorePath());
    return this.sanitizeUser(user);
  }

  public async updateAvatar(userId: string, avatarUrl: string): Promise<Omit<UserRecord, 'passwordHash'>> {
    await this.ensureInit();
    const user = this.findById(userId);
    if (!user) throw new Error('User not found.');

    if (this.dbAvailable) {
      try {
        const uid = toUserPk(userId);
        await query(
          `UPDATE iam.userprofiles SET updatedatutc = CURRENT_TIMESTAMP WHERE userid = $1`,
          [uid]
        );
        await query(
          `INSERT INTO iam.userprofiles (userid, updatedatutc)
           VALUES ($1, CURRENT_TIMESTAMP)
           ON CONFLICT (userid) DO NOTHING`,
          [uid]
        );
      } catch (err: any) {
        console.warn(`[UserStore] DB updateAvatar failed: ${err.message}`);
      }
    }

    user.avatar = avatarUrl;
    this.persistFile(this.getFileStorePath());
    return this.sanitizeUser(user);
  }
}

export const userStore = new UserStore();
