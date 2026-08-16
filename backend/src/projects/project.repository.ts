import { query, withTransaction } from '../db/pool.js';
import {
  MilestoneRow,
  ProjectFileRow,
  ProjectMemberRoleCode,
  ProjectMemberRow,
  ProjectRow,
  ProjectTeamRow,
  TeamMemberRow
} from './project.types.js';
import { parseAttachmentDataUrl, writeAttachmentToDisk } from '../collab/fileStorage.js';

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

const MEMBER_COLUMNS = `
  projectid, userid, memberrolecode, pendingremovalatutc, pendingremovalbyuserid, pendingremovalreason
`;

export const findMembersForProject = async (projectId: number): Promise<ProjectMemberRow[]> => {
  const result = await query<ProjectMemberRow>(
    `SELECT ${MEMBER_COLUMNS}
     FROM work.projectmembers
     WHERE projectid = $1 AND leftatutc IS NULL
     ORDER BY projectmemberid`,
    [projectId]
  );
  return result.rows;
};

// --- Team layer (multi-team architecture) ------------------------------------------------

const TEAM_COLUMNS = `teamid, projectid, teamname, description, createdbyuserid`;
const TEAM_MEMBER_COLUMNS = `teamid, projectid, userid, islead`;

export const findTeamsForProject = async (projectId: number): Promise<ProjectTeamRow[]> => {
  const result = await query<ProjectTeamRow>(
    `SELECT ${TEAM_COLUMNS} FROM work.projectteams WHERE projectid = $1 ORDER BY teamid`,
    [projectId]
  );
  return result.rows;
};

// Only active (LeftAtUtc IS NULL) team memberships, mirroring findMembersForProject.
export const findTeamMembersForProject = async (projectId: number): Promise<TeamMemberRow[]> => {
  const result = await query<TeamMemberRow>(
    `SELECT ${TEAM_MEMBER_COLUMNS}
     FROM work.teammembers
     WHERE projectid = $1 AND leftatutc IS NULL
     ORDER BY teammemberid`,
    [projectId]
  );
  return result.rows;
};

export const findTeamById = async (teamId: number): Promise<ProjectTeamRow | null> => {
  const result = await query<ProjectTeamRow>(
    `SELECT ${TEAM_COLUMNS} FROM work.projectteams WHERE teamid = $1`,
    [teamId]
  );
  return result.rows[0] || null;
};

export const findTeamMembersForTeam = async (teamId: number): Promise<TeamMemberRow[]> => {
  const result = await query<TeamMemberRow>(
    `SELECT ${TEAM_MEMBER_COLUMNS}
     FROM work.teammembers
     WHERE teamid = $1 AND leftatutc IS NULL
     ORDER BY teammemberid`,
    [teamId]
  );
  return result.rows;
};

// Batched sibling of findTeamsForProject/findTeamMembersForProject for the project-list endpoint
// (mirrors findMembersForProjects) so a list never N+1's per project.
export const findTeamsForProjects = async (projectIds: number[]): Promise<ProjectTeamRow[]> => {
  if (projectIds.length === 0) return [];
  const result = await query<ProjectTeamRow>(
    `SELECT ${TEAM_COLUMNS}
     FROM work.projectteams
     WHERE projectid = ANY($1::int[])
     ORDER BY projectid, teamid`,
    [projectIds]
  );
  return result.rows;
};

export const findTeamMembersForProjects = async (projectIds: number[]): Promise<TeamMemberRow[]> => {
  if (projectIds.length === 0) return [];
  const result = await query<TeamMemberRow>(
    `SELECT ${TEAM_MEMBER_COLUMNS}
     FROM work.teammembers
     WHERE projectid = ANY($1::int[]) AND leftatutc IS NULL
     ORDER BY projectid, teamid`,
    [projectIds]
  );
  return result.rows;
};

export interface InsertTeamRow {
  name: string;
  description: string;
  leadId: number;
  memberIds: number[];
}

