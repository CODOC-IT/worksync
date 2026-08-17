import { query, withTransaction } from '../db/pool.js';
import { getPriorityId } from '../projects/project.repository.js';
import {
  TaskAssigneeRow,
  TaskEditApprovalInput,
  TaskEditApprovalRow,
  TaskRow,
  TaskStatusHistoryRow
} from './task.types.js';

export { getPriorityId };

const TASK_COLUMNS = `
  t.taskid, t.projectid, t.parenttaskid, t.tasknumber, t.title, t.description,
  ts.statuscode, pr.prioritycode, t.startdate::text, t.duedate::text,
  t.createdbyuserid, t.completedatutc, t.completionsummary, t.archivedatutc,
  t.projectarchivedatutc,
  t.createdatutc, t.updatedatutc, t.rowversion, p.projectcode,
  (SELECT COUNT(*)::int FROM work.tasks st WHERE st.parenttaskid = t.taskid AND st.archivedatutc IS NULL) AS subtaskcount,
  -- Completed-subtask tally, derived from work.TaskStatuses.IsCompletedState rather than a
  -- hardcoded 'Done' string, so it stays correct if another completed state is ever added.
  -- Selected alongside subtaskcount so the board's progress bar comes from the database on
  -- every read (list AND detail) instead of being recomputed from client state.
  (SELECT COUNT(*)::int FROM work.tasks st
     JOIN work.taskstatuses sts ON sts.taskstatusid = st.taskstatusid
   WHERE st.parenttaskid = t.taskid AND st.archivedatutc IS NULL AND sts.iscompletedstate) AS completedsubtaskcount,
  EXISTS (
    SELECT 1
    FROM work.taskchangerequests cr
    JOIN work.changerequesttypes crt ON crt.changerequesttypeid = cr.changerequesttypeid
    WHERE cr.taskid = t.taskid
      AND cr.requeststatus = 'Pending'
      AND cr.cancelledatutc IS NULL
      AND crt.typecode = 'Description'
      AND cr.requestreason = 'Controlled task edit approval'
  ) AS haspendingeditapproval
`;

const TASK_JOINS = `
  FROM work.tasks t
  JOIN work.taskstatuses ts ON ts.taskstatusid = t.taskstatusid
  JOIN work.priorities pr ON pr.priorityid = t.priorityid
  JOIN work.projects p ON p.projectid = t.projectid
`;

export const getTaskStatusId = async (statusCode: string): Promise<number> => {
  const result = await query<{ taskstatusid: number }>(
    'SELECT taskstatusid FROM work.taskstatuses WHERE statuscode = $1',
    [statusCode]
  );
  if (!result.rows[0]) throw new Error(`Unknown task status code: "${statusCode}"`);
  return result.rows[0].taskstatusid;
};

export const getTaskStatusMeta = async (
  statusCode: string
): Promise<{ taskStatusId: number; isCompletedState: boolean; requiresReview: boolean } | null> => {
  const result = await query<{ taskstatusid: number; iscompletedstate: boolean; requiresreview: boolean }>(
    'SELECT taskstatusid, iscompletedstate, requiresreview FROM work.taskstatuses WHERE statuscode = $1',
    [statusCode]
  );
  const row = result.rows[0];
  if (!row) return null;
  return { taskStatusId: row.taskstatusid, isCompletedState: row.iscompletedstate, requiresReview: row.requiresreview };
};

export const findAllTasks = async (): Promise<TaskRow[]> => {
  const result = await query<TaskRow>(
    `SELECT ${TASK_COLUMNS} ${TASK_JOINS}
     WHERE t.parenttaskid IS NULL AND t.archivedatutc IS NULL AND t.projectarchivedatutc IS NULL
     ORDER BY t.taskid`
  );
  return result.rows;
};

export const findArchivedProjectTasks = async (): Promise<TaskRow[]> => {
  const result = await query<TaskRow>(
    `SELECT ${TASK_COLUMNS} ${TASK_JOINS}
     WHERE t.parenttaskid IS NULL AND t.archivedatutc IS NULL AND t.projectarchivedatutc IS NOT NULL
     ORDER BY t.taskid`
  );
  return result.rows;
};

