import { query } from '../db/pool.js';
import { DEFAULT_BUSINESS_TIME_ZONE } from '../attendance/businessTime.js';

// ────────────────────────────────────────────────────────────
// Helper: get visible project IDs for a user based on role
// ────────────────────────────────────────────────────────────

export interface ProjectSummaryRow {
  projectid: number;
  projectcode: string;
  projectname: string;
  statuscode: string;
  startdate: string;
  enddate: string;
  owneruserid: number;
}

// A project's functional lead is per-project (work.ProjectMembers 'TeamLead' membership, with the
// Owner as fallback when no TeamLead row exists) — mirroring resolveTeamLeadUserId. The global
// account role never decides lead-ness: a user who holds a TeamLead iam.role but leads no project
// is treated as a plain member, and a Team_Member who leads a specific project sees lead scope.
//
// Under the multi-team architecture this project-wide lead scope applies ONLY to projects that
// have no team rows (the legacy model). In a team-enabled project a 'TeamLead' ProjectMembers row
// no longer grants project-wide access — team leads are scoped to their own team(s) via
// work.TeamMembers instead, so the NOT EXISTS guard keeps team-enabled projects out of this
// clause (resolveTeamLeadScope drives the team-scoped path).
const LEAD_SCOPE_CLAUSE = `(EXISTS (SELECT 1 FROM work.projectmembers pm
                                    WHERE pm.projectid = p.projectid AND pm.userid = $3
                                      AND pm.memberrolecode = 'TeamLead' AND pm.leftatutc IS NULL)
                            OR (p.owneruserid = $3
                                AND NOT EXISTS (SELECT 1 FROM work.projectmembers pm
                                                WHERE pm.projectid = p.projectid
                                                  AND pm.memberrolecode = 'TeamLead'
                                                  AND pm.leftatutc IS NULL)))
                           AND NOT EXISTS (SELECT 1 FROM work.projectteams pt
                                           WHERE pt.projectid = p.projectid)`;

const MEMBER_SCOPE_CLAUSE = `EXISTS (SELECT 1 FROM work.projectmembers pm
                                     WHERE pm.projectid = p.projectid AND pm.userid = $3
                                       AND pm.leftatutc IS NULL)`;

// ────────────────────────────────────────────────────────────
// Team-scoped lead scope (multi-team architecture)
// ────────────────────────────────────────────────────────────

// The Reports scope of a team lead (work.TeamMembers rows where IsLead is set): the team(s) they
// lead, the active members of those team(s), and the projects containing those team(s).
export interface TeamLeadScope {
  teamIds: number[];
  memberUserIds: number[];
  teamProjectIds: number[];
}

// Restriction threaded into task-scoped queries for a team lead. When teamIds is non-empty, tasks
// must belong to one of the lead's teams (and sit in a visible project) or live in a legacy
// project the lead still owns project-wide (legacyProjectIds, which has no team rows). When
// absent/null the queries keep the plain project-membership scope used for Admin/HR/member.
export interface TeamTaskScope {
  teamIds: number[];
  legacyProjectIds: number[];
}

// Resolves the teams a user currently leads (work.TeamMembers IsLead, LeftAtUtc IS NULL), plus
// the active members of those teams and the projects containing them. An empty teamIds result
// means the user leads no team — the reports flow then falls back to the legacy project-lead /
// member scopes unchanged.
export const resolveTeamLeadScope = async (userPk: number): Promise<TeamLeadScope> => {
  const ledTeams = await query<{ teamid: string; projectid: number }>(
    `SELECT DISTINCT tm.teamid, tm.projectid
       FROM work.teammembers tm
      WHERE tm.userid = $1 AND tm.islead AND tm.leftatutc IS NULL`,
    [userPk]
  );
  const teamIds = [...new Set(ledTeams.rows.map((r) => Number(r.teamid)))];
  const teamProjectIds = [...new Set(ledTeams.rows.map((r) => r.projectid))];
  let memberUserIds: number[] = [];
  if (teamIds.length > 0) {
    const members = await query<{ userid: number }>(
      `SELECT DISTINCT userid
         FROM work.teammembers
        WHERE teamid = ANY($1::bigint[]) AND leftatutc IS NULL`,
      [teamIds]
    );
    memberUserIds = members.rows.map((r) => r.userid);
  }
  return { teamIds, memberUserIds, teamProjectIds };
};

// Projects with no team rows where the user is the project lead — the legacy project-lead scope
// that predates the multi-team architecture. `archived` selects the archived set. Applies the
// same status/date-range filter as findProjectsForRole.
export const findLegacyLeadProjectIds = async (
  userPk: number,
  archived: boolean,
  from: string,
  to: string
): Promise<number[]> => {
  const result = await query<{ projectid: number }>(
    `SELECT p.projectid
     FROM work.projects p
     JOIN work.projectstatuses ps ON ps.projectstatusid = p.projectstatusid
     WHERE p.archivedatutc ${archived ? 'IS NOT NULL' : 'IS NULL'}
       AND ${LEAD_SCOPE_CLAUSE}
       AND (ps.statuscode = 'Active'
            OR p.startdate >= $1::date AND p.startdate <= $2::date
            OR p.enddate >= $1::date AND p.enddate <= $2::date)`,
    [from, to, userPk]
  );
  return result.rows.map((r) => r.projectid);
};

// Active project rows for an explicit project-id set, applying the same status/date-range filter
// as findProjectsForRole so a team-scoped lead's project list behaves exactly like any other
// role's (a project shows when Active or its start/end falls inside the report range).
const findActiveProjectsByIds = async (
  projectIds: number[],
  from: string,
  to: string
): Promise<ProjectSummaryRow[]> => {
  if (projectIds.length === 0) return [];
  const result = await query<ProjectSummaryRow>(
    `SELECT p.projectid, p.projectcode, p.projectname, ps.statuscode,
            p.startdate::text, p.enddate::text, p.owneruserid
     FROM work.projects p
     JOIN work.projectstatuses ps ON ps.projectstatusid = p.projectstatusid
     WHERE p.archivedatutc IS NULL AND p.projectid = ANY($1::int[])
       AND (ps.statuscode = 'Active'
            OR p.startdate >= $2::date AND p.startdate <= $3::date
            OR p.enddate >= $2::date AND p.enddate <= $3::date)`,
    [projectIds, from, to]
  );
  return result.rows;
};

