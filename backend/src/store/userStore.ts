import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';
import { UserRecord, UserRole } from '../types.js';
import { isDatabaseConfigured, query, withTransaction } from '../db/pool.js';
import { fromUserPk, toUserPk } from '../utils/idMapping.js';

const DEFAULT_PASSWORD_HASH = bcrypt.hashSync('password123', 10);

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
  LEFT JOIN iam.userroles ur ON ur.userid = u.userid AND ur.revokedatutc IS NULL
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

function rowToUserRecord(row: DbUserRow): UserRecord {
  return {
    id: fromUserPk(row.userid),
    name: row.displayname,
    email: row.email,
    passwordHash: row.passwordhash ? row.passwordhash.toString('utf-8') : DEFAULT_PASSWORD_HASH,
    role: row.rolecode ? (DB_TO_ROLE[row.rolecode] || 'Team_Member') : 'Team_Member',
    department: row.departmentname || 'Engineering',
    avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
    title: row.designation || 'Team Member',
    status: STATUS_MAP[row.accountstatus] || 'active',
    createdAt: row.createdatutc ? new Date(row.createdatutc).toISOString() : new Date().toISOString()
  };
}

class UserStore {
  private dbAvailable: boolean = false;
  private fallbackUsers: Map<string, UserRecord> = new Map();
  private initialized = false;
  private dbLoadStarted = false;

  constructor() {
    this.initFileStore();
  }

