// Pure decision rule for the "all tasks in this project are done" announcement, extracted from
// task.service.ts so it can be tested without a database — same convention as
// task.authorization.ts's getTaskEditDenialReason.

export interface ProjectCompletionCheck {
  /** Top-level, non-archived tasks in the project. */
  total: number;
  /** How many of `total` are in a completed state. */
  completed: number;
  /** When this project was last announced complete, or null if never. */
  lastAnnouncedAt: Date | null;
  /** When any task in the project last LEFT a completed state (reopen / review rejection). */
  lastReopenedAt: Date | null;
}

// True only when the project is fully complete AND that completion has not already been
// announced. The second half is what makes this fire once per completion rather than once per
// task moved to Done: an announcement that is more recent than the last time a task left a
// completed state means the project's current finished streak was already reported.
//
// A project that is reopened and then finished again DOES announce again — that is a new
// completion, not a repeat of the old one, which is exactly the distinction the "only once"
// requirement is drawing (no second announcement for the same completion).
export const shouldAnnounceProjectCompletion = ({
  total,
  completed,
  lastAnnouncedAt,
  lastReopenedAt
}: ProjectCompletionCheck): boolean => {
  // A project with no tasks at all has not "been completed" — there was nothing to complete.
  if (total === 0 || completed < total) return false;
  if (!lastAnnouncedAt) return true;
  return Boolean(lastReopenedAt && lastReopenedAt > lastAnnouncedAt);
};
