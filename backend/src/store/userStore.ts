import bcrypt from 'bcryptjs';
import { UserRecord, UserRole } from '../types.js';

// Pre-hashed default password for initial seed users: "password123"
const DEFAULT_PASSWORD_HASH = bcrypt.hashSync('password123', 10);

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
    INITIAL_USERS.forEach((user) => {
      this.users.set(user.email.toLowerCase(), user);
    });
  }

  public findByEmail(email: string): UserRecord | undefined {
    return this.users.get(email.toLowerCase());
  }

  public findById(id: string): UserRecord | undefined {
    return Array.from(this.users.values()).find((user) => user.id === id);
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
    return newUser;
  }

  public sanitizeUser(user: UserRecord): Omit<UserRecord, 'passwordHash'> {
    const { passwordHash, ...sanitized } = user;
    return sanitized;
  }
}

export const userStore = new UserStore();
