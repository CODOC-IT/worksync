import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';
import { UserRecord, UserRole } from '../types.js';

// Pre-hashed default password for initial seed users: "password123"
const DEFAULT_PASSWORD_HASH = bcrypt.hashSync('password123', 10);

const DB_FILE_PATH = path.resolve(process.cwd(), 'database', 'users_db.json');

const INITIAL_USERS: UserRecord[] = [
  {
    id: 'usr-1',
    name: 'Fazal Khan',
    email: 'fazal.k@codoc.com',
    passwordHash: DEFAULT_PASSWORD_HASH,
    role: 'Admin',
    department: 'Executive Operations',
    avatar: '/assets/images/fazal.png',
    title: 'Managing Director & Operations Oversight',
    status: 'active',
    createdAt: new Date().toISOString()
  },
  {
    id: 'usr-2',
    name: 'Adolf',
    email: 'adolf.h@codoc.com',
    passwordHash: DEFAULT_PASSWORD_HASH,
    role: 'Team_Lead',
    department: 'IT',
    avatar: 'https://images.unsplash.com/photo-1492562080023-ab3db95bfbce?w=150&auto=format&fit=crop&q=80',
    title: 'Lead Software Architect',
    status: 'active',
    createdAt: new Date().toISOString()
  },
  {
    id: 'usr-3',
    name: 'Maryam',
    email: 'maryam@codoc.com',
    passwordHash: DEFAULT_PASSWORD_HASH,
    role: 'HR',
    department: 'Human Resources & People Ops',
    avatar: '/assets/images/maryam.png',
    title: 'Head of People Operations',
    status: 'active',
    createdAt: new Date().toISOString()
  },
  {
    id: 'usr-4',
    name: 'Salman Ahmed',
    email: 'salman.c@codoc.com',
    passwordHash: DEFAULT_PASSWORD_HASH,
    role: 'Team_Member',
    department: 'Engineering',
    avatar: 'https://images.unsplash.com/photo-1492562080023-ab3db95bfbce?w=150&auto=format&fit=crop&q=80',
    title: 'Senior Frontend Engineer',
    status: 'active',
    createdAt: new Date().toISOString()
  }
];

class UserStore {
  private users: Map<string, UserRecord> = new Map();

  constructor() {
    this.initDatabase();
  }

  private initDatabase(): void {
    try {
      // Ensure database directory exists
      const dbDir = path.dirname(DB_FILE_PATH);
      if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
      }

      if (fs.existsSync(DB_FILE_PATH)) {
        const fileData = fs.readFileSync(DB_FILE_PATH, 'utf-8');
        const parsedUsers: UserRecord[] = JSON.parse(fileData);
        
        parsedUsers.forEach((user) => {
          this.users.set(user.email.toLowerCase(), user);
        });

        // Ensure default seed users exist if missing
        INITIAL_USERS.forEach((user) => {
          if (!this.users.has(user.email.toLowerCase())) {
            this.users.set(user.email.toLowerCase(), user);
          }
        });

        this.persistToDisk();
        console.log(`[Database] Loaded ${this.users.size} user records from ${DB_FILE_PATH} ✓`);
      } else {
        // Seed initial users into database file
        INITIAL_USERS.forEach((user) => {
          this.users.set(user.email.toLowerCase(), user);
        });
        this.persistToDisk();
        console.log(`[Database] Initialized new user database at ${DB_FILE_PATH} with seed records ✓`);
      }
    } catch (err: any) {
      console.error(`[Database Error] Failed to load database file: ${err.message}. Falling back to initial seed.`);
      INITIAL_USERS.forEach((user) => {
        this.users.set(user.email.toLowerCase(), user);
      });
    }
  }

  private persistToDisk(): void {
    try {
      const userList = Array.from(this.users.values());
      fs.writeFileSync(DB_FILE_PATH, JSON.stringify(userList, null, 2), 'utf-8');
    } catch (err: any) {
      console.error(`[Database Error] Failed to persist users to disk: ${err.message}`);
    }
  }

  public findByEmail(email: string): UserRecord | undefined {
    return this.users.get(email.toLowerCase());
  }

  public findByName(name: string): UserRecord | undefined {
    const normalised = name.trim().toLowerCase();
    return Array.from(this.users.values()).find(
      (u) => u.name.trim().toLowerCase() === normalised
    );
  }

  public findById(id: string): UserRecord | undefined {
    return Array.from(this.users.values()).find((user) => user.id === id);
  }

  public getAllUsers(): UserRecord[] {
    return Array.from(this.users.values());
  }

  public createUser(userData: {
    name: string;
    email: string;
    password: string;
    role: UserRole;
    department: string;
    title?: string;
  }): UserRecord {
    const existing = this.findByEmail(userData.email);
    if (existing) {
      throw new Error('User with this email already exists.');
    }

    const newUser: UserRecord = {
      id: `usr-${Date.now()}`,
      name: userData.name,
      email: userData.email.toLowerCase(),
      passwordHash: bcrypt.hashSync(userData.password, 10),
      role: userData.role,
      department: userData.department,
      avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
      title: userData.title || `${userData.role.replace('_', ' ')} Specialist`,
      status: 'active',
      createdAt: new Date().toISOString()
    };

    this.users.set(newUser.email, newUser);
    this.persistToDisk();
    console.log(`[Database] Created and persisted new user: ${newUser.name} (${newUser.email}) ✓`);
    return newUser;
  }

  public sanitizeUser(user: UserRecord): Omit<UserRecord, 'passwordHash'> {
    const { passwordHash, ...sanitized } = user;
    return sanitized;
  }
}

export const userStore = new UserStore();
