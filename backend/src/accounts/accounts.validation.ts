import { AccountBaseRole, CreateAccountInput } from './accounts.types.js';

export class AccountValidationError extends Error {}

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const usernamePattern = /^[a-z0-9][a-z0-9._-]{2,79}$/i;

export const parseCreateAccount = (value: unknown): CreateAccountInput => {
  const input = value as Record<string, unknown>;
  const fullName = typeof input.fullName === 'string' ? input.fullName.replace(/<[^>]*>/g, '').trim() : '';
  const username = typeof input.username === 'string' ? input.username.trim().toLowerCase() : '';
  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
  const baseRole = input.baseRole as AccountBaseRole;
  const designation = typeof input.designation === 'string' ? input.designation.replace(/<[^>]*>/g, '').trim() : undefined;
  if (fullName.length < 2 || fullName.length > 170) throw new AccountValidationError('Full name must be between 2 and 170 characters.');
  if (!usernamePattern.test(username)) throw new AccountValidationError('Username must be 3–80 letters, numbers, dots, hyphens, or underscores.');
  if (!emailPattern.test(email) || email.length > 254) throw new AccountValidationError('Enter a valid email address.');
  if (baseRole !== 'HR' && baseRole !== 'Team_Member') throw new AccountValidationError('baseRole must be HR or Team_Member.');
  let teamLeadAssignment: CreateAccountInput['teamLeadAssignment'];
  if (input.teamLeadAssignment !== undefined) {
    const assignment = input.teamLeadAssignment as Record<string, unknown>;
    const projectId = typeof assignment?.projectId === 'string' ? assignment.projectId.trim() : '';
    const endsAtUtc = typeof assignment?.endsAtUtc === 'string' ? assignment.endsAtUtc : '';
    if (!/^prj-\d+$/.test(projectId) || !Number.isFinite(Date.parse(endsAtUtc)) || Date.parse(endsAtUtc) <= Date.now()) {
      throw new AccountValidationError('Team Lead assignment requires a project and future expiry.');
    }
    teamLeadAssignment = { projectId, endsAtUtc: new Date(endsAtUtc).toISOString() };
  }
  return { fullName, username, email, baseRole, designation, teamLeadAssignment };
};
