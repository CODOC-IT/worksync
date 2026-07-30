export const PASSWORD_POLICY_MESSAGE =
  'Use 8-128 characters with uppercase, lowercase, a number, and a special character.';

export interface PasswordChecks {
  length: boolean;
  uppercase: boolean;
  lowercase: boolean;
  number: boolean;
  special: boolean;
}

export const getPasswordChecks = (password: string): PasswordChecks => ({
  length: password.length >= 8 && password.length <= 128,
  uppercase: /[A-Z]/.test(password),
  lowercase: /[a-z]/.test(password),
  number: /\d/.test(password),
  special: /[^A-Za-z0-9]/.test(password)
});

export const isStrongPassword = (password: string): boolean =>
  Object.values(getPasswordChecks(password)).every(Boolean);

export interface AccountFormValues {
  fullName: string;
  username: string;
  email: string;
  password: string;
  confirmPassword: string;
  designation: string;
  baseRole: string;
  departmentId: string;
  projectId: string;
  endsAtUtc: string;
}

export type AccountFieldErrors = Partial<Record<keyof AccountFormValues, string>>;

export const validateAccountForm = (form: AccountFormValues): AccountFieldErrors => {
  const errors: AccountFieldErrors = {};
  const fullName = form.fullName.replace(/<[^>]*>/g, '').trim();
  const username = form.username.trim();
  const email = form.email.trim();
  if (fullName.length < 2 || fullName.length > 170) errors.fullName = 'Enter 2-170 characters.';
  if (!/^[a-z0-9][a-z0-9._-]{2,79}$/i.test(username)) {
    errors.username = 'Use 3-80 letters, numbers, dots, hyphens, or underscores.';
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) errors.email = 'Enter a valid email address.';
  if (!isStrongPassword(form.password)) errors.password = PASSWORD_POLICY_MESSAGE;
  if (form.password !== form.confirmPassword) errors.confirmPassword = 'Passwords do not match.';
  if (!/^\d+$/.test(form.departmentId) || Number(form.departmentId) < 1) errors.departmentId = 'Select a department.';
  if (!['Admin', 'HR', 'Team_Member'].includes(form.baseRole)) errors.baseRole = 'Select a permitted role.';
  if (form.designation.trim().length > 120) errors.designation = 'Use 120 characters or fewer.';
  if (form.projectId) {
    if (form.baseRole !== 'Team_Member') errors.projectId = 'Only Members can be assigned as Team Lead.';
    if (!form.endsAtUtc || Date.parse(form.endsAtUtc) <= Date.now()) errors.endsAtUtc = 'Choose a future expiry.';
  }
  return errors;
};
