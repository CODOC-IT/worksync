import { query, withTransaction } from '../db/pool.js';
import { getPriorityId } from '../projects/project.repository.js';
import { TaskAssigneeRow, TaskRow, TaskStatusHistoryRow } from './task.types.js';

export { getPriorityId };

const TASK_COLUMNS = `
  t.taskid, t.projectid, t.parenttaskid, t.tasknumber, t.title, t.description,
  ts.statuscode, pr.prioritycode, t.startdate::text, t.duedate::text,
  t.createdbyuserid, t.completedatutc, t.completionsummary, t.archivedatutc,
  t.createdatutc, t.updatedatutc, t.rowversion, p.projectcode,
  (SELECT COUNT(*)::int FROM work.tasks st WHERE st.parenttaskid = t.taskid AND st.archivedatutc IS NULL) AS subtaskcount
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
    `SELECT ${TASK_COLUMNS} ${TASK_JOINS} WHERE t.parenttaskid IS NULL AND t.archivedatutc IS NULL ORDER BY t.taskid`
  );
  return result.rows;
};

export const findTasksForProject = async (projectId: number): Promise<TaskRow[]> => {
  const result = await query<TaskRow>(
    `SELECT ${TASK_COLUMNS} ${TASK_JOINS} WHERE t.projectid = $1 AND t.parenttaskid IS NULL AND t.archivedatutc IS NULL ORDER BY t.taskid`,
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
}

const insertTaskWithQuery = async (runQuery: typeof query, input: InsertTaskRow): Promise<number> => {
    const taskNumber = await getNextTaskNumber(runQuery, input.projectId);

    const inserted = await runQuery<{ taskid: number }>(
      `INSERT INTO work.tasks
         (projectid, parenttaskid, tasknumber, title, description, taskstatusid, priorityid, startdate,
          duedate, createdbyuserid)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
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
        input.createdByUserId
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
     ORDER BY h.changedatutc ASC, h.taskstatushistoryid ASC`,
    [taskId]
  );
  return result.rows;
};
