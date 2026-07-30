import { query, withTransaction } from '../db/pool.js';
import { MilestoneRow, ProjectFileRow, ProjectMemberRoleCode, ProjectMemberRow, ProjectRow } from './project.types.js';

// Repository = data access only (Repository Pattern, matching backend/src/notifications'
// layering). No recipient resolution, no authorization decisions here — those belong to
// project.service.ts. This file only knows how to read/write work.Projects/work.ProjectMembers
// (database/04_work_tables.sql), unmodified.

// Single-tenant app — every seed/notification file in this repo already hardcodes
// OrganizationId = 1 (see database/18_notify_seed.sql), so this does too rather than inventing
// multi-tenant plumbing nothing else in the codebase supports yet.
const ORGANIZATION_ID = 1;

const PROJECT_COLUMNS = `
  p.projectid, p.projectcode, p.projectname, p.description, p.owneruserid,
  ps.statuscode, pr.prioritycode, p.startdate::text, p.enddate::text,
  p.createdbyuserid, p.creationreason, p.archivedatutc, p.archivedbyuserid, p.archivereason,
  p.createdatutc, p.updatedatutc, p.rowversion
`;

const PROJECT_JOINS = `
  FROM work.projects p
  JOIN work.projectstatuses ps ON ps.projectstatusid = p.projectstatusid
  JOIN work.priorities pr ON pr.priorityid = p.priorityid
`;

const generateProjectCode = (): string => `PROJ-${Math.floor(100 + Math.random() * 900)}`;

export const getProjectStatusId = async (statusCode: string): Promise<number> => {
  const result = await query<{ projectstatusid: number }>(
    'SELECT projectstatusid FROM work.projectstatuses WHERE statuscode = $1',
    [statusCode]
  );
  if (!result.rows[0]) throw new Error(`Unknown project status code: "${statusCode}"`);
  return result.rows[0].projectstatusid;
};

export const getPriorityId = async (priorityCode: string): Promise<number> => {
  const result = await query<{ priorityid: number }>(
    'SELECT priorityid FROM work.priorities WHERE prioritycode = $1',
    [priorityCode]
  );
  if (!result.rows[0]) throw new Error(`Unknown priority code: "${priorityCode}"`);
  return result.rows[0].priorityid;
};

export const findAllProjects = async (): Promise<ProjectRow[]> => {
  const result = await query<ProjectRow>(`SELECT ${PROJECT_COLUMNS} ${PROJECT_JOINS} ORDER BY p.projectid`);
  return result.rows;
};

export const findProjectById = async (projectId: number): Promise<ProjectRow | null> => {
  const result = await query<ProjectRow>(
    `SELECT ${PROJECT_COLUMNS} ${PROJECT_JOINS} WHERE p.projectid = $1`,
    [projectId]
  );
  return result.rows[0] || null;
};

export const findMembersForProject = async (projectId: number): Promise<ProjectMemberRow[]> => {
  const result = await query<ProjectMemberRow>(
    `SELECT projectid, userid, memberrolecode
     FROM work.projectmembers
     WHERE projectid = $1 AND leftatutc IS NULL
     ORDER BY projectmemberid`,
    [projectId]
  );
  return result.rows;
};

export const findMilestonesForProject = async (projectId: number): Promise<MilestoneRow[]> => {
  const result = await query<MilestoneRow>(
    `SELECT milestoneid, projectid, milestonename, description,
            duedate::text, completedatutc, createdbyuserid, createdatutc
     FROM work.projectmilestones
     WHERE projectid = $1
     ORDER BY duedate, milestoneid`,
    [projectId]
  );
  return result.rows;
};

export const findProjectFiles = async (projectId: number): Promise<ProjectFileRow[]> => {
  const result = await query<ProjectFileRow>(
    `SELECT sf.fileid, sf.originalfilename, sf.mimetype, sf.sizebytes,
            sf.uploadedbyuserid, sf.uploadedatutc
     FROM collab.projectfiles pf
     JOIN collab.storedfiles sf ON sf.fileid = pf.fileid
     WHERE pf.projectid = $1 AND sf.isdeleted = FALSE
     ORDER BY pf.addedatutc`,
    [projectId]
  );
  return result.rows;
};

export const findMembersForProjects = async (projectIds: number[]): Promise<ProjectMemberRow[]> => {
  if (projectIds.length === 0) return [];
  const result = await query<ProjectMemberRow>(
    `SELECT projectid, userid, memberrolecode
     FROM work.projectmembers
     WHERE projectid = ANY($1::int[]) AND leftatutc IS NULL
     ORDER BY projectmemberid`,
    [projectIds]
  );
  return result.rows;
};