const isUserProjectLead = async (userPk: number, archived: boolean): Promise<boolean> => {
  const result = await query<{ islead: boolean }>(
    `SELECT EXISTS (
       SELECT 1
       FROM work.projects p
       WHERE p.archivedatutc ${archived ? 'IS NOT NULL' : 'IS NULL'}
         AND (EXISTS (SELECT 1 FROM work.projectmembers pm
                      WHERE pm.projectid = p.projectid AND pm.userid = $1
                        AND pm.memberrolecode = 'TeamLead' AND pm.leftatutc IS NULL)
              OR (p.owneruserid = $1
                  AND NOT EXISTS (SELECT 1 FROM work.projectmembers pm
                                  WHERE pm.projectid = p.projectid
                                    AND pm.memberrolecode = 'TeamLead'
                                    AND pm.leftatutc IS NULL)))
     ) AS "islead"`,
    [userPk]
  );
  return result.rows[0]?.islead ?? false;
};

export const findProjectsForRole = async (
  userPk: number,
  role: string,
  from: string,
  to: string,
  teamScope: TeamLeadScope | null = null
): Promise<ProjectSummaryRow[]> => {
  // Admin / HR see all active projects
  if (role === 'Admin' || role === 'HR') {
    const result = await query<ProjectSummaryRow>(
      `SELECT p.projectid, p.projectcode, p.projectname, ps.statuscode,
              p.startdate::text, p.enddate::text, p.owneruserid
       FROM work.projects p
       JOIN work.projectstatuses ps ON ps.projectstatusid = p.projectstatusid
       WHERE p.archivedatutc IS NULL
         AND (ps.statuscode = 'Active'
              OR p.startdate >= $1::date AND p.startdate <= $2::date
              OR p.enddate >= $1::date AND p.enddate <= $2::date)`,
      [from, to]
    );
    return result.rows;
  }

  if (!teamScope) teamScope = await resolveTeamLeadScope(userPk);

  // Team-scoped lead (multi-team architecture): visible projects are the ones containing a team
  // the user leads, plus any legacy projects they still lead project-wide. Member-only projects
  // stay hidden (lead scope takes precedence, exactly as before).
  if (teamScope.teamIds.length > 0) {
    const legacyLeadIds = await findLegacyLeadProjectIds(userPk, false, from, to);
    const projectIds = [...new Set([...teamScope.teamProjectIds, ...legacyLeadIds])];
    return findActiveProjectsByIds(projectIds, from, to);
  }

  // Either/or: leads ≥1 project → only led projects; otherwise → member projects.
  const isLead = await isUserProjectLead(userPk, false);
  const scopeClause = isLead ? LEAD_SCOPE_CLAUSE : MEMBER_SCOPE_CLAUSE;

  const result = await query<ProjectSummaryRow>(
    `SELECT p.projectid, p.projectcode, p.projectname, ps.statuscode,
            p.startdate::text, p.enddate::text, p.owneruserid
     FROM work.projects p
     JOIN work.projectstatuses ps ON ps.projectstatusid = p.projectstatusid
     WHERE p.archivedatutc IS NULL
       AND ${scopeClause}
       AND (ps.statuscode = 'Active'
            OR p.startdate >= $1::date AND p.startdate <= $2::date
            OR p.enddate >= $1::date AND p.enddate <= $2::date)`,
    [from, to, userPk]
  );
  return result.rows;
};

// ────────────────────────────────────────────────────────────
// Overview stats
// ────────────────────────────────────────────────────────────

export interface OverviewStats {
  totalProjects: number;
  totalTasks: number;
  completedTasks: number;
  activeTasks: number;
  overdueTasks: number;
}

export const getOverviewStats = async (
  projectIds: number[],
  from: string,
  to: string,
  taskScope: TeamTaskScope | null = null
): Promise<OverviewStats> => {
  if (projectIds.length === 0) {
    return { totalProjects: 0, totalTasks: 0, completedTasks: 0, activeTasks: 0, overdueTasks: 0 };
  }

  // Project count
  const projResult = await query<{ count: number }>(
    `SELECT COUNT(*)::int AS count
     FROM work.projects p
     JOIN work.projectstatuses ps ON ps.projectstatusid = p.projectstatusid
     WHERE p.projectid = ANY($1::int[]) AND p.archivedatutc IS NULL
       AND (ps.statuscode = 'Active'
             OR p.startdate >= $2::date AND p.startdate <= $3::date
             OR p.enddate >= $2::date AND p.enddate <= $3::date)`,
     [projectIds, from, to]
   );

  // Task counts across all visible projects. For a team-scoped lead the task population is the
  // lead's own team(s) plus any legacy projects they still lead project-wide.
  const taskProjectClause = taskScope && taskScope.teamIds.length > 0
    ? `(t.projectid = ANY($1::int[]) AND t.teamid = ANY($4::bigint[]))
       OR t.projectid = ANY($5::int[])`
    : `t.projectid = ANY($1::int[])`;
  const taskParams = taskScope && taskScope.teamIds.length > 0
    ? [projectIds, from, to, taskScope.teamIds, taskScope.legacyProjectIds]
    : [projectIds, from, to];

  const taskResult = await query<{ total: number; completed: number; active: number; overdue: number }>(
    `SELECT
       COUNT(*)::int AS total,
       COALESCE(SUM(CASE WHEN ts.iscompletedstate THEN 1 ELSE 0 END), 0)::int AS completed,
       COALESCE(SUM(CASE WHEN NOT ts.iscompletedstate THEN 1 ELSE 0 END), 0)::int AS active,
       COALESCE(SUM(CASE WHEN NOT ts.iscompletedstate AND t.duedate < CURRENT_DATE THEN 1 ELSE 0 END), 0)::int AS overdue
     FROM work.tasks t
     JOIN work.taskstatuses ts ON ts.taskstatusid = t.taskstatusid
     WHERE ${taskProjectClause} AND t.archivedatutc IS NULL AND t.parenttaskid IS NULL
         AND ((t.duedate >= $2::date AND t.duedate <= $3::date)
              OR (t.createdatutc::date >= $2::date AND t.createdatutc::date <= $3::date)
              OR NOT ts.iscompletedstate)`,
     taskParams
   );

  return {
    totalProjects: projResult.rows[0]?.count || 0,
    totalTasks: taskResult.rows[0]?.total || 0,
    completedTasks: taskResult.rows[0]?.completed || 0,
    activeTasks: taskResult.rows[0]?.active || 0,
    overdueTasks: taskResult.rows[0]?.overdue || 0,
  };
};