export const findTasksForProject = async (projectId: number, archived = false): Promise<TaskRow[]> => {
  const result = await query<TaskRow>(
    `SELECT ${TASK_COLUMNS} ${TASK_JOINS}
     WHERE t.projectid = $1
       AND t.parenttaskid IS NULL
       AND t.archivedatutc IS NULL
       AND t.projectarchivedatutc IS ${archived ? 'NOT NULL' : 'NULL'}
     ORDER BY t.taskid`,
    [projectId]
  );
  return result.rows;
};

export const findTaskById = async (taskId: number): Promise<TaskRow | null> => {
  const result = await query<TaskRow>(`SELECT ${TASK_COLUMNS} ${TASK_JOINS} WHERE t.taskid = $1`, [taskId]);
  return result.rows[0] || null;
};

export const findChildTasks = async (parentTaskId: number): Promise<TaskRow[]> => {
  const result = await query<TaskRow>(
    `SELECT ${TASK_COLUMNS} ${TASK_JOINS} WHERE t.parenttaskid = $1 AND t.archivedatutc IS NULL ORDER BY t.taskid`,
    [parentTaskId]
  );
  return result.rows;
};

export const findSubtaskCounts = async (parentTaskIds: number[]): Promise<Array<{ parenttaskid: number; subtaskcount: number }>> => {
  if (parentTaskIds.length === 0) return [];
  const result = await query<{ parenttaskid: number; subtaskcount: number }>(
    `SELECT parenttaskid, COUNT(*)::int AS subtaskcount FROM work.tasks
     WHERE parenttaskid = ANY($1::bigint[]) AND archivedatutc IS NULL GROUP BY parenttaskid`,
    [parentTaskIds]
  );
  return result.rows;
};

export const findAssigneesForTask = async (taskId: number): Promise<TaskAssigneeRow[]> => {
  const result = await query<TaskAssigneeRow>(
    'SELECT taskid, userid FROM work.taskassignees WHERE taskid = $1 AND unassignedatutc IS NULL ORDER BY taskassigneeid',
    [taskId]
  );
  return result.rows;
};

export const findAssigneesForTasks = async (taskIds: number[]): Promise<TaskAssigneeRow[]> => {
  if (taskIds.length === 0) return [];
  const result = await query<TaskAssigneeRow>(
    'SELECT taskid, userid FROM work.taskassignees WHERE taskid = ANY($1::bigint[]) AND unassignedatutc IS NULL ORDER BY taskassigneeid',
    [taskIds]
  );
  return result.rows;
};

export interface ActiveAssignmentRow {
  taskid: number;
  parenttaskid: number | null;
  title: string;
}

// Whether `userId` has any active (not-yet-Done) task OR subtask assignment left in `projectId` --
// used by project.service.ts's removeMember (should this member be kept as Pending Removal
// instead of removed?) and its completion-triggered recheck (are they clear to actually remove
// now?). Deliberately does NOT filter out subtasks (t.parenttaskid IS NULL), unlike
// reports.repository.ts's getWorkload/deadline queries -- Issue #6 requires a subtask assigned to
// someone, with its parent task still incomplete, to count on its own.
export const findActiveTaskAssignmentsForUserInProject = async (
  projectId: number,
  userId: number
): Promise<ActiveAssignmentRow[]> => {
  const result = await query<ActiveAssignmentRow>(
    `SELECT t.taskid, t.parenttaskid, t.title
     FROM work.taskassignees ta
     JOIN work.tasks t ON t.taskid = ta.taskid
     JOIN work.taskstatuses ts ON ts.taskstatusid = t.taskstatusid
     WHERE ta.unassignedatutc IS NULL
       AND t.projectid = $1
       AND ta.userid = $2
       AND t.archivedatutc IS NULL
       AND NOT ts.iscompletedstate
     ORDER BY t.taskid`,
    [projectId, userId]
  );
  return result.rows;
};