// Inserts one team plus its TeamMember rows (exactly one lead + the other members) inside the
// caller's transaction. Callers must have already validated the team setup (>= 2 people, one lead,
// no duplicate cross-team membership) -- this only writes.
export const insertTeam = async (
  runQuery: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>,
  projectId: number,
  team: InsertTeamRow,
  addedByUserId: number
): Promise<number> => {
  const inserted = await runQuery(
    `INSERT INTO work.projectteams (projectid, teamname, description, createdbyuserid)
     VALUES ($1, $2, $3, $4) RETURNING teamid`,
    [projectId, team.name, team.description, addedByUserId]
  );
  const teamId = Number(inserted.rows[0].teamid);

  const uniqueMemberIds = Array.from(new Set([...team.memberIds, team.leadId]));
  for (const userId of uniqueMemberIds) {
    await runQuery(
      `INSERT INTO work.teammembers (teamid, projectid, userid, islead, addedbyuserid)
       VALUES ($1, $2, $3, $4, $5)`,
      [teamId, projectId, userId, userId === team.leadId, addedByUserId]
    );
  }
  return teamId;
};

// Admin moving a project member from one team to another. The member keeps their ProjectMembers
// row (they stay in the project); their TeamMembers row moves to the target team and loses any
// lead flag (a moved lead becomes a regular member of their new team -- promoting them again is
// replaceTeamLead's job). Returns false if the user isn't currently in any team of this project.
export const moveTeamMember = async (
  projectId: number,
  userId: number,
  toTeamId: number,
  actorId: number
): Promise<boolean> =>
  withTransaction(async (runQuery) => {
    const current = await runQuery<{ teammemberid: number; islead: boolean }>(
      `SELECT teammemberid, islead
       FROM work.teammembers
       WHERE projectid = $1 AND userid = $2 AND leftatutc IS NULL`,
      [projectId, userId]
    );
    if (current.rows.length === 0) return false;
    const { teammemberid, islead } = current.rows[0];

    await runQuery(
      `UPDATE work.teammembers SET teamid = $1, islead = FALSE WHERE teammemberid = $2`,
      [toTeamId, teammemberid]
    );
    if (islead) {
      await runQuery(
        `UPDATE work.projectmembers SET memberrolecode = 'Member'
         WHERE projectid = $1 AND userid = $2 AND leftatutc IS NULL`,
        [projectId, userId]
      );
    }
    return true;
  });

// Admin replacing a team's lead. The outgoing lead stays in the team as a regular member; the new
// lead must already be a project member (addMember handles joining the project) and becomes the
// team's lead. ProjectMembers roles follow: new lead -> 'TeamLead', old lead -> 'Member'.
export const replaceTeamLead = async (
  projectId: number,
  teamId: number,
  oldLeadId: number,
  newLeadId: number,
  actorId: number
): Promise<boolean> =>
  withTransaction(async (runQuery) => {
    await runQuery(
      `UPDATE work.teammembers SET islead = FALSE
       WHERE teamid = $1 AND userid = $2 AND leftatutc IS NULL`,
      [teamId, oldLeadId]
    );
    const existing = await runQuery<{ teammemberid: number }>(
      `SELECT teammemberid FROM work.teammembers
       WHERE teamid = $1 AND userid = $2 AND leftatutc IS NULL`,
      [teamId, newLeadId]
    );
    if (existing.rows.length === 0) {
      await runQuery(
        `INSERT INTO work.teammembers (teamid, projectid, userid, islead, addedbyuserid)
         VALUES ($1, $2, $3, TRUE, $4)`,
        [teamId, projectId, newLeadId, actorId]
      );
    } else {
      await runQuery(
        `UPDATE work.teammembers SET islead = TRUE WHERE teammemberid = $1`,
        [existing.rows[0].teammemberid]
      );
    }
    await runQuery(
      `UPDATE work.projectmembers SET memberrolecode = 'TeamLead'
       WHERE projectid = $1 AND userid = $2 AND leftatutc IS NULL`,
      [projectId, newLeadId]
    );
    await runQuery(
      `UPDATE work.projectmembers SET memberrolecode = 'Member'
       WHERE projectid = $1 AND userid = $2 AND leftatutc IS NULL`,
      [projectId, oldLeadId]
    );
    return true;
  });