// ────────────────────────────────────────────────────────────
// Project details with computed progress
// ────────────────────────────────────────────────────────────

export interface ProjectStatsRow {
  projectid: number;
  projectname: string;
  projectcode: string;
  statuscode: string;
  startdate: string;
  enddate: string;
  owneruserid: number;
  totalTasks: number;
  completedTasks: number;
  overdueTasks: number;
}

export const getProjectStats = async (
  projectIds: number[],
  from: string,
  to: string,
  taskScope: TeamTaskScope | null = null
): Promise<ProjectStatsRow[]> => {
  if (projectIds.length === 0) return [];

  const taskProjectClause = taskScope && taskScope.teamIds.length > 0
    ? `(t.projectid = ANY($1::int[]) AND t.teamid = ANY($2::bigint[]))
       OR t.projectid = ANY($3::int[])`
    : `t.projectid = ANY($1::int[])`;
  const params = taskScope && taskScope.teamIds.length > 0
    ? [projectIds, taskScope.teamIds, taskScope.legacyProjectIds]
    : [projectIds];

  const result = await query<ProjectStatsRow>(
    `SELECT
       p.projectid, p.projectname, p.projectcode, ps.statuscode,
       p.startdate::text, p.enddate::text, p.owneruserid,
       COALESCE(task_stats.total_tasks, 0)::int AS "totalTasks",
       COALESCE(task_stats.completed_tasks, 0)::int AS "completedTasks",
       COALESCE(task_stats.overdue_tasks, 0)::int AS "overdueTasks"
     FROM work.projects p
     JOIN work.projectstatuses ps ON ps.projectstatusid = p.projectstatusid
     LEFT JOIN (
       SELECT t.projectid,
              COUNT(*)::int AS total_tasks,
              SUM(CASE WHEN ts.iscompletedstate THEN 1 ELSE 0 END)::int AS completed_tasks,
              SUM(CASE WHEN NOT ts.iscompletedstate AND t.duedate < CURRENT_DATE THEN 1 ELSE 0 END)::int AS overdue_tasks
       FROM work.tasks t
       JOIN work.taskstatuses ts ON ts.taskstatusid = t.taskstatusid
        WHERE ${taskProjectClause} AND t.archivedatutc IS NULL AND t.parenttaskid IS NULL
        GROUP BY t.projectid
     ) task_stats ON task_stats.projectid = p.projectid
     WHERE p.projectid = ANY($1::int[]) AND p.archivedatutc IS NULL`,
     params
   );
  return result.rows;
};

export interface ArchivedProjectRow {
  projectid: number;
  projectcode: string;
  projectname: string;
  startdate: string;
  enddate: string;
  owneruserid: number;
}

export const getArchivedProjects = async (
  userPk: number,
  role: string,
  from: string,
  to: string,
  teamScope: TeamLeadScope | null = null
): Promise<ArchivedProjectRow[]> => {
  const base = `SELECT p.projectid, p.projectcode, p.projectname,
                        p.startdate::text, p.enddate::text, p.owneruserid
                 FROM work.projects p
                 JOIN work.projectstatuses ps ON ps.projectstatusid = p.projectstatusid
                 WHERE p.archivedatutc IS NOT NULL`;

  if (role === 'Admin' || role === 'HR') {
    const result = await query<ArchivedProjectRow>(
      `${base}
       AND (ps.statuscode = 'Active'
            OR p.startdate >= $1::date AND p.startdate <= $2::date
            OR p.enddate >= $1::date AND p.enddate <= $2::date)`,
      [from, to]
    );
    return result.rows;
  }

  if (!teamScope) teamScope = await resolveTeamLeadScope(userPk);

  // Team-scoped lead (multi-team architecture): archived projects containing a team the user
  // leads, plus any legacy projects they still lead project-wide.
  if (teamScope.teamIds.length > 0) {
    const legacyLeadIds = await findLegacyLeadProjectIds(userPk, true, from, to);
    const projectIds = [...new Set([...teamScope.teamProjectIds, ...legacyLeadIds])];
    if (projectIds.length === 0) return [];
    const result = await query<ArchivedProjectRow>(
      `${base}
       AND p.projectid = ANY($1::int[])
       AND (ps.statuscode = 'Active'
            OR p.startdate >= $2::date AND p.startdate <= $3::date
            OR p.enddate >= $2::date AND p.enddate <= $3::date)`,
      [projectIds, from, to]
    );
    return result.rows;
  }

  // Same per-project either/or as findProjectsForRole: led projects if the user leads any,
  // otherwise member projects.
  const isLead = await isUserProjectLead(userPk, true);
  const scopeClause = isLead ? LEAD_SCOPE_CLAUSE : MEMBER_SCOPE_CLAUSE;

  const result = await query<ArchivedProjectRow>(
    `${base}
     AND ${scopeClause}
     AND (ps.statuscode = 'Active'
          OR p.startdate >= $1::date AND p.startdate <= $2::date
          OR p.enddate >= $1::date AND p.enddate <= $2::date)`,
    [from, to, userPk]
  );
  return result.rows;
};

// ────────────────────────────────────────────────────────────
// Member IDs per project (for activeMembers count)
// ────────────────────────────────────────────────────────────

export interface MemberRow {
  projectid: number;
  userid: number;
  memberrolecode: string;
}

export const getProjectMembers = async (
  projectIds: number[],
  memberUserIds: number[] | null = null
): Promise<MemberRow[]> => {
  if (projectIds.length === 0) return [];
  const userFilter = memberUserIds && memberUserIds.length > 0
    ? ' AND userid = ANY($2::int[])'
    : '';
  const result = await query<MemberRow>(
    `SELECT projectid, userid, memberrolecode
     FROM work.projectmembers
     WHERE projectid = ANY($1::int[]) AND leftatutc IS NULL${userFilter}`,
    memberUserIds && memberUserIds.length > 0 ? [projectIds, memberUserIds] : [projectIds]
  );
  return result.rows;
};

// ────────────────────────────────────────────────────────────
// Task status distribution
// ────────────────────────────────────────────────────────────

export interface DistRow {
  name: string;
  value: number;
}