// Hands every active (not-yet-Done, not-archived) task and subtask assignment `fromUserId` holds in
// `projectId` to `toUserId`, in one transaction, and reports what moved. Written for the Team Lead
// replacement rule (§5 of the team workflow: "any task assigned to the outgoing Team Lead must
// automatically be reassigned to the new Team Lead"), which is why it is project-scoped rather than
// team-scoped -- work.TeamMembers' UQ_TeamMembers_Project_User invariant means the outgoing lead
// belongs to exactly one team of this project, so all of their project work is that team's work,
// including tasks predating the team layer whose TeamId is still NULL.
//
// Selects the affected rows before writing so the caller can name each reassigned task in its
// notification; the same statement's rows are then updated, so a task cannot be reported as
// reassigned without having been. Assignments are closed out (UnassignedAtUtc) rather than deleted,
// matching updateTask's assignee handling, so the history of who held the work is preserved. A task
// the new lead is already an assignee of is left alone rather than double-inserted.
export const reassignActiveTasksInProject = async (
  projectId: number,
  fromUserId: number,
  toUserId: number,
  actorUserId: number
): Promise<ActiveAssignmentRow[]> =>
  withTransaction(async (runQuery) => {
    const affected = await runQuery<ActiveAssignmentRow>(
      `SELECT t.taskid, t.parenttaskid, t.title
         FROM work.taskassignees ta
         JOIN work.tasks t ON t.taskid = ta.taskid
         JOIN work.taskstatuses ts ON ts.taskstatusid = t.taskstatusid
        WHERE ta.unassignedatutc IS NULL
          AND t.projectid = $1
          AND ta.userid = $2
          AND t.archivedatutc IS NULL
          AND NOT ts.iscompletedstate
        ORDER BY t.taskid`,
      [projectId, fromUserId]
    );
    if (affected.rows.length === 0) return [];

    const taskIds = affected.rows.map((row) => row.taskid);
    await runQuery(
      `UPDATE work.taskassignees
          SET unassignedatutc = CURRENT_TIMESTAMP, unassignedbyuserid = $1
        WHERE userid = $2 AND unassignedatutc IS NULL AND taskid = ANY($3::bigint[])`,
      [actorUserId, fromUserId, taskIds]
    );
    for (const taskId of taskIds) {
      const existing = await runQuery<{ taskassigneeid: number }>(
        `SELECT taskassigneeid FROM work.taskassignees
          WHERE taskid = $1 AND userid = $2 AND unassignedatutc IS NULL`,
        [taskId, toUserId]
      );
      if (existing.rows.length > 0) continue;
      await runQuery(
        `INSERT INTO work.taskassignees (taskid, userid, assignedbyuserid) VALUES ($1, $2, $3)`,
        [taskId, toUserId, actorUserId]
      );
    }
    return affected.rows;
  });

const getNextTaskNumber = async (runQuery: typeof query, projectId: number): Promise<number> => {
  const result = await runQuery<{ next: string }>(
    'SELECT COALESCE(MAX(tasknumber), 0) + 1 AS next FROM work.tasks WHERE projectid = $1',
    [projectId]
  );
  return Number(result.rows[0].next);
};

export interface InsertTaskRow {
  projectId: number;
  parentTaskId?: number;
  title: string;
  description: string;
  statusId: number;
  priorityId: number;
  startDate: string;
  dueDate: string;
  createdByUserId: number;
  assigneeUserIds: number[];
  // Multi-team architecture: the owning team and, for an Admin-created task awaiting the team
  // lead to assign it, 'NeedsTeamAssignment' (vs 'Assigned' for a normally-created task).
  teamId?: number;
  assignmentStatus?: 'NeedsTeamAssignment' | 'Assigned';
}