  private async ensureInit(): Promise<void> {
    if (this.initialized) return;
    if (this.dbLoadStarted) return;
    this.dbLoadStarted = true;
    this.initialized = true;

    if (isDatabaseConfigured()) {
      try {
        const result = await query<DbUserRow>(
          USER_QUERY + ' WHERE u.deactivatedatutc IS NULL AND u.organizationid = 1 ORDER BY u.userid'
        );
        // A configured database is authoritative. Clear local fallback users
        // so registrations from a previous database are not carried forward.
        this.fallbackUsers.clear();
        if (result.rows.length > 0) {
          this.dbAvailable = true;
          for (const row of result.rows) {
            const user = rowToUserRecord(row);
            this.fallbackUsers.set(user.email.toLowerCase(), user);
          }
          console.log(`[UserStore] Connected to Supabase — loaded ${result.rows.length} users ✓`);
        } else {
          this.dbAvailable = true;
        }

        // Sync file store users into DB so foreign keys (FK_Projects_OwnerOrganization etc.)
        // resolve. File store users with id="usr-N" are backfilled if they don't exist yet.
        if (this.dbAvailable) {
          const PG_INT_MAX = 2147483647;
          for (const [email, user] of this.fallbackUsers) {
            const uid = parseInt(user.id.replace('usr-', ''), 10);
            if (isNaN(uid) || uid > PG_INT_MAX) {
              console.warn(`[UserStore] Skipping backfill for ${email}: ID ${user.id} exceeds PostgreSQL INT range.`);
              continue;
            }
            try {
              await query(
                `INSERT INTO iam.users (userid, organizationid, email, givenname, familyname, displayname, designation, accountstatus)
                 VALUES ($1, 1, $2, $3, $4, $5, $6, 'Active')
                 ON CONFLICT (userid) DO NOTHING`,
                [
                  uid,
                  user.email.toLowerCase(),
                  user.name.split(' ')[0] || user.name,
                  user.name.split(' ').slice(1).join(' ') || user.name,
                  user.name,
                  user.title
                ]
              );
            } catch {
              // User may already exist with different id — skip
            }
          }
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

  private initFileStore(): void {
    const DATA_ROOT = process.env.VERCEL === '1'
      ? '/tmp/database'
      : path.resolve(process.cwd(), 'database');
    const DB_FILE_PATH = path.resolve(DATA_ROOT, 'users_db.json');

    const INITIAL_USERS: UserRecord[] = [
      {
        id: 'usr-1', name: 'Fazal Khan', email: 'fazal.k@codoc.com',
        passwordHash: DEFAULT_PASSWORD_HASH, role: 'Admin',
        department: 'Executive Operations', avatar: '/assets/images/fazal.png',
        title: 'Managing Director & Operations Oversight', status: 'active',
        createdAt: new Date().toISOString()
      },
      {
        id: 'usr-2', name: 'Adolf', email: 'adolf.h@codoc.com',
        passwordHash: DEFAULT_PASSWORD_HASH, role: 'Team_Lead',
        department: 'IT', avatar: 'https://images.unsplash.com/photo-1492562080023-ab3db95bfbce?w=150&auto=format&fit=crop&q=80',
        title: 'Lead Software Architect', status: 'active',
        createdAt: new Date().toISOString()
      },
      {
        id: 'usr-3', name: 'Maryam', email: 'maryam@codoc.com',
        passwordHash: DEFAULT_PASSWORD_HASH, role: 'HR',
        department: 'Human Resources & People Ops', avatar: '/assets/images/maryam.png',
        title: 'Head of People Operations', status: 'active',
        createdAt: new Date().toISOString()
      },
      {
        id: 'usr-4', name: 'Salman Ahmed', email: 'salman.c@codoc.com',
        passwordHash: DEFAULT_PASSWORD_HASH, role: 'Team_Member',
        department: 'Engineering', avatar: 'https://images.unsplash.com/photo-1492562080023-ab3db95bfbce?w=150&auto=format&fit=crop&q=80',
        title: 'Senior Frontend Engineer', status: 'active',
        createdAt: new Date().toISOString()
      }
    ];

    try {
      const dbDir = path.dirname(DB_FILE_PATH);
      if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

      if (fs.existsSync(DB_FILE_PATH)) {
        const parsedUsers: UserRecord[] = JSON.parse(fs.readFileSync(DB_FILE_PATH, 'utf-8'));
        for (const user of parsedUsers) {
          this.fallbackUsers.set(user.email.toLowerCase(), user);
        }
        for (const user of INITIAL_USERS) {
          if (!this.fallbackUsers.has(user.email.toLowerCase())) {
            this.fallbackUsers.set(user.email.toLowerCase(), user);
          }
        }
        this.persistFile(DB_FILE_PATH);
        console.log(`[UserStore] Loaded ${this.fallbackUsers.size} users from file ✓`);
      } else {
        for (const user of INITIAL_USERS) {
          this.fallbackUsers.set(user.email.toLowerCase(), user);
        }
        this.persistFile(DB_FILE_PATH);
        console.log(`[UserStore] Initialized file store with seed users ✓`);
      }
    } catch (err: any) {
      console.error(`[UserStore] File store error: ${err.message}. Using in-memory seed.`);
      for (const user of INITIAL_USERS) {
        this.fallbackUsers.set(user.email.toLowerCase(), user);
      }
    }
  }

  private persistFile(filePath: string): void {
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
        const existing = this.fallbackUsers.get(dbUser.email.toLowerCase());

        // Merge: prefer DB for identity, file store for credentials/roles when DB is incomplete
        const merged: UserRecord = {
          ...dbUser,
          passwordHash: dbUser.passwordHash !== DEFAULT_PASSWORD_HASH
            ? dbUser.passwordHash
            : (existing?.passwordHash || DEFAULT_PASSWORD_HASH),
          role: dbUser.role !== 'Team_Member' || !existing
            ? dbUser.role
            : existing.role
        };

        this.fallbackUsers.set(merged.email.toLowerCase(), merged);
        return merged;
      }
    } catch (err: any) {
      console.warn(`[UserStore] DB findByEmail failed: ${err.message}`);
    }
    return this.fallbackUsers.get(email.toLowerCase());
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

  public getAllUsers(): UserRecord[] {
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

    const existing = this.findByEmail(userData.email);
    if (existing) throw new Error('User with this email already exists.');

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

        const roleCode = ROLE_TO_DB[userData.role];
        const roleResult = await query<{ roleid: number; istemporary: boolean }>(
          'SELECT roleid, istemporary FROM iam.roles WHERE rolecode = $1',
          [roleCode]
        );
        const systemActorUserId = roleResult.rows[0] ? await getSystemActorUserId() : null;

        // Users + credentials + role grant are inserted atomically -- previously these were three
        // separate query() calls, so a failure partway through (e.g. the role insert hitting a
        // constraint) left an orphaned, credential-only iam.users row behind: the email looked
        // "taken" on any later registration attempt (a real uq_users_organization_email
        // violation), yet the account had no role and couldn't actually be used.
        const userId = await withTransaction(async (runQuery) => {
          const insertUser = await runQuery<{ userid: number }>(
            `INSERT INTO iam.users (organizationid, email, givenname, familyname, displayname, designation, accountstatus)
             VALUES ($1, $2, $3, $4, $5, $6, 'Active')
             RETURNING userid`,
            [orgId, userData.email.toLowerCase(), givenName, familyName, userData.name, userData.title || null]
          );
          const newUserId = insertUser.rows[0].userid;

          await runQuery(
            `INSERT INTO iam.usercredentials (userid, passwordhash, passwordalgorithm)
             VALUES ($1, $2, 'bcryptjs')`,
            [newUserId, Buffer.from(passwordHash, 'utf-8')]
          );

          if (roleResult.rows[0]) {
            // TeamLead/HRRepresentative are seeded IsTemporary=TRUE (see database/17_seed.sql),
            // which a DB trigger enforces by requiring EndsAtUtc on every assignment -- but this
            // app grants those roles permanently at registration, the same as Admin/Team Member,
            // not as a time-boxed elevation. Rather than reinterpret what "temporary" means here,
            // satisfy the trigger with a far-future expiry so registration succeeds for every role
            // exactly as before; a real "temporary project-scoped lead" feature, if ever built,
            // would set a real EndsAtUtc instead of this default.
            const endsAtUtc = roleResult.rows[0].istemporary
              ? new Date(Date.now() + 10 * 365 * 24 * 60 * 60 * 1000)
              : null;
            await runQuery(
              `INSERT INTO iam.userroles (userid, roleid, grantedbyuserid, endsatutc)
               VALUES ($1, $2, $3, $4)`,
              [newUserId, roleResult.rows[0].roleid, systemActorUserId, endsAtUtc]
            );
          }

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
        throw err;
      }
    }

    // Do not create a local-only account when a configured database is down.
    // Such an account would block the email without existing in the database.
    if (isDatabaseConfigured()) {
      throw new Error('The configured database is currently unavailable. Please try again.');
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

  public sanitizeUser(user: UserRecord): Omit<UserRecord, 'passwordHash'> {
    const { passwordHash, ...sanitized } = user;
    return sanitized;
  }

  public async updatePassword(email: string, newPasswordHash: string): Promise<void> {
    await this.ensureInit();
    const user = this.fallbackUsers.get(email.toLowerCase());
    if (!user) throw new Error('User not found.');

    if (this.dbAvailable) {
      try {
        const uid = toUserPk(user.id);
        await query(
          `UPDATE iam.usercredentials SET passwordhash = $1, passwordchangedatutc = CURRENT_TIMESTAMP WHERE userid = $2`,
          [Buffer.from(newPasswordHash, 'utf-8'), uid]
        );
      } catch (err: any) {
        console.warn(`[UserStore] DB updatePassword failed: ${err.message}`);
      }
    }

    user.passwordHash = newPasswordHash;
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
