export type AccountBaseRole = 'HR' | 'Team_Member';

export interface CreateAccountInput {
  fullName: string;
  username: string;
  email: string;
  baseRole: AccountBaseRole;
  designation?: string;
  teamLeadAssignment?: { projectId: string; endsAtUtc: string };
}

export interface ProvisioningActor { id: string; email: string; role: 'Admin' | 'HR' | 'Team_Member'; }
