// Pure copy-building for the account change request decision notification (approve/reject).
// Extracted from accountChangeRequestRoutes.ts so it can be unit-tested without a database — same
// "pure functions in a colocated module" convention as backend/src/tasks/taskEditCopy.ts and
// backend/src/projects/projectApprovalRejectionCopy.ts, which this module mirrors.

import { formatDecidedOn } from '../utils/notificationFormatting.js';

const FIELD_LABELS: Record<string, string> = {
  name: 'Display Name',
  email: 'Email',
  username: 'Username',
  password: 'Password'
};

/** 'name' -> 'Display Name'; an unrecognized/missing field key degrades to 'Profile'. */
export const humanizeAccountField = (field: string | null | undefined): string =>
  (field && FIELD_LABELS[field]) || 'Profile';

export interface AccountChangeDecisionInput {
  reviewerName: string;
  fieldLabel: string;
  decidedAt: Date;
}

export interface AccountChangeRejectionInput extends AccountChangeDecisionInput {
  /** The reviewer's rejection reason exactly as persisted on
   *  public.worksync_account_change_requests.decision_reason. */
  reason: string;
}

export interface AccountChangeDecisionCopy {
  title: string;
  /** Compact preview shown in the notification list. */
  message: string;
  /** Full body, shown only when the notification is expanded. */
  detail: string;
  metadata: Record<string, string>;
}

export const buildAccountChangeApprovalCopy = (
  input: AccountChangeDecisionInput
): AccountChangeDecisionCopy => {
  const { reviewerName, fieldLabel, decidedAt } = input;
  const fieldLower = fieldLabel.toLowerCase();
  return {
    title: 'Account Change Request Approved',
    message: `${reviewerName} approved your ${fieldLower} change request.`,
    detail: `${reviewerName} approved your request to change your ${fieldLower}. The change is now live on your account.`,
    metadata: {
      field: fieldLabel,
      approvedBy: reviewerName,
      status: 'Approved',
      decidedOn: formatDecidedOn(decidedAt)
    }
  };
};

/**
 * Preview deliberately omits the reason (kept short, matching the same "concise preview, full
 * detail in the expanded view" pattern used by task_edit_approval_rejected /
 * project_approval_rejected) — the reason lives only in `detail`/`metadata`, which is what
 * Notification History reads back on every future page load, not any temporary UI state.
 */
export const buildAccountChangeRejectionCopy = (
  input: AccountChangeRejectionInput
): AccountChangeDecisionCopy => {
  const { reviewerName, fieldLabel, decidedAt } = input;
  const reason = input.reason.trim();
  const fieldLower = fieldLabel.toLowerCase();
  return {
    title: 'Account Change Request Rejected',
    message: `${reviewerName} rejected your ${fieldLower} change request.`,
    detail: [
      `${reviewerName} rejected your request to change your ${fieldLower}.`,
      '',
      `Reason: ${reason || 'No reason was recorded.'}`
    ].join('\n'),
    metadata: {
      field: fieldLabel,
      rejectedBy: reviewerName,
      status: 'Rejected',
      reason,
      decidedOn: formatDecidedOn(decidedAt)
    }
  };
};