export const getTaskStatusDistribution = async (
  projectIds: number[],
  from: string,
  to: string,
  taskScope: TeamTaskScope | null = null
): Promise<DistRow[]> => {
  if (projectIds.length === 0) return [];

  const taskProjectClause = taskScope && taskScope.teamIds.length > 0
    ? `(t.projectid = ANY($1::int[]) AND t.teamid = ANY($2::bigint[]))
       OR t.projectid = ANY($3::int[])`
    : `t.projectid = ANY($1::int[])`;
  const params = taskScope && taskScope.teamIds.length > 0
    ? [projectIds, taskScope.teamIds, taskScope.legacyProjectIds]
    : [projectIds];

  const result = await query<{ name: string; value: number }>(
    `SELECT ts.statuscode AS name, COUNT(*)::int AS value
     FROM work.tasks t
     JOIN work.taskstatuses ts ON ts.taskstatusid = t.taskstatusid
      WHERE ${taskProjectClause} AND t.archivedatutc IS NULL AND t.parenttaskid IS NULL
      GROUP BY ts.statuscode
      ORDER BY MIN(ts.sortorder)`,
     params
   );

   // Map DB codes to display names
   const statusNames: Record<string, string> = {
     Todo: 'Todo',
     InProgress: 'In Progress',
     Review: 'Review',
     Done: 'Done',
   };

   return result.rows.map((r) => ({
     name: statusNames[r.name] || r.name,
     value: r.value,
   }));
};

// ────────────────────────────────────────────────────────────
// Task priority distribution
// ────────────────────────────────────────────────────────────

export const getTaskPriorityDistribution = async (
  projectIds: number[],
  from: string,
  to: string,
  taskScope: TeamTaskScope | null = null
): Promise<DistRow[]> => {
  if (projectIds.length === 0) return [];

  const taskProjectClause = taskScope && taskScope.teamIds.length > 0
    ? `(t.projectid = ANY($1::int[]) AND t.teamid = ANY($2::bigint[]))
       OR t.projectid = ANY($3::int[])`
    : `t.projectid = ANY($1::int[])`;
  const params = taskScope && taskScope.teamIds.length > 0
    ? [projectIds, taskScope.teamIds, taskScope.legacyProjectIds]
    : [projectIds];

  const result = await query<{ name: string; value: number }>(
    `SELECT pr.prioritycode AS name, COUNT(*)::int AS value
     FROM work.tasks t
     JOIN work.priorities pr ON pr.priorityid = t.priorityid
     JOIN work.taskstatuses ts ON ts.taskstatusid = t.taskstatusid
      WHERE ${taskProjectClause} AND t.archivedatutc IS NULL AND t.parenttaskid IS NULL
      GROUP BY pr.prioritycode
      ORDER BY pr.prioritycode`,
     params
  );

  // Map DB codes to display names
  const priorityNames: Record<string, string> = {
    Low: 'Low',
    Medium: 'Medium',
    High: 'High',
    Critical: 'Urgent',
  };

  return result.rows.map((r) => ({
    name: priorityNames[r.name] || r.name,
    value: r.value,
  }));
};

// ────────────────────────────────────────────────────────────
// Task completion trend (daily completed / created in range)
// ────────────────────────────────────────────────────────────

export interface TrendRow {
  date: string;
  created: number;
  completed: number;
}

export const getCompletionTrend = async (
  projectIds: number[],
  from: string,
  to: string,
  taskScope: TeamTaskScope | null = null
): Promise<TrendRow[]> => {
  if (projectIds.length === 0) return [];

  const taskProjectClause = taskScope && taskScope.teamIds.length > 0
    ? `(t.projectid = ANY($1::int[]) AND t.teamid = ANY($4::bigint[]))
       OR t.projectid = ANY($5::int[])`
    : `t.projectid = ANY($1::int[])`;
  const params = taskScope && taskScope.teamIds.length > 0
    ? [projectIds, from, to, taskScope.teamIds, taskScope.legacyProjectIds]
    : [projectIds, from, to];

  const result = await query<TrendRow>(
    `SELECT dates.date::text,
            COALESCE(SUM(created.cnt)::int, 0) AS created,
            COALESCE(SUM(completed.cnt)::int, 0) AS completed
     FROM generate_series($2::date, $3::date, '1 day') dates(date)
     LEFT JOIN (
       SELECT t.createdatutc::date AS d, COUNT(*)::int AS cnt
       FROM work.tasks t
       WHERE ${taskProjectClause} AND t.archivedatutc IS NULL AND t.parenttaskid IS NULL
         AND t.createdatutc::date >= $2::date AND t.createdatutc::date <= $3::date
       GROUP BY t.createdatutc::date
     ) created ON created.d = dates.date
     LEFT JOIN (
        SELECT t.completedatutc::date AS d, COUNT(*)::int AS cnt
        FROM work.tasks t
        JOIN work.taskstatuses ts ON ts.taskstatusid = t.taskstatusid
        WHERE ${taskProjectClause} AND t.archivedatutc IS NULL AND t.parenttaskid IS NULL
          AND ts.iscompletedstate AND t.completedatutc::date >= $2::date AND t.completedatutc::date <= $3::date
        GROUP BY t.completedatutc::date
      ) completed ON completed.d = dates.date
      GROUP BY dates.date
      ORDER BY dates.date`,
     params
   );
  return result.rows;
};

// ────────────────────────────────────────────────────────────
// Workload: task counts grouped by assignee
// ────────────────────────────────────────────────────────────

export interface WorkloadRow {
  projectid: number;
  userid: number;
  active: number;
  completed: number;
  review: number;
  overdue: number;
}