const MILESTONE_COLUMNS = `
  milestoneid, projectid, milestonename, description, duedate::text, completedatutc,
  createdbyuserid, createdatutc
`;

export const findMilestonesForProject = async (projectId: number): Promise<MilestoneRow[]> => {
  const result = await query<MilestoneRow>(
    `SELECT ${MILESTONE_COLUMNS}
     FROM work.projectmilestones
     WHERE projectid = $1
     ORDER BY duedate, milestoneid`,
    [projectId]
  );
  return result.rows;
};

export interface ProjectTaskDateRow {
  tasknumber: string;
  title: string;
  startdate: string;
  duedate: string;
}

// Date-scope checks deliberately include subtasks: they live in the same work.Tasks table and
// are just as much part of the project's schedule as their parent task.
export const findActiveTaskDatesForProject = async (projectId: number): Promise<ProjectTaskDateRow[]> => {
  const result = await query<ProjectTaskDateRow>(
    `SELECT tasknumber, title, startdate::text, duedate::text
       FROM work.tasks
      WHERE projectid = $1 AND archivedatutc IS NULL
      ORDER BY taskid`,
    [projectId]
  );
  return result.rows;
};

// Batched sibling of findMilestonesForProject, mirroring findMembersForProjects above -- lets
// the project list endpoint include real milestone data (the Calendar's source for Milestone
// entries, see frontend/.../calendarRules.ts#buildCalendarEntries) without an N+1 query per
// project.
export const findMilestonesForProjects = async (projectIds: number[]): Promise<MilestoneRow[]> => {
  if (projectIds.length === 0) return [];
  const result = await query<MilestoneRow>(
    `SELECT ${MILESTONE_COLUMNS}
     FROM work.projectmilestones
     WHERE projectid = ANY($1::int[])
     ORDER BY duedate, milestoneid`,
    [projectIds]
  );
  return result.rows;
};

export const findMilestoneById = async (milestoneId: number): Promise<MilestoneRow | null> => {
  const result = await query<MilestoneRow>(
    `SELECT ${MILESTONE_COLUMNS} FROM work.projectmilestones WHERE milestoneid = $1`,
    [milestoneId]
  );
  return result.rows[0] || null;
};

export interface InsertMilestoneRow {
  projectId: number;
  title: string;
  description: string | null;
  dueDate: string;
  createdByUserId: number;
}

export const insertMilestone = async (input: InsertMilestoneRow): Promise<number> => {
  const result = await query<{ milestoneid: number }>(
    `INSERT INTO work.projectmilestones (projectid, milestonename, description, duedate, createdbyuserid)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING milestoneid`,
    [input.projectId, input.title, input.description, input.dueDate, input.createdByUserId]
  );
  return result.rows[0].milestoneid;
};

export interface UpdateMilestoneRow {
  title?: string;
  description?: string | null;
  dueDate?: string;
}

// Scoped to (milestoneId, projectId) together -- like updateProject's own field-updater below --
// so an id belonging to a different project can never be updated through this project's endpoint.
export const updateMilestone = async (
  milestoneId: number,
  projectId: number,
  updates: UpdateMilestoneRow
): Promise<boolean> => {
  const setClauses: string[] = [];
  const params: unknown[] = [];

  const addSet = (column: string, value: unknown) => {
    params.push(value);
    setClauses.push(`${column} = $${params.length}`);
  };

  if (updates.title !== undefined) addSet('milestonename', updates.title);
  if (updates.description !== undefined) addSet('description', updates.description);
  if (updates.dueDate !== undefined) addSet('duedate', updates.dueDate);

  if (setClauses.length === 0) return true;

  setClauses.push('updatedatutc = CURRENT_TIMESTAMP');
  setClauses.push('rowversion = rowversion + 1');
  params.push(milestoneId, projectId);

  const result = await query(
    `UPDATE work.projectmilestones SET ${setClauses.join(', ')}
     WHERE milestoneid = $${params.length - 1} AND projectid = $${params.length}`,
    params
  );
  return (result.rowCount ?? 0) > 0;
};