// Every project a user can see: they're the creator/owner, OR they have a live (non-left)
// ProjectMembers row (any role, including TeamLead/Member/Reviewer/Observer). Admin-level "see
// everything" is applied one level up in project.service.ts (not here — this repository never
// makes authorization decisions, matching the layering rule above).
export const findProjectsForUser = async (userId: number): Promise<ProjectRow[]> => {
  const result = await query<ProjectRow>(
    `SELECT ${PROJECT_COLUMNS} ${PROJECT_JOINS}
     WHERE p.owneruserid = $1
        OR EXISTS (
          SELECT 1 FROM work.projectmembers pm
          WHERE pm.projectid = p.projectid AND pm.userid = $1 AND pm.leftatutc IS NULL
        )
     ORDER BY p.projectid`,
    [userId]
  );
  return result.rows;
};

export interface CreateProjectRow {
  title: string;
  description: string;
  priorityId: number;
  statusId: number;
  startDate: string;
  targetDate: string;
  ownerUserId: number;
  createdByUserId: number;
  creationReason: string | null;
  teamLeadUserId?: number;
  memberUserIds: number[];
}

// Inserts the project row plus its TeamLead/Member ProjectMembers rows, atomically. The
// creator is always added as 'Owner' (schema requires OwnerUserId anyway); TeamLead and each
// member get their own ProjectMembers row so work.ProjectMembers is the single source of truth
// for "who can see this project," never derived from anywhere else.
export const insertProject = async (input: CreateProjectRow): Promise<number> =>
  withTransaction(async (runQuery) => {
    let projectCode = generateProjectCode();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const clash = await runQuery<{ projectid: number }>(
        'SELECT projectid FROM work.projects WHERE organizationid = $1 AND projectcode = $2',
        [ORGANIZATION_ID, projectCode]
      );
      if (clash.rows.length === 0) break;
      projectCode = generateProjectCode();
    }

    const inserted = await runQuery<{ projectid: number }>(
      `INSERT INTO work.projects
         (organizationid, projectcode, projectname, description, owneruserid, projectstatusid,
          priorityid, startdate, enddate, createdbyuserid, creationreason)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING projectid`,
      [
        ORGANIZATION_ID,
        projectCode,
        input.title,
        input.description,
        input.ownerUserId,
        input.statusId,
        input.priorityId,
        input.startDate,
        input.targetDate,
        input.createdByUserId,
        input.creationReason
      ]
    );
    const projectId = inserted.rows[0].projectid;

    await runQuery(
      `INSERT INTO work.projectmembers (projectid, userid, memberrolecode, addedbyuserid)
       VALUES ($1, $2, 'Owner', $2)`,
      [projectId, input.ownerUserId]
    );

    if (input.teamLeadUserId && input.teamLeadUserId !== input.ownerUserId) {
      await runQuery(
        `INSERT INTO work.projectmembers (projectid, userid, memberrolecode, addedbyuserid)
         VALUES ($1, $2, 'TeamLead', $3)`,
        [projectId, input.teamLeadUserId, input.createdByUserId]
      );
    }

    const uniqueMemberIds = Array.from(new Set(input.memberUserIds)).filter(
      (id) => id !== input.ownerUserId && id !== input.teamLeadUserId
    );
    for (const memberId of uniqueMemberIds) {
      await runQuery(
        `INSERT INTO work.projectmembers (projectid, userid, memberrolecode, addedbyuserid)
         VALUES ($1, $2, 'Member', $3)`,
        [projectId, memberId, input.createdByUserId]
      );
    }

    return projectId;
  });

export interface UpdateProjectRow {
  title?: string;
  description?: string;
  priorityId?: number;
  statusId?: number;
  startDate?: string;
  targetDate?: string;
  creationReason?: string;
}

export const updateProject = async (projectId: number, updates: UpdateProjectRow): Promise<boolean> => {
  const setClauses: string[] = [];
  const params: unknown[] = [];

  const addSet = (column: string, value: unknown) => {
    params.push(value);
    setClauses.push(`${column} = $${params.length}`);
  };

  if (updates.title !== undefined) addSet('projectname', updates.title);
  if (updates.description !== undefined) addSet('description', updates.description);
  if (updates.priorityId !== undefined) addSet('priorityid', updates.priorityId);
  if (updates.statusId !== undefined) addSet('projectstatusid', updates.statusId);
  if (updates.startDate !== undefined) addSet('startdate', updates.startDate);
  if (updates.targetDate !== undefined) addSet('enddate', updates.targetDate);
  if (updates.creationReason !== undefined) addSet('creationreason', updates.creationReason);

  if (setClauses.length === 0) return true;

  setClauses.push('updatedatutc = CURRENT_TIMESTAMP');
  setClauses.push(`rowversion = rowversion + 1`);
  params.push(projectId);

  const result = await query(
    `UPDATE work.projects SET ${setClauses.join(', ')} WHERE projectid = $${params.length}`,
    params
  );
  return (result.rowCount ?? 0) > 0;
};