// Per-project × assignee task counts. Counting is per-assignee via work.taskassignees (multi-
// assignee tasks count for each of their assignees, matching the Tasks tab). The per-project
// granularity lets a lead's Workload tab filter data down to a single project they lead; each
// assignee's cross-project total is simply the sum of their rows.
//
// Date-range semantics: active/review (non-completed) tasks always count regardless of due date —
// they represent the member's current workload. Completed tasks count when their completion time
// falls inside the report's From → To window (PKT), NOT their due date, so a task completed in the
// period never disappears just because its due date is outside the range. All "today" boundaries
// use Asia/Karachi so the backend agrees with the frontend's local calendar.
export const getWorkload = async (
  projectIds: number[],
  from: string,
  to: string,
  taskScope: TeamTaskScope | null = null
): Promise<WorkloadRow[]> => {
  if (projectIds.length === 0) return [];

  const taskProjectClause = taskScope && taskScope.teamIds.length > 0
    ? `(t.projectid = ANY($1::int[]) AND t.teamid = ANY($4::bigint[]))
       OR t.projectid = ANY($5::int[])`
    : `t.projectid = ANY($1::int[])`;
  const params = taskScope && taskScope.teamIds.length > 0
    ? [projectIds, from, to, taskScope.teamIds, taskScope.legacyProjectIds]
    : [projectIds, from, to];

  const result = await query<WorkloadRow>(
    `SELECT
       t.projectid,
       ta.userid,
       COALESCE(SUM(CASE WHEN ts.statuscode NOT IN ('Done', 'Review') AND NOT ts.iscompletedstate THEN 1 ELSE 0 END), 0)::int AS active,
       COALESCE(SUM(CASE WHEN ts.iscompletedstate THEN 1 ELSE 0 END), 0)::int AS completed,
       COALESCE(SUM(CASE WHEN ts.statuscode = 'Review' THEN 1 ELSE 0 END), 0)::int AS review,
       COALESCE(SUM(CASE WHEN NOT ts.iscompletedstate AND t.duedate < (now() AT TIME ZONE 'Asia/Karachi')::date THEN 1 ELSE 0 END), 0)::int AS overdue
     FROM work.taskassignees ta
     JOIN work.tasks t ON t.taskid = ta.taskid AND t.archivedatutc IS NULL AND t.parenttaskid IS NULL
     JOIN work.taskstatuses ts ON ts.taskstatusid = t.taskstatusid
     WHERE ta.unassignedatutc IS NULL
       AND ${taskProjectClause}
       AND (NOT ts.iscompletedstate
            OR (ts.iscompletedstate
                AND (t.completedatutc AT TIME ZONE 'Asia/Karachi')::date >= $2::date
                AND (t.completedatutc AT TIME ZONE 'Asia/Karachi')::date <= $3::date))
     GROUP BY ta.userid, t.projectid
      ORDER BY active DESC`,
     params
   );
  return result.rows;
};

// ────────────────────────────────────────────────────────────
// Deadlines: tasks grouped by urgency
// ────────────────────────────────────────────────────────────

export interface DeadlineProjectRow {
  projectid: number;
  projectname: string;
  projectcode: string;
  islead: boolean;
}

// `$1`-based equivalents of LEAD_SCOPE_CLAUSE / MEMBER_SCOPE_CLAUSE (those reference $3 for the
// caller's from/to parameters). The Upcoming Deadlines project scope intentionally does NOT honor
// the global Reports From → To range: deadlines must reflect actual upcoming task dates regardless
// of the range the user picked for the rest of Reports, so this query has no date placeholders and
// the shared clauses' $3 index does not apply here. As with LEAD_SCOPE_CLAUSE, the project-wide
// lead scope only covers projects without team rows (team leads are scoped to their team(s)).
const DEADLINE_LEAD_SCOPE_CLAUSE = `(EXISTS (SELECT 1 FROM work.projectmembers pm
                                            WHERE pm.projectid = p.projectid AND pm.userid = $1
                                              AND pm.memberrolecode = 'TeamLead' AND pm.leftatutc IS NULL)
                                    OR (p.owneruserid = $1
                                        AND NOT EXISTS (SELECT 1 FROM work.projectmembers pm
                                                        WHERE pm.projectid = p.projectid
                                                          AND pm.memberrolecode = 'TeamLead'
                                                          AND pm.leftatutc IS NULL)))
                                   AND NOT EXISTS (SELECT 1 FROM work.projectteams pt
                                                   WHERE pt.projectid = p.projectid)`;

const DEADLINE_MEMBER_SCOPE_CLAUSE = `EXISTS (SELECT 1 FROM work.projectmembers pm
                                             WHERE pm.projectid = p.projectid AND pm.userid = $1
                                               AND pm.leftatutc IS NULL)`;

// Non-archived legacy (no-team) projects the user leads project-wide — the deadline equivalent of
// findLegacyLeadProjectIds without the Reports date range (deadlines ignore the report window).
const findLegacyDeadlineLeadProjectIds = async (userPk: number): Promise<number[]> => {
  const result = await query<{ projectid: number }>(
    `SELECT DISTINCT p.projectid
     FROM work.projects p
     JOIN work.projectstatuses ps ON ps.projectstatusid = p.projectstatusid
     WHERE p.archivedatutc IS NULL AND ${DEADLINE_LEAD_SCOPE_CLAUSE}`,
    [userPk]
  );
  return result.rows.map((r) => r.projectid);
};

