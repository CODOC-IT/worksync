// Pure copy-building for the TASK_CREATE approval workflow (§7: a Team Lead proposes a task, an
// Admin approves or rejects it). Colocated pure module, unit-testable without a database — the same
// convention as projectApprovalRejectionCopy.ts, teamNotificationCopy.ts and tasks/taskEditCopy.ts.
//
// Exists because TASK_CREATE was being narrated by the *project* templates: every message it
// produced named the project where it should have named the task, so a Team Lead was told their
// "request to create task "ERP Management System"" had been decided — the project's name, never the
// title of the task they actually proposed.

export interface ProposedTaskSummary {
  title: string;
  projectName: string;
  /** The proposing Team Lead's own team, when the project uses teams. */
  teamName?: string;
  description?: string;
  priority?: string;
  dueDate?: string;
  /** Display names, already resolved — this module never sees a user id. */
  assigneeNames: string[];
  requesterName: string;
}

export interface TaskApprovalCopy {
  title: string;
  message: string;
  detail: string;
  metadata: Record<string, string>;
}

const assigneeLabel = (names: string[]): string =>
  names.length === 0 ? 'Unassigned — awaiting the Team Lead' : names.join(', ');

/** Context rows shared by the submission, approval and rejection bodies, so all three agree. */
const contextMetadata = (task: ProposedTaskSummary): Record<string, string> => ({
  project: task.projectName,
  ...(task.teamName ? { team: task.teamName } : {}),
  task: task.title,
  assignee: assigneeLabel(task.assigneeNames),
  ...(task.priority ? { priority: task.priority } : {}),
  ...(task.dueDate ? { deadline: task.dueDate } : {}),
  requestingTeamLead: task.requesterName
});

/** §7 — what the Admin sees in their Approval Inbox notification. */
export const buildTaskCreateRequestCopy = (task: ProposedTaskSummary): TaskApprovalCopy => ({
  title: 'Task Approval Request',
  message: `${task.requesterName} submitted task "${task.title}" for approval.`,
  detail: [
    `${task.requesterName}, Team Lead of the "${task.teamName || 'project team'}", submitted task ` +
      `"${task.title}" in project "${task.projectName}" for your approval.`,
    '',
    `Assignee: ${assigneeLabel(task.assigneeNames)}`,
    ...(task.priority ? [`Priority: ${task.priority}`] : []),
    ...(task.dueDate ? [`Deadline: ${task.dueDate}`] : []),
    ...(task.description ? ['', `Description: ${task.description}`] : [])
  ].join('\n'),
  metadata: { ...contextMetadata(task), status: 'Pending' }
});

/** §7 — sent to the requesting Team Lead once an Admin approves. */
export const buildTaskCreateApprovedCopy = (
  task: ProposedTaskSummary,
  reviewerName: string
): TaskApprovalCopy => ({
  title: 'Task Approved',
  message: `${reviewerName} approved task "${task.title}".`,
  detail: [
    `${reviewerName} approved task "${task.title}" in project "${task.projectName}". It is now live and ` +
      'assigned.',
    '',
    `Assignee: ${assigneeLabel(task.assigneeNames)}`,
    ...(task.dueDate ? [`Deadline: ${task.dueDate}`] : [])
  ].join('\n'),
  metadata: { ...contextMetadata(task), approvedBy: `${reviewerName} (Admin)`, status: 'Approved' }
});

/**
 * §7 — sent to the requesting Team Lead on rejection. `reason` is the value already persisted to
 * work.ProjectApprovalRequests.DecisionReason, so the notification and the stored review record can
 * never disagree; it lives in detail/metadata rather than the preview (§13).
 */
export const buildTaskCreateRejectedCopy = (
  task: ProposedTaskSummary,
  reviewerName: string,
  reason: string
): TaskApprovalCopy => {
  const trimmed = reason.trim();
  return {
    title: 'Task Rejected',
    message: `${reviewerName} rejected task "${task.title}".`,
    detail: [
      `${reviewerName} rejected your request to create task "${task.title}" in project ` +
        `"${task.projectName}". The task was not created.`,
      '',
      `Reason: ${trimmed || 'No reason was recorded.'}`
    ].join('\n'),
    metadata: {
      ...contextMetadata(task),
      rejectedBy: `${reviewerName} (Admin)`,
      status: 'Rejected',
      rejectionReason: trimmed
    }
  };
};

/** §7 — the assignee's own notice that a task proposed for them is now live. */
export const buildTaskAssigneeApprovedCopy = (
  task: ProposedTaskSummary,
  reviewerName: string
): TaskApprovalCopy => ({
  title: 'Task Assigned',
  message: `Task "${task.title}" is now approved and assigned to you.`,
  detail: [
    `${reviewerName} approved task "${task.title}" in project "${task.projectName}", proposed by ` +
      `${task.requesterName}. It is now assigned to you.`,
    ...(task.priority ? ['', `Priority: ${task.priority}`] : []),
    ...(task.dueDate ? [`Deadline: ${task.dueDate}`] : []),
    ...(task.description ? ['', `Description: ${task.description}`] : [])
  ].join('\n'),
  metadata: { ...contextMetadata(task), approvedBy: `${reviewerName} (Admin)`, status: 'Approved' }
});
