import type { UserRecord } from '../types.js';

interface AccountAccessState {
  accountStatus?: UserRecord['accountStatus'];
  status?: UserRecord['status'];
}

/**
 * Authentication eligibility is an IAM account decision. `status` is retained only as a
 * compatibility fallback for legacy file-backed users that predate `accountStatus`; it must not
 * be used when the authoritative account state is available.
 */
export const canAuthenticateAccount = (user: AccountAccessState): boolean =>
  user.accountStatus !== undefined
    ? user.accountStatus === 'Active'
    : user.status === 'active';