// Project population for the Upcoming Deadlines tab. Admin / HR see every non-archived project.
// For everyone else, lead behavior takes precedence: a user who leads ≥1 project sees ONLY the
// projects they lead; projects they merely belong to contribute nothing. A user who leads no
// project is a plain member and sees only the projects they belong to. Lead-ness is per-project
// (ProjectMembers 'TeamLead' membership, with the Owner as fallback — see
// DEADLINE_LEAD_SCOPE_CLAUSE) and never derives from the global account role. The per-project
// islead flag then drives the task population in getDeadlineBucketTasks: led projects expose every
// eligible deadline, member-only projects expose only the user's own assigned deadlines.
//
// Under the multi-team architecture a team lead's deadline projects are the projects containing a
// team they lead (their own team's tasks are then selected in getDeadlineBucketTasks) plus any
// legacy projects they still lead project-wide. All rows are marked islead so the team restriction
// (not the member-only restriction) decides the task population.
//
// The global Reports From → To range is deliberately NOT applied here: an upcoming deadline should
// appear based on its actual due date, not on whether its project's start/end dates fall inside the
// user's selected report window.
export const getDeadlineProjectsForRole = async (
  userPk: number,
  role: string,
  teamScope: TeamLeadScope | null = null
): Promise<DeadlineProjectRow[]> => {
  // Admin / HR see all non-archived projects (existing behavior preserved).
  if (role === 'Admin' || role === 'HR') {
    const result = await query<DeadlineProjectRow>(
      `SELECT p.projectid, p.projectname, p.projectcode,
              true AS islead
       FROM work.projects p
       JOIN work.projectstatuses ps ON ps.projectstatusid = p.projectstatusid
       WHERE p.archivedatutc IS NULL`
    );
    return result.rows;
  }

  if (!teamScope) teamScope = await resolveTeamLeadScope(userPk);

  // Team-scoped lead (multi-team architecture): projects containing a team the user leads, plus
  // any legacy projects they still lead project-wide. The team task restriction is applied in
  // getDeadlineBucketTasks.
  if (teamScope.teamIds.length > 0) {
    const legacyLeadIds = await findLegacyDeadlineLeadProjectIds(userPk);
    const projectIds = [...new Set([...teamScope.teamProjectIds, ...legacyLeadIds])];
    if (projectIds.length === 0) return [];
    const result = await query<DeadlineProjectRow>(
      `SELECT p.projectid, p.projectname, p.projectcode, true AS islead
       FROM work.projects p
       JOIN work.projectstatuses ps ON ps.projectstatusid = p.projectstatusid
       WHERE p.archivedatutc IS NULL AND p.projectid = ANY($1::int[])`,
      [projectIds]
    );
    return result.rows;
  }

  // Lead scope takes precedence: leading any project hides every member-only project.
  if (await isUserProjectLead(userPk, false)) {
    const result = await query<DeadlineProjectRow>(
      `SELECT p.projectid, p.projectname, p.projectcode, true AS islead
       FROM work.projects p
       JOIN work.projectstatuses ps ON ps.projectstatusid = p.projectstatusid
       WHERE p.archivedatutc IS NULL AND ${DEADLINE_LEAD_SCOPE_CLAUSE}`,
      [userPk]
    );
    return result.rows;
  }

  // Plain member: member projects only. Their own assigned deadlines are applied in
  // getDeadlineBucketTasks via the member-only branch.
  const result = await query<DeadlineProjectRow>(
    `SELECT p.projectid, p.projectname, p.projectcode, false AS islead
     FROM work.projects p
     JOIN work.projectstatuses ps ON ps.projectstatusid = p.projectstatusid
     WHERE p.archivedatutc IS NULL AND ${DEADLINE_MEMBER_SCOPE_CLAUSE}`,
    [userPk]
  );
  return result.rows;
};

export interface TaskDeadlineRow {
  id: string;
  title: string;
  status: string;
  priority: string;
  dueDate: string;
  projectId: string;
  projectName: string;
  assigneeIds: string[];
  assigneeId: string | null;
}

// Task population for the Upcoming Deadlines tab. For each project in the scope:
//   - projects the user leads            -> every eligible task (assignee irrelevant);
//   - projects the user only belongs to  -> only tasks the user is an assignee of,
//                                           using the complete (multi-assignee) assignee set.
// For Admin / HR every project is passed with islead = true, so all tasks are eligible — matching
// the pre-existing behavior exactly.
//
// For a team-scoped lead (teamScope with non-empty teamIds) every deadline project is led: team
// projects contribute only the lead's own team's tasks, and legacy projects contribute every task.
export const getDeadlineBucketTasks = async (
  projects: DeadlineProjectRow[],
  userPk: number,
  bucket: 'today' | 'tomorrow' | 'upcoming' | 'overdue',
  teamScope: TeamLeadScope | null = null
): Promise<TaskDeadlineRow[]> => {
  if (projects.length === 0) return [];

  // PKT "today": the app runs in Pakistan local time, and Postgres CURRENT_DATE is UTC-based and
  // would shift the Today/Tomorrow/future buckets by a day during the PKT early morning. Compute
  // the calendar date in Asia/Karachi so the backend and the frontend's local "today" agree.
  const todaySql = `(now() AT TIME ZONE 'Asia/Karachi')::date`;

  let dateFilter: string;
  switch (bucket) {
    case 'today':
      dateFilter = `t.duedate = ${todaySql}`;
      break;
    case 'tomorrow':
      dateFilter = `t.duedate = ${todaySql} + 1`;
      break;
    case 'upcoming':
      dateFilter = `t.duedate > ${todaySql} + 1`;
      break;
    case 'overdue':
      dateFilter = `t.duedate < ${todaySql}`;
      break;
  }

  const ledProjectIds = projects.filter((p) => p.islead).map((p) => p.projectid);
  const memberOnlyProjectIds = projects.filter((p) => !p.islead).map((p) => p.projectid);

  // Team-scoped lead: led team projects only expose the lead's own team's tasks; the legacy
  // (no-team) led projects keep every task, matching the old project-lead behavior.
  const isTeamScoped = teamScope && teamScope.teamIds.length > 0;
  const taskPredicate = isTeamScoped
    ? `(t.projectid = ANY($1::int[]) AND t.teamid = ANY($2::bigint[]))
       OR t.projectid = ANY($3::int[])`
    : `t.projectid = ANY($1::int[])
       OR (
         t.projectid = ANY($2::int[])
         AND EXISTS (SELECT 1 FROM work.taskassignees mta
                     WHERE mta.taskid = t.taskid AND mta.userid = $3
                       AND mta.unassignedatutc IS NULL)
       )`;
  const params: unknown[] = isTeamScoped
    ? [
        ledProjectIds,
        teamScope.teamIds,
        ledProjectIds.filter((pid) => !teamScope.teamProjectIds.includes(pid)),
      ]
    : [ledProjectIds, memberOnlyProjectIds, userPk];

  const result = await query<TaskDeadlineRow>(
    `SELECT
       'tsk-' || t.taskid AS id,
       t.title,
       ts.statuscode AS status,
       pr.prioritycode AS priority,
       t.duedate::text AS "dueDate",
       'prj-' || t.projectid AS "projectId",
       p.projectname AS "projectName",
       COALESCE((SELECT array_agg('usr-' || taa.userid)
                 FROM work.taskassignees taa
                 WHERE taa.taskid = t.taskid AND taa.unassignedatutc IS NULL), '{}'::text[]) AS "assigneeIds",
       'usr-' || ta.userid AS "assigneeId"
     FROM work.tasks t
     JOIN work.taskstatuses ts ON ts.taskstatusid = t.taskstatusid
     JOIN work.priorities pr ON pr.priorityid = t.priorityid
     JOIN work.projects p ON p.projectid = t.projectid
     LEFT JOIN LATERAL (
       SELECT userid FROM work.taskassignees
       WHERE taskid = t.taskid AND unassignedatutc IS NULL
       LIMIT 1
     ) ta ON true
     WHERE t.archivedatutc IS NULL AND t.parenttaskid IS NULL
       AND NOT ts.iscompletedstate
       AND (
         ${taskPredicate}
       )
       AND ${dateFilter}
     ORDER BY t.duedate, t.taskid`,
    params
  );

  // Map status/priority codes to display names
  const statusMap: Record<string, string> = {
    Todo: 'Todo',
    InProgress: 'In Progress',
    Review: 'Review',
    Done: 'Done',
  };
  const priorityMap: Record<string, string> = {
    Low: 'Low',
    Medium: 'Medium',
    High: 'High',
    Critical: 'Urgent',
  };

  return result.rows.map((r) => ({
    ...r,
    status: statusMap[r.status] || r.status,
    priority: priorityMap[r.priority] || r.priority,
  }));
};