// Soft-delete (archive), matching the schema's CK_Projects_Archive constraint shape (all three
// archive fields set together or not at all) — never a hard DELETE, same "preserve the audit
// trail" pattern the Notification Module already uses for clearing a notification.
export const archiveProject = async (
  projectId: number,
  archivedByUserId: number,
  archiveReason: string
): Promise<boolean> => {
  const statusId = await getProjectStatusId('Archived');
  const result = await query(
    `UPDATE work.projects
     SET projectstatusid = $1, archivedatutc = CURRENT_TIMESTAMP, archivedbyuserid = $2,
         archivereason = $3, updatedatutc = CURRENT_TIMESTAMP, rowversion = rowversion + 1
     WHERE projectid = $4 AND archivedatutc IS NULL`,
    [statusId, archivedByUserId, archiveReason, projectId]
  );
  return (result.rowCount ?? 0) > 0;
};

export const addProjectMember = async (
  projectId: number,
  userId: number,
  roleCode: ProjectMemberRoleCode,
  addedByUserId: number
): Promise<void> => {
  const existing = await query(
    'SELECT 1 FROM work.projectmembers WHERE projectid = $1 AND userid = $2 AND leftatutc IS NULL',
    [projectId, userId]
  );
  if (existing.rows.length > 0) return; // already an active member — idempotent no-op

  await query(
    `INSERT INTO work.projectmembers (projectid, userid, memberrolecode, addedbyuserid)
     VALUES ($1, $2, $3, $4)`,
    [projectId, userId, roleCode, addedByUserId]
  );
};

// Derived, not stored (see project.mapper.ts's note on `progress`) — % of the project's tasks
// whose TaskStatuses.IsCompletedState is true. 0 for a project with no tasks yet rather than
// dividing by zero.
export const getProjectProgress = async (projectId: number): Promise<number> => {
  const result = await query<{ total: string; completed: string }>(
    `SELECT
       COUNT(*)::text AS total,
       SUM(CASE WHEN ts.iscompletedstate THEN 1 ELSE 0 END)::text AS completed
     FROM work.tasks t
      JOIN work.taskstatuses ts ON ts.taskstatusid = t.taskstatusid
      WHERE t.projectid = $1 AND t.archivedatutc IS NULL AND t.parenttaskid IS NULL`,
    [projectId]
  );
  const total = Number(result.rows[0]?.total || 0);
  const completed = Number(result.rows[0]?.completed || 0);
  return total > 0 ? Math.round((completed / total) * 100) : 0;
};

export const removeProjectMember = async (
  projectId: number,
  userId: number,
  removedByUserId: number,
  removalReason: string
): Promise<boolean> => {
  const result = await query(
    `UPDATE work.projectmembers
     SET leftatutc = CURRENT_TIMESTAMP, removedbyuserid = $1, removalreason = $2
     WHERE projectid = $3 AND userid = $4 AND leftatutc IS NULL`,
    [removedByUserId, removalReason, projectId, userId]
  );
  return (result.rowCount ?? 0) > 0;
};

// Reassigns a project's Team Lead. TeamLead is a ProjectMembers role, not a projects-table
// column, so unlike the plain fields in updateProject() this needs its own statements: demote
// whichever row (if any) currently holds 'TeamLead' -- a no-op when the current lead is only
// implicit via ownership, per resolveTeamLeadUserId's owner-fallback -- then promote the new
// lead's existing row, or insert one if they weren't already an active member. Skips the
// promote step when the new lead is the project owner, matching insertProject's own rule that
// the owner never gets a redundant 'TeamLead' row.
export const reassignTeamLead = async (
  projectId: number,
  newTeamLeadUserId: number,
  ownerUserId: number,
  addedByUserId: number
): Promise<void> => {
  await query(
    `UPDATE work.projectmembers
     SET memberrolecode = 'Member'
     WHERE projectid = $1 AND memberrolecode = 'TeamLead' AND leftatutc IS NULL AND userid != $2`,
    [projectId, newTeamLeadUserId]
  );

  if (newTeamLeadUserId === ownerUserId) return;

  const promoted = await query(
    `UPDATE work.projectmembers
     SET memberrolecode = 'TeamLead'
     WHERE projectid = $1 AND userid = $2 AND leftatutc IS NULL`,
    [projectId, newTeamLeadUserId]
  );
  if ((promoted.rowCount ?? 0) === 0) {
    await query(
      `INSERT INTO work.projectmembers (projectid, userid, memberrolecode, addedbyuserid)
       VALUES ($1, $2, 'TeamLead', $3)`,
      [projectId, newTeamLeadUserId, addedByUserId]
    );
  }
};
