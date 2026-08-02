export type UserRole = 'Admin' | 'Team_Lead' | 'HR' | 'Team_Member';

export interface UserRecord {
  id: string;
  name: string;
  email: string;
  username?: string;
  passwordHash: string;
  role: UserRole;
  department: string;
  title: string;
  status: 'active' | 'inactive' | 'away';
  accountStatus?: 'Pending' | 'Active' | 'Locked' | 'Deactivated';
  invitationSentAtUtc?: string | null;
  createdAt: string;
}

export interface AuthResponse {
  success: boolean;
  message: string;
  token?: string;
  user?: Omit<UserRecord, 'passwordHash'>;
}
