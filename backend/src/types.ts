export type UserRole = 'Admin' | 'Team_Lead' | 'HR' | 'Team_Member';

export interface UserRecord {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  department: string;
  avatar: string;
  title: string;
  status: 'active' | 'inactive' | 'away';
  createdAt: string;
}

export interface AuthResponse {
  success: boolean;
  message: string;
  token?: string;
  user?: Omit<UserRecord, 'passwordHash'>;
}