const insertTaskWithQuery = async (runQuery: typeof query, input: InsertTaskRow): Promise<number> => {
    const taskNumber = await getNextTaskNumber(runQuery, input.projectId);

    const inserted = await runQuery<{ taskid: number }>(
      `INSERT INTO work.tasks
         (projectid, parenttaskid, tasknumber, title, description, taskstatusid, priorityid, startdate,
          duedate, createdbyuserid, teamid, assignmentstatus)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING taskid`,
      [
        input.projectId,
        input.parentTaskId || null,
        taskNumber,
        input.title,
        input.description,
        input.statusId,
        input.priorityId,
        input.startDate,
        input.dueDate,
        input.createdByUserId,
        input.teamId || null,
        input.assignmentStatus || null
      ]
    );
    const taskId = inserted.rows[0].taskid;

    const uniqueAssignees = Array.from(new Set(input.assigneeUserIds));
    for (const userId of uniqueAssignees) {
      await runQuery(
        `INSERT INTO work.taskassignees (taskid, userid, assignedbyuserid)
         VALUES ($1, $2, $3)`,
        [taskId, userId, input.createdByUserId]
      );
    }

    // The initial creation is its own zero-from-state history entry, so a task's full lifecycle
    // (including "when was it created, by whom") is always readable from one place
    // (GET /api/tasks/:id/history) rather than history-minus-creation.
    await runQuery(
      `INSERT INTO work.taskstatushistory (taskid, fromtaskstatusid, totaskstatusid, changedbyuserid, progressnote)
       VALUES ($1, NULL, $2, $3, 'Task created')`,
      [taskId, input.statusId, input.createdByUserId]
    );

  return taskId;
};

export const insertTask = async (input: InsertTaskRow): Promise<number> =>
  withTransaction((runQuery) => insertTaskWithQuery(runQuery, input));

export const insertTaskEditApproval = async (
  task: TaskRow,
  requestedByUserId: number,
  reviewerUserId: number,
  previous: TaskEditApprovalInput,
  proposed: TaskEditApprovalInput
): Promise<number> => withTransaction(async (runQuery) => {
  await runQuery('SELECT taskid FROM work.tasks WHERE taskid = $1 FOR UPDATE', [task.taskid]);
  const type = await runQuery<{ changerequesttypeid: number }>(
    `SELECT changerequesttypeid FROM work.changerequesttypes
     WHERE typecode = 'Description' AND isenabled`
  );
  if (!type.rows[0]) throw new Error('Task change request type is not configured.');
  const existing = await runQuery<{ changerequestid: number }>(
    `SELECT cr.changerequestid
       FROM work.taskchangerequests cr
      WHERE cr.taskid = $1
        AND cr.changerequesttypeid = $2
        AND cr.requeststatus = 'Pending'
        AND cr.cancelledatutc IS NULL`,
    [task.taskid, type.rows[0].changerequesttypeid]
  );
  if (existing.rows[0]) throw new Error('This task already has a pending edit request.');

  const inserted = await runQuery<{ changerequestid: number }>(
    `INSERT INTO work.taskchangerequests
       (taskid, changerequesttypeid, requestedbyuserid, requestreason, requeststatus,
        assignedrevieweruserid, submittedatutc)
     VALUES ($1, $2, $3, $4, 'Pending', $5, CURRENT_TIMESTAMP)
     RETURNING changerequestid`,
    [
      task.taskid,
      type.rows[0].changerequesttypeid,
      requestedByUserId,
      'Controlled task edit approval',
      reviewerUserId
    ]
  );
  const requestId = inserted.rows[0].changerequestid;

  await runQuery(
    `INSERT INTO work.taskchangerequestitems
       (changerequestid, fieldcode, oldvaluejson, proposedvaluejson)
     VALUES ($1, 'taskUpdate', $2, $3)`,
    [requestId, JSON.stringify(previous), JSON.stringify(proposed)]
  );
  return requestId;
});

