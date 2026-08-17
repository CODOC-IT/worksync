// Pure copy-building for the Project Approval rejection notification. Extracted from
// projectApproval.service.ts so it can be unit-tested without a database — same "pure functions
// in a colocated module" convention as backend/src/tasks/taskEditCopy.ts (the task-edit-approval
// equivalent this module deliberately mirrors, per the Project Approval rejection spec's
// "Consistency" requirement).

export interface ProjectApprovalRejectionInput {
  reviewerName: string;
  projectName: string;
  requestTypeLabel: string;
  /** The Admin's rejection reason exactly as persisted on work.ProjectApprovalRequests.DecisionReason. */
  reason: string;
  decidedAt: Date;
}

export interface ProjectApprovalRejectionCopy {
  title: string;
  /** Compact preview shown in the notification list. */
  message: string;
  /** Full body, shown only when the notification is expanded. */
  detail: string;
  metadata: Record<string, string>;
}

// "08 Aug 2026, 2:45 PM" — day-month-year (unambiguous, locale-independent field order) plus a
// 12-hour clock with an uppercase AM/PM marker. Two Intl calls rather than one combined format
// string, so each half's formatting is controlled independently.
export const formatRejectedOn = (date: Date): string => {
  const datePart = date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  const timePart = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  return `${datePart}, ${timePart}`;
};

/**
 * Builds the rejection notification's compact preview, expanded detail and metadata from a
 * single, already-DB-persisted reason. The preview deliberately omits the reason (kept short,
 * per the spec's "keep the notification concise") — it lives only in `detail`/`metadata`, which
 * is what Notification History reads back on every future page load, not any temporary UI state.
 */
export const buildProjectApprovalRejectionCopy = (
  input: ProjectApprovalRejectionInput
): ProjectApprovalRejectionCopy => {
  const { reviewerName, projectName, requestTypeLabel, decidedAt } = input;
  const reason = input.reason.trim();

  return {
    title: 'Project Approval Request Rejected',
    message: `${reviewerName} rejected your approval request for "${projectName}".`,
    detail: [
      `${reviewerName} rejected your request to ${requestTypeLabel} "${projectName}".`,
      '',
      `Reason: ${reason || 'No reason was recorded.'}`
    ].join('\n'),
    metadata: {
      project: projectName,
      rejectedBy: `${reviewerName} (Admin)`,
      status: 'Rejected',
      reason,
      rejectedOn: formatRejectedOn(decidedAt),
      requestType: requestTypeLabel
    }
  };
};
