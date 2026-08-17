import { TaskEditApprovalInput } from './task.types.js';

// Pure copy/diff helpers for the controlled task-edit approval workflow. Extracted from
// task.service.ts so they can be unit-tested without a database or the notification stack —
// same "pure functions in a colocated module" convention as taskRules.ts / task.authorization.ts.
//
// A Team Member's edit request and both of its outcomes need to say *which fields* are involved
// and *which row* they belong to. A bare "your edit request was rejected" forces the recipient to
// open the task and diff it themselves, which is exactly the work the notification exists to
// save them. One shared differ and one shared target-describer mean the request, the approval and
// the rejection can never describe the same edit differently.

const TASK_EDIT_FIELD_LABELS: Record<keyof TaskEditApprovalInput, string> = {
  title: 'Title',
  description: 'Description',
  priority: 'Priority',
  startDate: 'Start date',
  dueDate: 'Due date'
};

export interface TaskEditFieldChange {
  label: string;
  previousValue: string;
  newValue: string;
}

export const diffTaskEdit = (
  previous: TaskEditApprovalInput,
  proposed: TaskEditApprovalInput
): TaskEditFieldChange[] =>
  (Object.keys(TASK_EDIT_FIELD_LABELS) as (keyof TaskEditApprovalInput)[])
    .filter((field) => previous[field] !== proposed[field])
    .map((field) => ({
      label: TASK_EDIT_FIELD_LABELS[field],
      previousValue: String(previous[field] ?? ''),
      newValue: String(proposed[field] ?? '')
    }));

// Long free-text fields are summarized rather than reproduced in full: the expanded notification
// body is a summary of the request, not a replacement for opening it.
export const formatTaskEditChange = (change: TaskEditFieldChange): string => {
  const shorten = (value: string): string =>
    value.length > 80 ? `${value.slice(0, 77)}...` : value;
  if (change.label === 'Description') return 'Description updated';
  return `${change.label}: "${shorten(change.previousValue)}" → "${shorten(change.newValue)}"`;
};

export const summarizeTaskEditFields = (changes: TaskEditFieldChange[]): string =>
  changes.map((change) => change.label).join(', ') || 'task details';

export interface TaskEditTarget {
  isSubtask: boolean;
  /** 'task' | 'subtask' — for sentences like "The subtask is unchanged." */
  noun: string;
  /** '"Implement Emails"' or 'subtask "Testing" under task "Notification Module"'. */
  label: string;
  /** Metadata rows identifying the target: parent title under `task`, own title under `subtask`. */
  metadata: Record<string, string>;
}

/**
 * Identifies the edited row in a way the reader can act on.
 *
 * A subtask's own title is rarely enough on its own — "Testing", "API Integration" and
 * "Documentation" repeat across parents, so "rejected your edit request for 'Testing'" is
 * ambiguous the moment a member has edits open on two subtasks. Naming the parent removes that,
 * and matches the phrasing the subtask assignment-change notifications already use, so a member
 * sees one consistent wording for everything that happens to their subtask.
 *
 * `parentTitle` is undefined for a top-level task, and also when a subtask's parent could not be
 * read — in the latter case the copy degrades to the bare subtask title rather than rendering an
 * empty `under task ""`. Still useful, just less specific.
 */
export const describeTaskEditTarget = (title: string, parentTitle?: string): TaskEditTarget => {
  if (parentTitle === undefined) {
    return { isSubtask: false, noun: 'task', label: `"${title}"`, metadata: { task: title } };
  }
  if (!parentTitle) {
    return { isSubtask: true, noun: 'subtask', label: `subtask "${title}"`, metadata: { subtask: title } };
  }
  return {
    isSubtask: true,
    noun: 'subtask',
    label: `subtask "${title}" under task "${parentTitle}"`,
    metadata: { task: parentTitle, subtask: title }
  };
};