export const findPendingTaskEditApprovalsForReviewer = async (
  reviewerUserId: number
): Promise<TaskEditApprovalRow[]> => {
  const result = await query<TaskEditApprovalRow>(
    `SELECT cr.changerequestid, cr.taskid, t.projectid, t.title AS tasktitle,
            cr.requestedbyuserid, cr.requeststatus, cr.submittedatutc,
            i.fieldcode, i.oldvaluejson, i.proposedvaluejson
       FROM work.taskchangerequests cr
       JOIN work.tasks t ON t.taskid = cr.taskid
       JOIN work.projects p ON p.projectid = t.projectid
       JOIN work.changerequesttypes ct ON ct.changerequesttypeid = cr.changerequesttypeid
       LEFT JOIN work.taskchangerequestitems i ON i.changerequestid = cr.changerequestid
      WHERE cr.assignedrevieweruserid = $1
        AND cr.requeststatus = 'Pending'
        AND cr.cancelledatutc IS NULL
        AND t.archivedatutc IS NULL
        AND t.projectarchivedatutc IS NULL
        AND p.archivedatutc IS NULL
        AND ct.typecode = 'Description'
        AND cr.requestreason = 'Controlled task edit approval'
      ORDER BY cr.submittedatutc DESC, cr.changerequestid DESC`,
    [reviewerUserId]
  );
  return result.rows;
};

export const decideTaskEditApproval = async (
  requestId: number,
  reviewerUserId: number,
  decision: 'Approved' | 'Rejected',
  proposed: TaskEditApprovalInput,
  reviewNote?: string
): Promise<number | null> => withTransaction(async (runQuery) => {
  const locked = await runQuery<{ taskid: number }>(
    `SELECT taskid FROM work.taskchangerequests
      WHERE changerequestid = $1
        AND assignedrevieweruserid = $2
        AND requeststatus = 'Pending'
      FOR UPDATE`,
    [requestId, reviewerUserId]
  );
  if (!locked.rows[0]) return null;

  if (decision === 'Approved') {
    const priority = await runQuery<{ priorityid: number }>(
      'SELECT priorityid FROM work.priorities WHERE prioritycode = $1',
      [proposed.priority === 'Urgent' ? 'Critical' : proposed.priority]
    );
    if (!priority.rows[0]) throw new Error('Unknown task priority.');
    await runQuery(
      `UPDATE work.tasks
          SET title = $1, description = $2, priorityid = $3, startdate = $4, duedate = $5
        WHERE taskid = $6 AND archivedatutc IS NULL`,
      [
        proposed.title,
        proposed.description,
        priority.rows[0].priorityid,
        proposed.startDate,
        proposed.dueDate,
        locked.rows[0].taskid
      ]
    );
  }

  await runQuery(
    `UPDATE work.taskchangerequests
        SET requeststatus = $1, decisionatutc = CURRENT_TIMESTAMP, updatedatutc = CURRENT_TIMESTAMP
      WHERE changerequestid = $2`,
    [decision, requestId]
  );
  await runQuery(
    `INSERT INTO work.changerequestreviews
       (changerequestid, revieweruserid, reviewaction, reviewnote, reviewerrolecode)
     VALUES ($1, $2, $3, $4, 'TeamLead')`,
    [requestId, reviewerUserId, decision, reviewNote || null]
  );
  return locked.rows[0].taskid;
});

// --- Cross-team subtask transfer (multi-team architecture) --------------------------------
// A Team Lead hands one of their team's subtasks to another team; an Admin decides. The subtask
// row is untouched until approval, at which point its TeamId flips to the target team (see
// database/migrations/20260816_01_project_teams.sql).

export interface SubtaskTransferRequestRow {
  requestid: number;
  subtaskid: number;
  projectid: number;
  fromteamid: number | null;
  toteamid: number;
  requestedbyuserid: number;
  requestreason: string | null;
  requeststatus: 'Pending' | 'Approved' | 'Rejected';
  requestedatutc: Date;
  decidedatutc: Date | null;
  decidedbyuserid: number | null;
  decisionreason: string | null;
}

const TRANSFER_REQUEST_COLUMNS = `
  requestid, subtaskid, projectid, fromteamid, toteamid, requestedbyuserid, requestreason,
  requeststatus, requestedatutc, decidedatutc, decidedbyuserid, decisionreason
`;