export const deleteMilestone = async (milestoneId: number, projectId: number): Promise<boolean> => {
  const result = await query(
    'DELETE FROM work.projectmilestones WHERE milestoneid = $1 AND projectid = $2',
    [milestoneId, projectId]
  );
  return (result.rowCount ?? 0) > 0;
};

const PROJECT_FILE_COLUMNS = `
  sf.fileid, sf.originalfilename, sf.mimetype, sf.sizebytes, sf.uploadedbyuserid, sf.uploadedatutc,
  sf.storageobjectkey
`;

export const findProjectFiles = async (projectId: number): Promise<ProjectFileRow[]> => {
  const result = await query<ProjectFileRow>(
    `SELECT ${PROJECT_FILE_COLUMNS}
     FROM collab.projectfiles pf
     JOIN collab.storedfiles sf ON sf.fileid = pf.fileid
     WHERE pf.projectid = $1 AND sf.isdeleted = FALSE
     ORDER BY pf.addedatutc`,
    [projectId]
  );
  return result.rows;
};

export const findProjectFileById = async (projectId: number, fileId: number): Promise<ProjectFileRow | null> => {
  const result = await query<ProjectFileRow>(
    `SELECT ${PROJECT_FILE_COLUMNS}
     FROM collab.projectfiles pf
     JOIN collab.storedfiles sf ON sf.fileid = pf.fileid
     WHERE pf.projectid = $1 AND pf.fileid = $2 AND sf.isdeleted = FALSE`,
    [projectId, fileId]
  );
  return result.rows[0] || null;
};

export interface InsertProjectFileInput {
  projectId: number;
  uploadedByUserId: number;
  originalFileName: string;
  mimeType: string;
  dataUrl: string;
}

// Mirrors discussion.repository.ts's upsertStoredFile/linkCommentFiles exactly (same
// content-addressed storage, same ON CONFLICT upsert-and-return trick) -- collab.StoredFiles is
// shared storage, not project-owned, so this reuses it rather than inventing a second copy.
export const insertProjectFile = async (input: InsertProjectFileInput): Promise<number> =>
  withTransaction(async (runQuery) => {
    const parsed = parseAttachmentDataUrl(input.dataUrl);
    if (!parsed) {
      throw new Error(`Attachment "${input.originalFileName}" has no readable content to store.`);
    }
    const written = await writeAttachmentToDisk(parsed.buffer, parsed.mimeType);
    const extension = input.originalFileName.includes('.') ? input.originalFileName.split('.').pop()! : null;

    // ScanStatus stays 'Pending' -- this app has no virus-scanning pipeline (same rationale as
    // discussion.repository.ts's upsertStoredFile).
    const stored = await runQuery<{ fileid: number }>(
      `INSERT INTO collab.storedfiles
         (organizationid, uploadedbyuserid, originalfilename, storageobjectkey, mimetype, fileextension,
          sizebytes, sha256hash, scanstatus)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'Pending')
       ON CONFLICT (storageobjectkey) DO UPDATE SET storageobjectkey = EXCLUDED.storageobjectkey
       RETURNING fileid`,
      [
        ORGANIZATION_ID,
        input.uploadedByUserId,
        input.originalFileName,
        written.storageObjectKey,
        input.mimeType,
        extension,
        written.sizeBytes,
        Buffer.from(written.sha256Hex, 'hex')
      ]
    );
    const fileId = stored.rows[0].fileid;

    await runQuery(
      `INSERT INTO collab.projectfiles (projectid, fileid, addedbyuserid)
       VALUES ($1, $2, $3)
       ON CONFLICT (projectid, fileid) DO NOTHING`,
      [input.projectId, fileId, input.uploadedByUserId]
    );

    return fileId;
  });