// ────────────────────────────────────────────────────────────
// Team / Department stats
// ────────────────────────────────────────────────────────────

export interface TeamStatRow {
  department: string;
  members: number;
  projects: number;
  tasks: number;
  completed: number;
}

export const getTeamStats = async (
  projectIds: number[],
  from: string,
  to: string,
  taskScope: TeamTaskScope | null = null,
  memberUserIds: number[] | null = null
): Promise<TeamStatRow[]> => {
  if (projectIds.length === 0) return [];

  // For a team-scoped lead: members are restricted to the lead's team(s) and tasks to the team's
  // tasks (plus legacy projects the lead still owns project-wide).
  const params: unknown[] = [projectIds, from, to];
  const memberClause = memberUserIds && memberUserIds.length > 0
    ? ` AND pm.userid = ANY($${params.length + 1}::int[])`
    : '';
  if (memberUserIds && memberUserIds.length > 0) params.push(memberUserIds);
  const teamIdsIdx = params.length + 1;
  const legacyIdsIdx = params.length + 2;
  const taskJoinClause = taskScope && taskScope.teamIds.length > 0
    ? ` AND (t.teamid = ANY($${teamIdsIdx}::bigint[]) OR t.projectid = ANY($${legacyIdsIdx}::int[]))`
    : '';
  if (taskScope && taskScope.teamIds.length > 0) {
    params.push(taskScope.teamIds, taskScope.legacyProjectIds);
  }

  const result = await query<TeamStatRow>(
    `SELECT
       COALESCE(d.departmentname, 'Unknown') AS department,
       COUNT(DISTINCT u.userid)::int AS members,
       COUNT(DISTINCT pm.projectid)::int AS projects,
       COUNT(DISTINCT t.taskid)::int AS tasks,
       COUNT(DISTINCT t.taskid) FILTER (WHERE ts.iscompletedstate)::int AS completed
     FROM iam.users u
     JOIN work.projectmembers pm ON pm.userid = u.userid AND pm.leftatutc IS NULL
     LEFT JOIN org.departments d ON d.departmentid = u.departmentid
      LEFT JOIN work.tasks t ON t.projectid = pm.projectid AND t.archivedatutc IS NULL AND t.parenttaskid IS NULL${taskJoinClause}
     LEFT JOIN work.taskstatuses ts ON ts.taskstatusid = t.taskstatusid
     WHERE pm.projectid = ANY($1::int[])${memberClause}
       AND (t.taskid IS NULL
            OR (t.duedate >= $2::date AND t.duedate <= $3::date)
            OR NOT ts.iscompletedstate
            OR ts.iscompletedstate IS NULL)
     GROUP BY d.departmentname
      ORDER BY tasks DESC`,
     params
   );
  return result.rows;
};

// ────────────────────────────────────────────────────────────
// Attendance stats
// ────────────────────────────────────────────────────────────

export interface AttendanceStatsResult {
  present: number;
  late: number;
  absent: number;
  onLeave: number;
  halfDay: number;
  shortHours: number;
  inSession: number;
  totalHours: number;
  totalRecords: number;
}

export const getAttendanceStats = async (
  from: string,
  to: string,
  userPks?: number[]
): Promise<AttendanceStatsResult> => {
  const userFilter = userPks && userPks.length > 0
    ? ` AND ar.userid = ANY($3::int[])`
    : '';

  const params: unknown[] = [from, to];
  if (userPks && userPks.length > 0) {
    params.push(userPks);
  }

  const queryText = `
    SELECT
       COALESCE(SUM(CASE WHEN astatus.statuscode = 'Present' THEN 1 ELSE 0 END), 0)::int AS present,
       COALESCE(SUM(CASE WHEN astatus.statuscode = 'Late' THEN 1 ELSE 0 END), 0)::int AS late,
       COALESCE(SUM(CASE WHEN astatus.statuscode = 'Absent' THEN 1 ELSE 0 END), 0)::int AS absent,
       COALESCE(SUM(CASE WHEN astatus.statuscode = 'Leave' THEN 1 ELSE 0 END), 0)::int AS "onLeave",
       COALESCE(SUM(CASE WHEN astatus.statuscode = 'Half Day' THEN 1 ELSE 0 END), 0)::int AS "halfDay",
       COALESCE(SUM(CASE WHEN astatus.statuscode = 'Short Hours' THEN 1 ELSE 0 END), 0)::int AS "shortHours",
       COALESCE(SUM(CASE WHEN astatus.statuscode = 'In Session' THEN 1 ELSE 0 END), 0)::int AS "inSession",
       COALESCE(SUM(ar.workingminutes), 0)::int AS totalMinutes,
       COUNT(*)::int AS totalRecords
     FROM hr.attendancerecords ar
     JOIN hr.attendancestatuses astatus ON astatus.attendancestatusid = ar.attendancestatusid
     WHERE ar.workdate >= $1::date AND ar.workdate <= $2::date
       ${userFilter}`;

  const result = await query<{
    present: number;
    late: number;
    absent: number;
    onLeave: number;
    halfDay: number;
    shortHours: number;
    inSession: number;
    totalMinutes: number;
    totalRecords: number;
  }>(queryText, params);

  const row = result.rows[0] || { present: 0, late: 0, absent: 0, onLeave: 0, halfDay: 0, shortHours: 0, inSession: 0, totalMinutes: 0, totalRecords: 0 };
  return {
    present: row.present,
    late: row.late,
    absent: row.absent,
    onLeave: row.onLeave,
    halfDay: row.halfDay,
    shortHours: row.shortHours,
    inSession: row.inSession,
    totalHours: Math.round((row.totalMinutes / 60) * 10) / 10,
    totalRecords: row.totalRecords,
  };
};