export const insertSubtaskTransferRequest = async (input: {
  subtaskId: number;
  projectId: number;
  fromTeamId: number | null;
  toTeamId: number;
  requestedByUserId: number;
  reason: string;
}): Promise<number> => {
  const inserted = await query<{ requestid: number }>(
    `INSERT INTO work.subtasktransferrequests
       (subtaskid, projectid, fromteamid, toteamid, requestedbyuserid, requestreason)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING requestid`,
    [input.subtaskId, input.projectId, input.fromTeamId, input.toTeamId, input.requestedByUserId, input.reason.trim()]
  );
  return Number(inserted.rows[0].requestid);
};

export const findSubtaskTransferRequestById = async (
  requestId: number
): Promise<SubtaskTransferRequestRow | null> => {
  const result = await query<SubtaskTransferRequestRow>(
    `SELECT ${TRANSFER_REQUEST_COLUMNS} FROM work.subtasktransferrequests WHERE requestid = $1`,
    [requestId]
  );
  return result.rows[0] || null;
};

export const findPendingSubtaskTransferRequests = async (): Promise<SubtaskTransferRequestRow[]> => {
  const result = await query<SubtaskTransferRequestRow>(
    `SELECT ${TRANSFER_REQUEST_COLUMNS}
     FROM work.subtasktransferrequests
     WHERE requeststatus = 'Pending'
     ORDER BY requestedatutc`,
    []
  );
  return result.rows;
};

export const findSubtaskTransferRequestsForUser = async (userId: number): Promise<SubtaskTransferRequestRow[]> => {
  const result = await query<SubtaskTransferRequestRow>(
    `SELECT ${TRANSFER_REQUEST_COLUMNS}
     FROM work.subtasktransferrequests
     WHERE requestedbyuserid = $1
     ORDER BY requestedatutc DESC`,
    [userId]
  );
  return result.rows;
};

// Decides a transfer request. On approval the subtask's TeamId moves to the target team (the
// assignees are untouched -- the receiving team lead reassigns as needed). Returns null when the
// request is already decided, so the caller can surface "already decided".
export const decideSubtaskTransferRequest = async (
  requestId: number,
  decision: 'Approved' | 'Rejected',
  decidedByUserId: number,
  decisionReason: string | null
): Promise<SubtaskTransferRequestRow | null> =>
  withTransaction(async (runQuery) => {
    const locked = await runQuery<SubtaskTransferRequestRow>(
      `SELECT ${TRANSFER_REQUEST_COLUMNS}
       FROM work.subtasktransferrequests WHERE requestid = $1 AND requeststatus = 'Pending' FOR UPDATE`,
      [requestId]
    );
    if (!locked.rows[0]) return null;

    if (decision === 'Approved') {
      await runQuery(
        `UPDATE work.tasks SET teamid = $1, assignmentstatus = 'Assigned' WHERE taskid = $2`,
        [locked.rows[0].toteamid, locked.rows[0].subtaskid]
      );
    }
    await runQuery(
      `UPDATE work.subtasktransferrequests
       SET requeststatus = $1, decidedatutc = CURRENT_TIMESTAMP, decidedbyuserid = $2,
           decisionreason = $3
       WHERE requestid = $4`,
      [decision, decidedByUserId, decisionReason?.trim() || null, requestId]
    );
    const updated = await runQuery<SubtaskTransferRequestRow>(
      `SELECT ${TRANSFER_REQUEST_COLUMNS} FROM work.subtasktransferrequests WHERE requestid = $1`,
      [requestId]
    );
    return updated.rows[0];
  });

// Parent and children are persisted in one transaction, so a failed child validation/write
// cannot leave an orphaned parent task behind.
export const insertTaskBundle = async (
  parent: InsertTaskRow,
  children: Omit<InsertTaskRow, 'projectId' | 'parentTaskId' | 'createdByUserId'>[]
): Promise<{ parentTaskId: number; childTaskIds: number[] }> =>
  withTransaction(async (runQuery) => {
    const parentTaskId = await insertTaskWithQuery(runQuery, parent);
    const childTaskIds: number[] = [];
    for (const child of children) {
      childTaskIds.push(await insertTaskWithQuery(runQuery, {
        ...child,
        projectId: parent.projectId,
        parentTaskId,
        createdByUserId: parent.createdByUserId
      }));
    }
    return { parentTaskId, childTaskIds };
  });