// Unlinks the file from this project only -- collab.StoredFiles itself is left alone (same as
// permanentlyDeleteProject's own cascade below), since the same content-addressed row could still
// be referenced by a Project Chat comment or another project.
export const removeProjectFile = async (projectId: number, fileId: number): Promise<boolean> => {
  const result = await query(
    'DELETE FROM collab.projectfiles WHERE projectid = $1 AND fileid = $2',
    [projectId, fileId]
  );
  return (result.rowCount ?? 0) > 0;
};

export const findMembersForProjects = async (projectIds: number[]): Promise<ProjectMemberRow[]> => {
  if (projectIds.length === 0) return [];
  const result = await query<ProjectMemberRow>(
    `SELECT ${MEMBER_COLUMNS}
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
  // All team leads when the project uses the multi-team architecture (overrides teamLeadUserId
  // when present). Each gets a 'TeamLead' ProjectMembers row.
  teamLeadUserIds?: number[];
  memberUserIds: number[];
  // Complete team setup (multi-team architecture). When present, each team's rows are written
  // after the project members; teamLeadUserId/memberUserIds must already reflect the flattened
  // union of all team leads and members so work.ProjectMembers stays the access-control source.
  teams?: InsertTeamRow[];
  // False when the creator is an Admin: the project row still records them as OwnerUserId, but
  // no 'Owner' ProjectMembers row is written, so the Admin isn't listed as a project member
  // (Admins have org-wide access anyway). A Team Member/Lead creator always gets the row.
  includeOwnerMembership?: boolean;
}

// Inserts the project row plus its TeamLead/Member ProjectMembers rows, atomically. The
// creator is added as 'Owner' unless includeOwnerMembership is false (an Admin creator — see
// createProject); schema requires OwnerUserId on the project row regardless. TeamLead and each
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

    if (input.includeOwnerMembership !== false) {
      await runQuery(
        `INSERT INTO work.projectmembers (projectid, userid, memberrolecode, addedbyuserid)
         VALUES ($1, $2, 'Owner', $2)`,
        [projectId, input.ownerUserId]
      );
    }

    const leadIds = input.teamLeadUserIds
      ? Array.from(new Set(input.teamLeadUserIds))
      : input.teamLeadUserId
        ? [input.teamLeadUserId]
        : [];
    for (const leadId of leadIds) {
      if (leadId !== input.ownerUserId) {
        await runQuery(
          `INSERT INTO work.projectmembers (projectid, userid, memberrolecode, addedbyuserid)
           VALUES ($1, $2, 'TeamLead', $3)`,
          [projectId, leadId, input.createdByUserId]
        );
      }
    }

    const uniqueMemberIds = Array.from(new Set(input.memberUserIds)).filter(
      (id) => id !== input.ownerUserId && !leadIds.includes(id)
    );
    for (const memberId of uniqueMemberIds) {
      await runQuery(
        `INSERT INTO work.projectmembers (projectid, userid, memberrolecode, addedbyuserid)
         VALUES ($1, $2, 'Member', $3)`,
        [projectId, memberId, input.createdByUserId]
      );
    }

    if (input.teams && input.teams.length > 0) {
      for (const team of input.teams) {
        await insertTeam(runQuery, projectId, team, input.createdByUserId);
      }
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
  return withTransaction(async (runQuery) => {
    const result = await runQuery(
      `UPDATE work.projects
       SET projectstatusid = $1, archivedatutc = CURRENT_TIMESTAMP, archivedbyuserid = $2,
           archivereason = $3, updatedatutc = CURRENT_TIMESTAMP, rowversion = rowversion + 1
       WHERE projectid = $4 AND archivedatutc IS NULL`,
      [statusId, archivedByUserId, archiveReason, projectId]
    );
    if ((result.rowCount ?? 0) === 0) return false;

    await runQuery(
      `UPDATE work.tasks
       SET projectarchivedatutc = CURRENT_TIMESTAMP, updatedatutc = CURRENT_TIMESTAMP,
           rowversion = rowversion + 1
       WHERE projectid = $1 AND archivedatutc IS NULL AND projectarchivedatutc IS NULL`,
      [projectId]
    );
    return true;
  });
};

// Hard delete for an already-archived project. Its tasks, calendar events, and every other
// project-owned operational row are removed in the same transaction; the project record itself
// is deleted last. Notifications/AI generations keep their historical content but lose the
// nullable live project/task link, rather than being deleted outright -- both tables are activity
// logs of things that happened, not project-owned working data, so their rows outlive the project
// the same way an audit trail would (see the AuditEvents note just below). Immutable audit rows
// retain historical ids; the task and project audit FKs are intentionally relaxed by database/24
// and database/25.
//
// AuditEvents rows are never touched, deleted, or modified -- audit.AuditEvents has a
// BEFORE UPDATE OR DELETE trigger (database/22_audit_enhancements.sql) that rejects any mutation
// unconditionally, including one issued by a FK referential action, so nulling ProjectId there is
// not possible without violating audit immutability. Instead, FK_AuditEvents_Project was dropped
// (database/24_audit_project_fk_relax.sql) -- a permanently-deleted project's audit history simply
// keeps its now-historical ProjectId value forever, exactly as it was written.
export const permanentlyDeleteProject = async (
  projectId: number,
  options: { allowUnarchived?: boolean } = {}
): Promise<boolean> =>
  withTransaction(async (runQuery) => {
    await runQuery(
      `UPDATE notify.notifications
       SET taskid = NULL, changerequestid = NULL
       WHERE taskid IN (SELECT taskid FROM work.tasks WHERE projectid = $1)
          OR changerequestid IN (
            SELECT cr.changerequestid
            FROM work.taskchangerequests cr
            JOIN work.tasks t ON t.taskid = cr.taskid
            WHERE t.projectid = $1
          )`,
      [projectId]
    );
    // Project-level AI activity is a historical usage log (same treatment as Notifications just
    // above), not project-owned working data, so it's detached (ProjectId/TaskId nulled) rather
    // than deleted -- unlike Calendar Events below, which the project genuinely owns.
    await runQuery(
      `UPDATE ai.promptgenerations
       SET taskid = NULL, projectid = NULL
       WHERE projectid = $1
          OR taskid IN (SELECT taskid FROM work.tasks WHERE projectid = $1)`,
      [projectId]
    );

    // Calendar Events are project-owned data (unlike Notifications/AI activity, which are
    // historical logs) -- FK_EventAttendees_Event cascades from calendar.Events, so deleting the
    // events here also removes their attendee rows automatically.
    await runQuery('DELETE FROM calendar.events WHERE projectid = $1', [projectId]);

    // Project-level (Project Chat, ThreadType='Project', DiscussionThreads.ProjectId set directly
    // -- see discussion.repository.ts) discussions cannot survive without their project either,
    // same as task/change-request discussions below -- FK_DiscussionThreads_Project has no ON
    // DELETE CASCADE, so leaving these out made the final DELETE FROM work.projects below fail
    // with a 23503 for any project that had ever had a Project Chat message, which is the
    // ordinary case, not an edge case. Delete comments first; mention/file links cascade from
    // comments through their existing FKs.
    await runQuery(
      `DELETE FROM collab.comments
       WHERE threadid IN (
         SELECT dt.threadid
         FROM collab.discussionthreads dt
         WHERE dt.projectid = $1
            OR dt.taskid IN (SELECT taskid FROM work.tasks WHERE projectid = $1)
            OR dt.changerequestid IN (
              SELECT cr.changerequestid
              FROM work.taskchangerequests cr
              JOIN work.tasks t ON t.taskid = cr.taskid
              WHERE t.projectid = $1
            )
       )`,
      [projectId]
    );
    await runQuery(
      `DELETE FROM collab.discussionthreads
       WHERE projectid = $1
          OR taskid IN (SELECT taskid FROM work.tasks WHERE projectid = $1)
          OR changerequestid IN (
            SELECT cr.changerequestid
            FROM work.taskchangerequests cr
            JOIN work.tasks t ON t.taskid = cr.taskid
            WHERE t.projectid = $1
          )`,
      [projectId]
    );

    await runQuery(
      `DELETE FROM work.changerequestreviews
       WHERE changerequestid IN (
         SELECT cr.changerequestid
         FROM work.taskchangerequests cr
         JOIN work.tasks t ON t.taskid = cr.taskid
         WHERE t.projectid = $1
       )`,
      [projectId]
    );
    await runQuery(
      `DELETE FROM work.taskchangerequestitems
       WHERE changerequestid IN (
         SELECT cr.changerequestid
         FROM work.taskchangerequests cr
         JOIN work.tasks t ON t.taskid = cr.taskid
         WHERE t.projectid = $1
       )`,
      [projectId]
    );
    await runQuery(
      `DELETE FROM work.taskchangerequests
       WHERE taskid IN (SELECT taskid FROM work.tasks WHERE projectid = $1)`,
      [projectId]
    );

    await runQuery(
      `DELETE FROM work.taskdependencies
       WHERE taskid IN (SELECT taskid FROM work.tasks WHERE projectid = $1)
          OR dependsontaskid IN (SELECT taskid FROM work.tasks WHERE projectid = $1)`,
      [projectId]
    );
    await runQuery(
      'DELETE FROM work.taskassignees WHERE taskid IN (SELECT taskid FROM work.tasks WHERE projectid = $1)',
      [projectId]
    );
    await runQuery(
      'DELETE FROM work.taskacceptancecriteria WHERE taskid IN (SELECT taskid FROM work.tasks WHERE projectid = $1)',
      [projectId]
    );
    await runQuery(
      'DELETE FROM work.taskstatushistory WHERE taskid IN (SELECT taskid FROM work.tasks WHERE projectid = $1)',
      [projectId]
    );
    await runQuery(
      'DELETE FROM work.taskblockers WHERE taskid IN (SELECT taskid FROM work.tasks WHERE projectid = $1)',
      [projectId]
    );
    await runQuery(
      'DELETE FROM collab.taskfiles WHERE taskid IN (SELECT taskid FROM work.tasks WHERE projectid = $1)',
      [projectId]
    );

    // Break the self-reference before deleting every task/subtask in one statement.
    await runQuery('UPDATE work.tasks SET parenttaskid = NULL WHERE projectid = $1', [projectId]);
    await runQuery('DELETE FROM work.tasks WHERE projectid = $1', [projectId]);

    await runQuery('DELETE FROM work.projectmembers WHERE projectid = $1', [projectId]);
    await runQuery('DELETE FROM work.projectmilestones WHERE projectid = $1', [projectId]);
    await runQuery('DELETE FROM work.projectreviewerdesignations WHERE projectid = $1', [projectId]);
    await runQuery('DELETE FROM collab.projectfiles WHERE projectid = $1', [projectId]);
    await runQuery('DELETE FROM iam.teamleadprojectscopes WHERE projectid = $1', [projectId]);
    await runQuery('UPDATE notify.notifications SET projectid = NULL WHERE projectid = $1', [projectId]);

    const result = await runQuery(
      `DELETE FROM work.projects
       WHERE projectid = $1
         AND ($2::boolean OR archivedatutc IS NOT NULL)`,
      [projectId, options.allowUnarchived === true]
    );
    return (result.rowCount ?? 0) > 0;
  });

// Restores an Archived project back to Active. Symmetric counterpart to archiveProject just
// above: same idempotency guard shape (WHERE ArchivedAtUtc IS NOT NULL here, vs IS NULL there),
// and clears ArchivedAtUtc/ArchivedByUserId/ArchiveReason together to satisfy CK_Projects_Archive
// -- the constraint only enforces those three fields' internal consistency, not their
// relationship to ProjectStatusId, so leaving them set would make a later archiveProject() call
// silently no-op on an Active project.
export const restoreProject = async (projectId: number): Promise<boolean> => {
  const statusId = await getProjectStatusId('Active');
  return withTransaction(async (runQuery) => {
    const result = await runQuery(
      `UPDATE work.projects
       SET projectstatusid = $1, archivedatutc = NULL, archivedbyuserid = NULL, archivereason = NULL,
           updatedatutc = CURRENT_TIMESTAMP, rowversion = rowversion + 1
       WHERE projectid = $2 AND archivedatutc IS NOT NULL`,
      [statusId, projectId]
    );
    if ((result.rowCount ?? 0) === 0) return false;

    await runQuery(
      `UPDATE work.tasks
       SET projectarchivedatutc = NULL, updatedatutc = CURRENT_TIMESTAMP,
           rowversion = rowversion + 1
       WHERE projectid = $1 AND projectarchivedatutc IS NOT NULL`,
      [projectId]
    );
    return true;
  });
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

// This is the single place a member's project membership is ever actually ended -- both an
// immediate removal (no active work) and a deferred one (project.service.ts's
// recheckPendingRemovalForMember, once a Pending Removal member's active work clears) call this
// same function. Closing their active work.TeamMembers row (if any) in the same transaction keeps
// the two lifecycles in lockstep: a member who's genuinely gone from the project must not keep
// appearing as an active team member in ProjectDTO.teams (project.mapper.ts's buildTeamDTOs only
// filters on TeamMembers.LeftAtUtc). A member merely flagged Pending Removal never reaches this
// function at all (see flagMemberPendingRemoval below), so their team membership correctly stays
// untouched while their work is still outstanding.
export const removeProjectMember = async (
  projectId: number,
  userId: number,
  removedByUserId: number,
  removalReason: string
): Promise<boolean> =>
  withTransaction(async (runQuery) => {
    const result = await runQuery(
      `UPDATE work.projectmembers
       SET leftatutc = CURRENT_TIMESTAMP, removedbyuserid = $1, removalreason = $2
       WHERE projectid = $3 AND userid = $4 AND leftatutc IS NULL`,
      [removedByUserId, removalReason, projectId, userId]
    );
    if ((result.rowCount ?? 0) === 0) return false;

    await runQuery(
      `UPDATE work.teammembers
       SET leftatutc = CURRENT_TIMESTAMP, removedbyuserid = $1
       WHERE projectid = $2 AND userid = $3 AND leftatutc IS NULL`,
      [removedByUserId, projectId, userId]
    );
    return true;
  });

// A member with active task/subtask work is kept (never LeftAtUtc) rather than removed -- these
// three columns record who flagged it and why, so project.service.ts's recheckPendingRemoval can
// later notify the flagging Admin once the real removal finally happens. Called again on an
// already-flagged member simply refreshes the timestamp/reason to reflect the latest check.
export const flagMemberPendingRemoval = async (
  projectId: number,
  userId: number,
  flaggedByUserId: number,
  reason: string
): Promise<boolean> => {
  const result = await query(
    `UPDATE work.projectmembers
     SET pendingremovalatutc = CURRENT_TIMESTAMP, pendingremovalbyuserid = $1, pendingremovalreason = $2
     WHERE projectid = $3 AND userid = $4 AND leftatutc IS NULL`,
    [flaggedByUserId, reason, projectId, userId]
  );
  return (result.rowCount ?? 0) > 0;
};

// Every currently-flagged member across every project -- the completion-triggered recheck (called
// from task.service.ts whenever a task/subtask reaches Done) uses this to find who might now be
// clear to remove, without task.service.ts needing to know ProjectMembers' shape at all.
export const findPendingRemovalMembersForProject = async (projectId: number): Promise<ProjectMemberRow[]> => {
  const result = await query<ProjectMemberRow>(
    `SELECT ${MEMBER_COLUMNS}
     FROM work.projectmembers
     WHERE projectid = $1 AND leftatutc IS NULL AND pendingremovalatutc IS NOT NULL
     ORDER BY projectmemberid`,
    [projectId]
  );
  return result.rows;
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
