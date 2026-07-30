// Project Chat has two distinct privileges:
// - Admin and HR can inspect every project's conversations.
// - HR may join an existing conversation, but may not start one.
// Keeping these predicates separate prevents a broad "can participate" check from accidentally
// granting HR thread-creation access.
export const hasGlobalDiscussionAccess = (role: string): boolean =>
  role === 'Admin' || role === 'HR';

export const canStartDiscussion = (role: string): boolean =>
  role === 'Admin' || role === 'Team_Lead' || role === 'Team_Member';

export const canReplyToDiscussion = (role: string): boolean =>
  hasGlobalDiscussionAccess(role) || role === 'Team_Lead' || role === 'Team_Member';