// ────────────────────────────────────────────────────────────
// Attendance records detail
// ────────────────────────────────────────────────────────────

export interface AttendanceRecordRow {
  userId: string;
  date: string;
  status: string;
  checkIn: string;
  checkOut: string | null;
  totalHours: number;
  breaksCount: number;
  timeZone: string;
}

export const getAttendanceRecords = async (
  from: string,
  to: string,
  userPks?: number[]
): Promise<AttendanceRecordRow[]> => {
  const userFilter = userPks && userPks.length > 0
    ? ` AND ar.userid = ANY($3::int[])`
    : '';

  const params: unknown[] = [from, to];
  if (userPks && userPks.length > 0) {
    params.push(userPks);
  }

  const result = await query<AttendanceRecordRow>(
    `SELECT
       'usr-' || ar.userid AS "userId",
       ar.workdate::text AS date,
       astatus.statuscode AS status,
       COALESCE(ar.actualcheckinatutc::text, '') AS "checkIn",
       ar.actualcheckoutatutc::text AS "checkOut",
       COALESCE(profile.timezoneid, o.timezoneid, '${DEFAULT_BUSINESS_TIME_ZONE}') AS "timeZone",
       COALESCE(ar.workingminutes, 0) AS "totalHours",
       (SELECT COUNT(*) FROM hr.attendancepunches ap WHERE ap.attendancerecordid = ar.attendancerecordid)::int AS "breaksCount"
     FROM hr.attendancerecords ar
     JOIN iam.users u ON u.userid = ar.userid
     JOIN org.organizations o ON o.organizationid = u.organizationid
     LEFT JOIN iam.userprofiles profile ON profile.userid = u.userid
     JOIN hr.attendancestatuses astatus ON astatus.attendancestatusid = ar.attendancestatusid
     WHERE ar.workdate >= $1::date AND ar.workdate <= $2::date
       ${userFilter}
     ORDER BY ar.workdate DESC, ar.userid`,
    params
  );
  return result.rows.map((r) => ({
    ...r,
    status: r.status === 'Leave' ? 'On Leave' : r.status,
    totalHours: Math.round((r.totalHours / 60) * 10) / 10,
  }));
};

// ────────────────────────────────────────────────────────────
// Pending HR requests counts
// ────────────────────────────────────────────────────────────

export interface PendingRequestsResult {
  pendingCorrections: number;
  pendingLeaves: number;
}

export const getPendingRequests = async (): Promise<PendingRequestsResult> => {
  const [leaves, corrections] = await Promise.all([
    query<{ count: number }>(
      `SELECT COUNT(*)::int AS count
         FROM public.worksync_hr_requests
        WHERE request_type = 'Leave' AND status = 'Pending'`
    ),
    query<{ count: number }>(
      `SELECT COUNT(*)::int AS count
         FROM public.worksync_hr_requests
        WHERE request_type = 'Correction' AND status = 'Pending'`
    ),
  ]);

  return {
    pendingLeaves: leaves.rows[0]?.count || 0,
    pendingCorrections: corrections.rows[0]?.count || 0,
  };
};

// ────────────────────────────────────────────────────────────
// User names lookup
// ────────────────────────────────────────────────────────────

export interface UserNameRow {
  userid: number;
  displayname: string;
}

export const getUserNames = async (userPks: number[]): Promise<UserNameRow[]> => {
  if (userPks.length === 0) return [];
  const result = await query<UserNameRow>(
    `SELECT userid, displayname FROM iam.users WHERE userid = ANY($1::int[])`,
    [userPks]
  );
  return result.rows;
};

// ────────────────────────────────────────────────────────────
// Today's attendance stats (HR overview)
// ────────────────────────────────────────────────────────────

export interface TodayAttendanceResult {
  presentToday: number;
  absentToday: number;
  onLeaveToday: number;
  lateToday: number;
  halfDayToday: number;
  shortHoursToday: number;
  inSessionToday: number;
  totalMinutesToday: number;
  totalRecordsToday: number;
}

export const getTodayAttendance = async (userPks?: number[]): Promise<TodayAttendanceResult> => {
  const userFilter = userPks && userPks.length > 0 ? ' AND ar.userid = ANY($1::int[])' : '';
  // PKT "today": the app runs in Pakistan local time; Postgres CURRENT_DATE is UTC-based and would
  // shift the local date during PKT early morning. Keep this consistent with the report deadline
  // buckets, which already compute the calendar date in Asia/Karachi.
  const todaySql = `(now() AT TIME ZONE 'Asia/Karachi')::date`;
  const result = await query<TodayAttendanceResult>(
    `SELECT
       COALESCE(SUM(CASE WHEN astatus.statuscode = 'Present' THEN 1 ELSE 0 END), 0)::int AS "presentToday",
       COALESCE(SUM(CASE WHEN astatus.statuscode = 'Absent' THEN 1 ELSE 0 END), 0)::int AS "absentToday",
       COALESCE(SUM(CASE WHEN astatus.statuscode = 'Leave' THEN 1 ELSE 0 END), 0)::int AS "onLeaveToday",
       COALESCE(SUM(CASE WHEN astatus.statuscode = 'Late' THEN 1 ELSE 0 END), 0)::int AS "lateToday",
       COALESCE(SUM(CASE WHEN astatus.statuscode = 'Half Day' THEN 1 ELSE 0 END), 0)::int AS "halfDayToday",
       COALESCE(SUM(CASE WHEN astatus.statuscode = 'Short Hours' THEN 1 ELSE 0 END), 0)::int AS "shortHoursToday",
       COALESCE(SUM(CASE WHEN astatus.statuscode = 'In Session' THEN 1 ELSE 0 END), 0)::int AS "inSessionToday",
       COALESCE(SUM(ar.workingminutes), 0)::int AS "totalMinutesToday",
       COUNT(*)::int AS "totalRecordsToday"
     FROM hr.attendancerecords ar
     JOIN hr.attendancestatuses astatus ON astatus.attendancestatusid = ar.attendancestatusid
     WHERE ar.workdate = ${todaySql} ${userFilter}`,
    userPks && userPks.length > 0 ? [userPks] : []
  );
  const row = result.rows[0] || { presentToday: 0, absentToday: 0, onLeaveToday: 0, lateToday: 0, halfDayToday: 0, shortHoursToday: 0, inSessionToday: 0, totalMinutesToday: 0, totalRecordsToday: 0 };
  return row;
};
