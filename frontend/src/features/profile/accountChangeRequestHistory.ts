import { AccountChangeRequest } from '../../types';

export const getOwnAccountChangeRequests = (
  requests: AccountChangeRequest[],
  currentUserId: string
): AccountChangeRequest[] =>
  requests.filter((request) => request.userId === currentUserId);

export const getSafeRequestedChangeLabel = (request: AccountChangeRequest): string => {
  if (request.requestedField === 'password' || request.passwordChangeRequested) {
    return 'Password change requested';
  }
  const labels: Record<string, string> = {
    name: 'Display name',
    email: 'Email',
    username: 'Username',
  };
  return labels[request.requestedField || ''] || 'Account information';
};
