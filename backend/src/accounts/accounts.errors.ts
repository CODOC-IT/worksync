export class AccountValidationError extends Error {}
export class AccountAuthorizationError extends Error {}
export class AccountConflictError extends Error {}
export class AccountProvisioningUnavailableError extends Error {}

export const accountErrorStatus = (error: unknown): number =>
  error instanceof AccountAuthorizationError ? 403
    : error instanceof AccountConflictError ? 409
      : error instanceof AccountValidationError ? 400
        : error instanceof AccountProvisioningUnavailableError ? 503
          : 500;

export const conflictFromDatabaseError = (error: unknown): AccountConflictError | null => {
  const candidate = error as { code?: string; constraint?: string; message?: string };
  if (candidate?.code !== '23505') return null;
  const constraint = `${candidate.constraint || ''} ${candidate.message || ''}`.toLowerCase();
  if (constraint.includes('email')) return new AccountConflictError('An account already exists for this email.');
  if (constraint.includes('username')) return new AccountConflictError('This username is already in use.');
  return null;
};
