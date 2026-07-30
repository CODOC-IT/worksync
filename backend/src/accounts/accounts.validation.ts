import { AccountBaseRole, CreateAccountInput } from './accounts.types.js';
import { AccountValidationError } from './accounts.errors.js';

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const usernamePattern = /^[a-z0-9][a-z0-9._-]{2,79}$/i;

export const PASSWORD_POLICY_MESSAGE =
  'Password must be 8-128 characters and include uppercase, lowercase, a number, and a special character.';

export const isStrongPassword = (password: string): boolean =>
  password.length >= 8
  && password.length <= 128
  && /[A-Z]/.test(password)
  && /[a-z]/.test(password)
  && /\d/.test(password)
  && /[^A-Za-z0-9]/.test(password);

const parsePasswordPair = (input: Record<string, unknown>): string => {
  const password = typeof input.password === 'string' ? input.password : '';
  const confirmPassword = typeof input.confirmPassword === 'string' ? input.confirmPassword : '';
  if (!isStrongPassword(password)) throw new AccountValidationError(PASSWORD_POLICY_MESSAGE);
  if (password !== confirmPassword) throw new AccountValidationError('Password and confirmation do not match.');
  return password;
};

export const parseCreateAccount = (value: unknown): CreateAccountInput => {
  const input = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const fullName = typeof input.fullName === 'string' ? input.fullName.replace(/<[^>]*>/g, '').trim() : '';
  const username = typeof input.username === 'string' ? input.username.trim().toLowerCase() : '';
  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
  const baseRole = input.baseRole as AccountBaseRole;
  const password = parsePasswordPair(input);
  const departmentId = typeof input.departmentId === 'number' ? input.departmentId : Number(input.departmentId);
  const designationValue = typeof input.designation === 'string' ? input.designation.replace(/<[^>]*>/g, '').trim() : '';
  const designation = designationValue || undefined;

  if (fullName.length < 2 || fullName.length > 170) throw new AccountValidationError('Full name must be between 2 and 170 characters.');
  if (!usernamePattern.test(username)) throw new AccountValidationError('Username must be 3-80 letters, numbers, dots, hyphens, or underscores.');
  if (!emailPattern.test(email) || email.length > 254) throw new AccountValidationError('Enter a valid email address.');
  if (baseRole !== 'Admin' && baseRole !== 'HR' && baseRole !== 'Team_Member') {
    throw new AccountValidationError('Base role must be Admin, HR, or Team Member.');
  }
  if (!Number.isInteger(departmentId) || departmentId < 1) throw new AccountValidationError('Select an active department.');
  if (designation && designation.length > 120) throw new AccountValidationError('Designation must be 120 characters or fewer.');

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
  if (teamLeadAssignment && baseRole !== 'Team_Member') {
    throw new AccountValidationError('Team Lead can only be assigned to a Member account.');
  }

  return { fullName, username, email, password, baseRole, departmentId, designation, teamLeadAssignment };
};

export const parseChangePassword = (value: unknown) => {
  const input = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return { password: parsePasswordPair(input) };
};
