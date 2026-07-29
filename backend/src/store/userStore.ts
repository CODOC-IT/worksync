import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';
import { UserRecord, UserRole } from '../types.js';
import { isDatabaseConfigured, query } from '../db/pool.js';
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

const DEFAULT_TEMPORARY_ROLE_ASSIGNMENT_DAYS = 30;
const TEMPORARY_ROLES: UserRole[] = ['Team_Lead', 'HR'];

const USER_QUERY = `
  SELECT u.userid, u.email, u.displayname, u.designation,
         u.accountstatus, u.createdatutc,
         r.rolecode, d.departmentname,
         uc.passwordhash, uc.passwordalgorithm
  FROM iam.users u
  LEFT JOIN iam.userroles ur ON ur.userid = u.userid
    AND ur.revokedatutc IS NULL
    AND (ur.endsatutc IS NULL OR ur.endsatutc > CURRENT_TIMESTAMP)
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
          USER_QUERY + ' WHERE u.deactivatedatutc IS NULL AND u.organizationid = 1 ORDER BY u.userid'
        );
        this.dbAvailable = true;
        this.fallbackUsers.clear();
        for (const row of result.rows) {
          const user = rowToUserRecord(row);
          this.fallbackUsers.set(user.email.toLowerCase(), user);
        }
        if (result.rows.length > 0) {
          console.log(`[UserStore] Connected to Supabase — loaded ${result.rows.length} users ✓`);
        }

        return;
      } catch (err: any) {
        console.warn(`[UserStore] Database query failed (${err.message}), falling back to file store.`);
      }
    }
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

        const insertUser = await query<{ userid: number }>(
          `INSERT INTO iam.users (organizationid, email, givenname, familyname, displayname, designation, accountstatus)
           VALUES ($1, $2, $3, $4, $5, $6, 'Active')
           RETURNING userid`,
          [orgId, userData.email.toLowerCase(), givenName, familyName, userData.name, userData.title || null]
        );
        const userId = insertUser.rows[0].userid;

        await query(
          `INSERT INTO iam.usercredentials (userid, passwordhash, passwordalgorithm)
           VALUES ($1, $2, 'bcryptjs')`,
          [userId, Buffer.from(passwordHash, 'utf-8')]
        );

        const roleCode = ROLE_TO_DB[userData.role];
        const roleResult = await query<{ roleid: number }>(
          'SELECT roleid FROM iam.roles WHERE rolecode = $1',
          [roleCode]
        );
        if (!roleResult.rows[0]) {
          throw new Error(`Database role ${roleCode} is not configured.`);
        }
        const isTemporaryRole = TEMPORARY_ROLES.includes(userData.role);
        const temporaryRoleExpiresAt = isTemporaryRole
          ? new Date(Date.now() + DEFAULT_TEMPORARY_ROLE_ASSIGNMENT_DAYS * 24 * 60 * 60 * 1000)
          : null;

        await query(
          `INSERT INTO iam.userroles (userid, roleid, grantedbyuserid, endsatutc)
           VALUES ($1, $2, 1, $3)`,
          [userId, roleResult.rows[0].roleid, temporaryRoleExpiresAt]
        );

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
        console.warn(`[UserStore] DB createUser failed: ${err.message}.`);
        throw new Error('Database user creation failed.');
      }
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