export interface UpdateTaskRow {
  title?: string;
  description?: string;
  priorityId?: number;
  startDate?: string;
  dueDate?: string;
}

export const updateTask = async (
  taskId: number,
  updates: UpdateTaskRow,
  assigneeUserIds: number[] | undefined,
  actorUserId: number
): Promise<void> => {
  await withTransaction(async (runQuery) => {
    const setClauses: string[] = [];
    const params: unknown[] = [];
    const addSet = (column: string, value: unknown) => {
      params.push(value);
      setClauses.push(`${column} = $${params.length}`);
    };

    if (updates.title !== undefined) addSet('title', updates.title);
    if (updates.description !== undefined) addSet('description', updates.description);
    if (updates.priorityId !== undefined) addSet('priorityid', updates.priorityId);
    if (updates.startDate !== undefined) addSet('startdate', updates.startDate);
    if (updates.dueDate !== undefined) addSet('duedate', updates.dueDate);

    if (setClauses.length > 0) {
      setClauses.push('updatedatutc = CURRENT_TIMESTAMP');
      setClauses.push('rowversion = rowversion + 1');
      params.push(taskId);
      await runQuery(`UPDATE work.tasks SET ${setClauses.join(', ')} WHERE taskid = $${params.length}`, params);
    }

    if (assigneeUserIds) {
      await runQuery(
        `UPDATE work.taskassignees SET unassignedatutc = CURRENT_TIMESTAMP, unassignedbyuserid = $1
         WHERE taskid = $2 AND unassignedatutc IS NULL`,
        [actorUserId, taskId]
      );
      for (const userId of Array.from(new Set(assigneeUserIds))) {
        await runQuery(
          `INSERT INTO work.taskassignees (taskid, userid, assignedbyuserid) VALUES ($1, $2, $3)`,
          [taskId, userId, actorUserId]
        );
      }
      // Completes the Admin -> Team handoff: a task an Admin created for a whole team carries
      // AssignmentStatus 'NeedsTeamAssignment' until its Team Lead gives it to someone. Nothing
      // cleared that flag before, so a handed-off task stayed marked as awaiting assignment for the
      // rest of its life even once a member owned it. Scoped to the NeedsTeamAssignment state, so an
      // ordinary reassignment of an ordinary task writes nothing here.
      if (assigneeUserIds.length > 0) {
        await runQuery(
          `UPDATE work.tasks SET assignmentstatus = 'Assigned'
            WHERE taskid = $1 AND assignmentstatus = 'NeedsTeamAssignment'`,
          [taskId]
        );
      }
    }
  });
};

// Soft-delete (archive) — work.Tasks has ArchivedAtUtc for exactly this, matching the same
// "never a hard DELETE" pattern as Projects and Notifications.
export const archiveTask = async (taskId: number): Promise<boolean> => {
  const result = await query(
    `UPDATE work.tasks SET archivedatutc = CURRENT_TIMESTAMP, updatedatutc = CURRENT_TIMESTAMP,
       rowversion = rowversion + 1
     WHERE (taskid = $1 OR parenttaskid = $1) AND archivedatutc IS NULL`,
    [taskId]
  );
  return (result.rowCount ?? 0) > 0;
};

export interface ChangeStatusRow {
  taskId: number;
  fromStatusId: number;
  toStatusId: number;
  changedByUserId: number;
  note: string;
  isCompletedState: boolean;
  completionSummary?: string;
}

