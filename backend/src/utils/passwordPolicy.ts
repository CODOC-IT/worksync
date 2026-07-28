const MIN_PASSWORD_LENGTH = 8;
const REQUIRED_CHARACTER_GROUPS = 3;

export const getPasswordPolicyError = (password: unknown): string | null => {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters long.`;
  }

  const characterGroups = [
    /[A-Z]/.test(password),
    /[a-z]/.test(password),
    /[0-9]/.test(password),
    /[^A-Za-z0-9]/.test(password)
  ].filter(Boolean).length;

  if (characterGroups < REQUIRED_CHARACTER_GROUPS) {
    return 'Password must include at least three of: uppercase, lowercase, number, and special character.';
  }

  return null;
};
