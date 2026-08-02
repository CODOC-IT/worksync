export interface TaskEditAuthorizationInput {
  actorId: string;
  assigneeIds: string[];
  parentTaskId?: number | null;
  subtaskCount?: number;
}

export const getTaskEditDenialReason = ({
  actorId,
  assigneeIds,
  parentTaskId,
  subtaskCount = 0
}: TaskEditAuthorizationInput): string | null => {
  if (!parentTaskId && subtaskCount > 0) {
    return 'A task with subtasks is read-only. Edit its assigned subtasks instead.';
  }
  if (!assigneeIds.includes(actorId)) {
    return parentTaskId
      ? 'Only users assigned to this subtask can edit it.'
      : 'Only users assigned to this task can edit it.';
  }
  return null;
};
