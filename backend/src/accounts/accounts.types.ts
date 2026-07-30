export type AccountBaseRole = 'Admin' | 'HR' | 'Team_Member';

export interface CreateAccountInput {
  fullName: string;
  username: string;
  email: string;
  password: string;
  baseRole: AccountBaseRole;
  departmentId: number;
  designation?: string;
  teamLeadAssignment?: { projectId: string; endsAtUtc: string };
}

export interface ChangePasswordInput { password: string; }

export interface ProvisioningActor {
  id: string;
  email: string;
  role: 'Admin' | 'HR' | 'Team_Member';
  departmentId: number | null;
}

export interface ProvisionedAccount {
  id: string;
  fullName: string;
  username: string;
  email: string;
  baseRole: AccountBaseRole;
  departmentId: number;
  accountStatus: 'Pending';
  invitationSentAtUtc: string | null;
}

export type InvitationStatus = 'sent' | 'email_failed';

export interface DepartmentOption {
  id: number;
  name: string;
}