// Updates Task.TaskStatusId + inserts the TaskStatusHistory audit row atomically — this is the
// one place both ever change together, so there's no window where they could disagree.
export const changeTaskStatus = async (input: ChangeStatusRow): Promise<void> => {
  await withTransaction(async (runQuery) => {
    const setClauses = ['taskstatusid = $1', 'updatedatutc = CURRENT_TIMESTAMP', 'rowversion = rowversion + 1'];
    const params: unknown[] = [input.toStatusId];

    if (input.isCompletedState) {
      params.push(input.completionSummary || input.note);
      setClauses.push(`completedatutc = CURRENT_TIMESTAMP`, `completionsummary = $${params.length}`);
    } else {
      setClauses.push('completedatutc = NULL', 'completionsummary = NULL');
    }

    params.push(input.taskId);
    await runQuery(`UPDATE work.tasks SET ${setClauses.join(', ')} WHERE taskid = $${params.length}`, params);

    await runQuery(
      `INSERT INTO work.taskstatushistory (taskid, fromtaskstatusid, totaskstatusid, changedbyuserid, progressnote)
       VALUES ($1, $2, $3, $4, $5)`,
      [input.taskId, input.fromStatusId, input.toStatusId, input.changedByUserId, input.note]
    );
  });
};

export const findStatusHistoryForTask = async (taskId: number): Promise<TaskStatusHistoryRow[]> => {
  const result = await query<TaskStatusHistoryRow>(
    `SELECT h.taskstatushistoryid, h.taskid, h.fromtaskstatusid, fs.statuscode AS fromstatuscode,
            h.totaskstatusid, ts.statuscode AS tostatuscode, h.changedbyuserid,
            u.displayname AS changedbyname, h.progressnote, h.changedatutc
     FROM work.taskstatushistory h
     JOIN work.taskstatuses ts ON ts.taskstatusid = h.totaskstatusid
     LEFT JOIN work.taskstatuses fs ON fs.taskstatusid = h.fromtaskstatusid
     LEFT JOIN iam.users u ON u.userid = h.changedbyuserid
     WHERE h.taskid = $1
        OR h.taskid IN (SELECT taskid FROM work.tasks WHERE parenttaskid = $1 AND archivedatutc IS NULL)
     ORDER BY h.changedatutc ASC, h.taskstatushistoryid ASC`,
    [taskId]
  );
  return result.rows;
};

// How many of a project's tasks are finished. Counts top-level, non-archived tasks only — the
// exact same population project.repository.ts's getProjectProgress uses for the project's
// percentage, so "100% complete" and "project complete" can never disagree. Subtasks are
// excluded deliberately: a parent task cannot reach a completed state while its own subtasks are
// outstanding (see task.service.ts's syncParentFromSubtasks), so counting them would double-count
// the same work.
export const getProjectTaskCompletion = async (
  projectId: number
): Promise<{ total: number; completed: number }> => {
  const result = await query<{ total: string; completed: string }>(
    `SELECT COUNT(*)::text AS total,
            SUM(CASE WHEN ts.iscompletedstate THEN 1 ELSE 0 END)::text AS completed
       FROM work.tasks t
       JOIN work.taskstatuses ts ON ts.taskstatusid = t.taskstatusid
      WHERE t.projectid = $1 AND t.archivedatutc IS NULL AND t.parenttaskid IS NULL`,
    [projectId]
  );
  return {
    total: Number(result.rows[0]?.total || 0),
    completed: Number(result.rows[0]?.completed || 0)
  };
};

// When a task in this project most recently LEFT a completed state (a reopen, or a review
// rejection sending it back to In Progress). Read from the same work.TaskStatusHistory audit
// trail every status change already writes, so no extra bookkeeping is needed to answer
// "has this project stopped being finished since we last said it was finished?".
export const findLastProjectReopenTime = async (projectId: number): Promise<Date | null> => {
  const result = await query<{ lastreopened: Date | null }>(
    `SELECT MAX(h.changedatutc) AS lastreopened
       FROM work.taskstatushistory h
       JOIN work.tasks t ON t.taskid = h.taskid
       JOIN work.taskstatuses fs ON fs.taskstatusid = h.fromtaskstatusid
       JOIN work.taskstatuses ts ON ts.taskstatusid = h.totaskstatusid
      WHERE t.projectid = $1 AND fs.iscompletedstate AND NOT ts.iscompletedstate`,
    [projectId]
  );
  return result.rows[0]?.lastreopened || null;
};
