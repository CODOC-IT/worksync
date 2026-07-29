import { query } from '../db/pool.js';

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

export const findProjectsForRole = async (
  userPk: number,
  role: string,
  from: string,
  to: string
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

  // Team_Lead: projects where user is TeamLead or Owner
  if (role === 'Team_Lead') {
    const result = await query<ProjectSummaryRow>(
      `SELECT p.projectid, p.projectcode, p.projectname, ps.statuscode,
              p.startdate::text, p.enddate::text, p.owneruserid
       FROM work.projects p
       JOIN work.projectstatuses ps ON ps.projectstatusid = p.projectstatusid
       WHERE p.archivedatutc IS NULL
         AND (p.owneruserid = $3
              OR EXISTS (SELECT 1 FROM work.projectmembers pm
                         WHERE pm.projectid = p.projectid AND pm.userid = $3
                         AND pm.memberrolecode = 'TeamLead' AND pm.leftatutc IS NULL))
         AND (ps.statuscode = 'Active'
              OR p.startdate >= $1::date AND p.startdate <= $2::date
              OR p.enddate >= $1::date AND p.enddate <= $2::date)`,
      [from, to, userPk]
    );
    return result.rows;
  }

  // Team_Member: projects where user is a member
  const result = await query<ProjectSummaryRow>(
    `SELECT p.projectid, p.projectcode, p.projectname, ps.statuscode,
            p.startdate::text, p.enddate::text, p.owneruserid
     FROM work.projects p
     JOIN work.projectstatuses ps ON ps.projectstatusid = p.projectstatusid
     WHERE p.archivedatutc IS NULL
       AND EXISTS (SELECT 1 FROM work.projectmembers pm
                   WHERE pm.projectid = p.projectid AND pm.userid = $3
                   AND pm.leftatutc IS NULL)
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
  to: string
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

  // Task counts across all visible projects
  const taskResult = await query<{ total: number; completed: number; active: number; overdue: number }>(
    `SELECT
       COUNT(*)::int AS total,
       COALESCE(SUM(CASE WHEN ts.iscompletedstate THEN 1 ELSE 0 END), 0)::int AS completed,
       COALESCE(SUM(CASE WHEN NOT ts.iscompletedstate THEN 1 ELSE 0 END), 0)::int AS active,
       COALESCE(SUM(CASE WHEN NOT ts.iscompletedstate AND t.duedate < CURRENT_DATE THEN 1 ELSE 0 END), 0)::int AS overdue
     FROM work.tasks t
     JOIN work.taskstatuses ts ON ts.taskstatusid = t.taskstatusid
     WHERE t.projectid = ANY($1::int[]) AND t.archivedatutc IS NULL AND t.parenttaskid IS NULL
        AND ((t.duedate >= $2::date AND t.duedate <= $3::date)
             OR NOT ts.iscompletedstate)`,
     [projectIds, from, to]
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

export const getProjectStats = async (projectIds: number[], from: string, to: string): Promise<ProjectStatsRow[]> => {
  if (projectIds.length === 0) return [];

  const result = await query<ProjectStatsRow>(
    `SELECT
       p.projectid, p.projectname, p.projectcode, ps.statuscode,
       p.startdate::text, p.enddate::text, p.owneruserid,
       COALESCE(task_stats.total_tasks, 0)::int AS totalTasks,
       COALESCE(task_stats.completed_tasks, 0)::int AS completedTasks,
       COALESCE(task_stats.overdue_tasks, 0)::int AS overdueTasks
     FROM work.projects p
     JOIN work.projectstatuses ps ON ps.projectstatusid = p.projectstatusid
     LEFT JOIN (
       SELECT t.projectid,
              COUNT(*)::int AS total_tasks,
              SUM(CASE WHEN ts.iscompletedstate THEN 1 ELSE 0 END)::int AS completed_tasks,
              SUM(CASE WHEN NOT ts.iscompletedstate AND t.duedate < CURRENT_DATE THEN 1 ELSE 0 END)::int AS overdue_tasks
       FROM work.tasks t
       JOIN work.taskstatuses ts ON ts.taskstatusid = t.taskstatusid
        WHERE t.projectid = ANY($1::int[]) AND t.archivedatutc IS NULL AND t.parenttaskid IS NULL
        GROUP BY t.projectid
     ) task_stats ON task_stats.projectid = p.projectid
     WHERE p.projectid = ANY($1::int[]) AND p.archivedatutc IS NULL`,
     [projectIds]
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
  to: string
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

  if (role === 'Team_Lead') {
    const result = await query<ArchivedProjectRow>(
      `${base}
       AND (p.owneruserid = $3
            OR EXISTS (SELECT 1 FROM work.projectmembers pm
                       WHERE pm.projectid = p.projectid AND pm.userid = $3
                       AND pm.memberrolecode = 'TeamLead' AND pm.leftatutc IS NULL))
       AND (ps.statuscode = 'Active'
            OR p.startdate >= $1::date AND p.startdate <= $2::date
            OR p.enddate >= $1::date AND p.enddate <= $2::date)`,
      [from, to, userPk]
    );
    return result.rows;
  }

  const result = await query<ArchivedProjectRow>(
    `${base}
     AND EXISTS (SELECT 1 FROM work.projectmembers pm
                 WHERE pm.projectid = p.projectid AND pm.userid = $3
                 AND pm.leftatutc IS NULL)
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

export const getProjectMembers = async (projectIds: number[]): Promise<MemberRow[]> => {
  if (projectIds.length === 0) return [];
  const result = await query<MemberRow>(
    `SELECT projectid, userid, memberrolecode
     FROM work.projectmembers
     WHERE projectid = ANY($1::int[]) AND leftatutc IS NULL`,
    [projectIds]
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
  to: string
): Promise<DistRow[]> => {
  if (projectIds.length === 0) return [];

  const result = await query<{ name: string; value: number }>(
    `SELECT ts.statuscode AS name, COUNT(*)::int AS value
     FROM work.tasks t
     JOIN work.taskstatuses ts ON ts.taskstatusid = t.taskstatusid
      WHERE t.projectid = ANY($1::int[]) AND t.archivedatutc IS NULL AND t.parenttaskid IS NULL
      GROUP BY ts.statuscode
      ORDER BY MIN(ts.sortorder)`,
     [projectIds, from, to]
   );

   // Map DB codes to display names
   const statusNames: Record<string, string> = {
     Todo: 'Todo',
     InProgress: 'In Progress',
     Review: 'Review',
     Blocked: 'Blocked',
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
  to: string
): Promise<DistRow[]> => {
  if (projectIds.length === 0) return [];

  const result = await query<{ name: string; value: number }>(
    `SELECT pr.prioritycode AS name, COUNT(*)::int AS value
     FROM work.tasks t
     JOIN work.priorities pr ON pr.priorityid = t.priorityid
     JOIN work.taskstatuses ts ON ts.taskstatusid = t.taskstatusid
      WHERE t.projectid = ANY($1::int[]) AND t.archivedatutc IS NULL AND t.parenttaskid IS NULL
      GROUP BY pr.prioritycode
      ORDER BY pr.prioritycode`,
     [projectIds, from, to]
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
  to: string
): Promise<TrendRow[]> => {
  if (projectIds.length === 0) return [];

  const result = await query<TrendRow>(
    `SELECT dates.date::text,
            COALESCE(SUM(created.cnt)::int, 0) AS created,
            COALESCE(SUM(completed.cnt)::int, 0) AS completed
     FROM generate_series($2::date, $3::date, '1 day') dates(date)
     LEFT JOIN (
       SELECT t.createdatutc::date AS d, COUNT(*)::int AS cnt
       FROM work.tasks t
       WHERE t.projectid = ANY($1::int[]) AND t.archivedatutc IS NULL AND t.parenttaskid IS NULL
         AND t.createdatutc::date >= $2::date AND t.createdatutc::date <= $3::date
       GROUP BY t.createdatutc::date
     ) created ON created.d = dates.date
     LEFT JOIN (
        SELECT t.completedatutc::date AS d, COUNT(*)::int AS cnt
        FROM work.tasks t
        JOIN work.taskstatuses ts ON ts.taskstatusid = t.taskstatusid
        WHERE t.projectid = ANY($1::int[]) AND t.archivedatutc IS NULL AND t.parenttaskid IS NULL
          AND ts.iscompletedstate AND t.completedatutc::date >= $2::date AND t.completedatutc::date <= $3::date
        GROUP BY t.completedatutc::date
      ) completed ON completed.d = dates.date
      GROUP BY dates.date
      ORDER BY dates.date`,
     [projectIds, from, to]
   );
  return result.rows;
};

// ────────────────────────────────────────────────────────────
// Workload: task counts grouped by assignee
// ────────────────────────────────────────────────────────────

export interface WorkloadRow {
  userid: number;
  active: number;
  completed: number;
  review: number;
  overdue: number;
}

export const getWorkload = async (projectIds: number[], from: string, to: string): Promise<WorkloadRow[]> => {
  if (projectIds.length === 0) return [];

  const result = await query<WorkloadRow>(
    `SELECT
       ta.userid,
       COALESCE(SUM(CASE WHEN ts.statuscode NOT IN ('Done', 'Review') AND NOT ts.iscompletedstate THEN 1 ELSE 0 END), 0)::int AS active,
       COALESCE(SUM(CASE WHEN ts.iscompletedstate THEN 1 ELSE 0 END), 0)::int AS completed,
       COALESCE(SUM(CASE WHEN ts.statuscode = 'Review' THEN 1 ELSE 0 END), 0)::int AS review,
       COALESCE(SUM(CASE WHEN NOT ts.iscompletedstate AND t.duedate < CURRENT_DATE THEN 1 ELSE 0 END), 0)::int AS overdue
     FROM work.taskassignees ta
     JOIN work.tasks t ON t.taskid = ta.taskid AND t.archivedatutc IS NULL AND t.parenttaskid IS NULL
     JOIN work.taskstatuses ts ON ts.taskstatusid = t.taskstatusid
     WHERE ta.unassignedatutc IS NULL
       AND t.projectid = ANY($1::int[])
       AND ((t.duedate >= $2::date AND t.duedate <= $3::date)
            OR NOT ts.iscompletedstate)
     GROUP BY ta.userid
      ORDER BY active DESC`,
     [projectIds, from, to]
   );
  return result.rows;
};

// ────────────────────────────────────────────────────────────
// Deadlines: tasks grouped by urgency
// ────────────────────────────────────────────────────────────

export interface TaskDeadlineRow {
  id: string;
  title: string;
  status: string;
  priority: string;
  dueDate: string;
  assigneeId: string;
}

export const getDeadlineBucketTasks = async (
  projectIds: number[],
  bucket: 'today' | 'tomorrow' | 'upcoming' | 'overdue'
): Promise<TaskDeadlineRow[]> => {
  if (projectIds.length === 0) return [];

  let dateFilter: string;
  switch (bucket) {
    case 'today':
      dateFilter = `t.duedate = CURRENT_DATE`;
      break;
    case 'tomorrow':
      dateFilter = `t.duedate = CURRENT_DATE + 1`;
      break;
    case 'upcoming':
      dateFilter = `t.duedate > CURRENT_DATE + 1 AND t.duedate <= CURRENT_DATE + 7`;
      break;
    case 'overdue':
      dateFilter = `t.duedate < CURRENT_DATE`;
      break;
  }

  const result = await query<TaskDeadlineRow>(
    `SELECT
       'tsk-' || t.taskid AS id,
       t.title,
       ts.statuscode AS status,
       pr.prioritycode AS priority,
       t.duedate::text AS "dueDate",
       'usr-' || ta.userid AS "assigneeId"
     FROM work.tasks t
     JOIN work.taskstatuses ts ON ts.taskstatusid = t.taskstatusid
     JOIN work.priorities pr ON pr.priorityid = t.priorityid
     LEFT JOIN LATERAL (
       SELECT userid FROM work.taskassignees
       WHERE taskid = t.taskid AND unassignedatutc IS NULL
       LIMIT 1
     ) ta ON true
     WHERE t.projectid = ANY($1::int[])
        AND t.archivedatutc IS NULL AND t.parenttaskid IS NULL
        AND NOT ts.iscompletedstate
       AND ${dateFilter}
     ORDER BY t.duedate, t.taskid`,
    [projectIds]
  );

  // Map status/priority codes to display names
  const statusMap: Record<string, string> = {
    Todo: 'Todo',
    InProgress: 'In Progress',
    Review: 'Review',
    Blocked: 'Blocked',
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

export const getTeamStats = async (projectIds: number[], from: string, to: string): Promise<TeamStatRow[]> => {
  if (projectIds.length === 0) return [];

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
      LEFT JOIN work.tasks t ON t.projectid = pm.projectid AND t.archivedatutc IS NULL AND t.parenttaskid IS NULL
     LEFT JOIN work.taskstatuses ts ON ts.taskstatusid = t.taskstatusid
     WHERE pm.projectid = ANY($1::int[])
       AND (t.taskid IS NULL
            OR (t.duedate >= $2::date AND t.duedate <= $3::date)
            OR NOT ts.iscompletedstate
            OR ts.iscompletedstate IS NULL)
     GROUP BY d.departmentname
      ORDER BY tasks DESC`,
     [projectIds, from, to]
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
    totalMinutes: number;
    totalRecords: number;
  }>(queryText, params);

  const row = result.rows[0] || { present: 0, late: 0, absent: 0, onLeave: 0, halfDay: 0, totalMinutes: 0, totalRecords: 0 };
  return {
    present: row.present,
    late: row.late,
    absent: row.absent,
    onLeave: row.onLeave,
    halfDay: row.halfDay,
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
       COALESCE(ar.workingminutes, 0) AS "totalHours",
       (SELECT COUNT(*) FROM hr.attendancepunches ap WHERE ap.attendancerecordid = ar.attendancerecordid)::int AS "breaksCount"
     FROM hr.attendancerecords ar
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
      `SELECT COUNT(*)::int AS count FROM hr.leaverequests WHERE requeststatus = 'Pending'`
    ),
    query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM hr.attendancecorrectionrequests WHERE requeststatus = 'Pending'`
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
  totalMinutesToday: number;
  totalRecordsToday: number;
}

export const getTodayAttendance = async (): Promise<TodayAttendanceResult> => {
  const result = await query<TodayAttendanceResult>(
    `SELECT
       COALESCE(SUM(CASE WHEN astatus.statuscode = 'Present' THEN 1 ELSE 0 END), 0)::int AS "presentToday",
       COALESCE(SUM(CASE WHEN astatus.statuscode = 'Absent' THEN 1 ELSE 0 END), 0)::int AS "absentToday",
       COALESCE(SUM(CASE WHEN astatus.statuscode = 'Leave' THEN 1 ELSE 0 END), 0)::int AS "onLeaveToday",
       COALESCE(SUM(CASE WHEN astatus.statuscode = 'Late' THEN 1 ELSE 0 END), 0)::int AS "lateToday",
       COALESCE(SUM(ar.workingminutes), 0)::int AS "totalMinutesToday",
       COUNT(*)::int AS "totalRecordsToday"
     FROM hr.attendancerecords ar
     JOIN hr.attendancestatuses astatus ON astatus.attendancestatusid = ar.attendancestatusid
     WHERE ar.workdate = CURRENT_DATE`
  );
  const row = result.rows[0] || { presentToday: 0, absentToday: 0, onLeaveToday: 0, lateToday: 0, totalMinutesToday: 0, totalRecordsToday: 0 };
  return row;
};
