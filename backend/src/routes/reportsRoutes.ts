import { Router, Response } from 'express';
import { authenticateJWT, AuthenticatedRequest } from '../middleware/authMiddleware.js';
import { toUserPk, fromUserPk } from '../utils/idMapping.js';
import * as repo from '../reports/reports.repository.js';
import { query } from '../db/pool.js';
import { attendanceRole, getEffectiveRoles } from '../auth/effectiveRoles.js';

const router = Router();

const STATUS_DISPLAY: Record<string, string> = {
  Todo: 'Todo',
  InProgress: 'In Progress',
  Review: 'Review',
  Blocked: 'Blocked',
  Done: 'Done',
};

const PRIORITY_DISPLAY: Record<string, string> = {
  Low: 'Low',
  Medium: 'Medium',
  High: 'High',
  Critical: 'Urgent',
};

function validateDateRange(from: string, to: string): string | null {
  const today = new Date().toISOString().split('T')[0];
  if (from > today) return 'From Date cannot be in the future.';
  if (to > today) return 'To Date cannot be in the future.';
  if (to < from) return 'To Date cannot be earlier than From Date.';
  return null;
}

// GET /api/reports/data — returns complete report data
router.get('/data', authenticateJWT, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const user = req.user!;
    const { from, to } = req.query as { from?: string; to?: string };

    if (!from || !to) {
      res.status(400).json({ success: false, message: 'Date range (from, to) is required.' });
      return;
    }

    const dateError = validateDateRange(from, to);
    if (dateError) {
      res.status(400).json({ success: false, message: dateError });
      return;
    }

    const userId = user.id;
    const userPk = toUserPk(userId);
    const role = user.role;
    const effectiveAttendanceRole = attendanceRole(await getEffectiveRoles(user.id));

    // ── Resolve visible projects based on role ──────────────
    const visibleProjects = await repo.findProjectsForRole(userPk, role, from, to);
    const projectIds = visibleProjects.map((p) => p.projectid);

    // ── Archived projects (visible to role) ─────────────────
    const archivedProjects = await repo.getArchivedProjects(userPk, role, from, to);
    const archivedCount = archivedProjects.length;

    // ── Overview stats ──────────────────────────────────────
    const overview = await repo.getOverviewStats(projectIds, from, to);
    const members = await repo.getProjectMembers(projectIds);
    const uniqueMemberIds = new Set(members.map((m) => m.userid));

    // ── Project details with progress ───────────────────────
    const projectStats = await repo.getProjectStats(projectIds, from, to);
    const activeProjectDetails = projectStats.map((ps) => {
      const progress = ps.totalTasks > 0 ? Math.round((ps.completedTasks / ps.totalTasks) * 100) : 0;
      const projectMembers = members.filter((m) => m.projectid === ps.projectid);
      const teamLeadMember = projectMembers.find((m) => m.memberrolecode === 'TeamLead');
      const teamLeadId = teamLeadMember ? fromUserPk(teamLeadMember.userid) : fromUserPk(ps.owneruserid);
      const healthLabel = progress >= 70 ? 'On Track' : progress >= 40 ? 'At Risk' : 'Needs Attention';

      return {
        id: `prj-${ps.projectid}`,
        title: ps.projectname,
        code: ps.projectcode,
        status: ps.statuscode === 'PendingActivation' ? 'Pending Approval'
               : ps.statuscode === 'OnHold' ? 'On Hold'
               : ps.statuscode,
        progress,
        taskCount: ps.totalTasks,
        overdueCount: ps.overdueTasks,
        startDate: ps.startdate,
        targetDate: ps.enddate,
        teamLeadId,
        memberIds: projectMembers.map((m) => fromUserPk(m.userid)),
        healthLabel,
      };
    });

    const projectDetails = [
      ...activeProjectDetails,
      ...archivedProjects.map((ap) => ({
        id: `prj-${ap.projectid}`,
        title: ap.projectname,
        code: ap.projectcode,
        status: 'Archived',
        progress: 0,
        taskCount: 0,
        overdueCount: 0,
        startDate: ap.startdate,
        targetDate: ap.enddate,
        teamLeadId: fromUserPk(ap.owneruserid),
        memberIds: [],
        healthLabel: 'Archived',
      })),
    ];

    // ── Task distributions ──────────────────────────────────
    const statusDistribution = await repo.getTaskStatusDistribution(projectIds, from, to);
    const priorityDistribution = await repo.getTaskPriorityDistribution(projectIds, from, to);

    // ── Completion trend ────────────────────────────────────
    const completionTrendRaw = await repo.getCompletionTrend(projectIds, from, to);
    const completionTrend = completionTrendRaw.map((t) => ({
      date: t.date.slice(5),
      Completed: t.completed,
      Created: t.created,
    }));

    // ── Workload ────────────────────────────────────────────
    const workloadRows = await repo.getWorkload(projectIds, from, to);
    const assigneePks = workloadRows.map((w) => w.userid);
    const userNames = assigneePks.length > 0 ? await repo.getUserNames(assigneePks) : [];
    const userNameMap = new Map(userNames.map((u) => [u.userid, u.displayname]));
    const workload = workloadRows.map((w) => ({
      userId: fromUserPk(w.userid),
      name: userNameMap.get(w.userid) || fromUserPk(w.userid),
      active: w.active,
      completed: w.completed,
      review: w.review,
      overdue: w.overdue,
    }));

    // ── Deadlines ───────────────────────────────────────────
    const [dueToday, dueTomorrow, upcoming, overdue] = await Promise.all([
      repo.getDeadlineBucketTasks(projectIds, 'today'),
      repo.getDeadlineBucketTasks(projectIds, 'tomorrow'),
      repo.getDeadlineBucketTasks(projectIds, 'upcoming'),
      repo.getDeadlineBucketTasks(projectIds, 'overdue'),
    ]);

    // ── Team stats ──────────────────────────────────────────
    const teamStatsRaw = await repo.getTeamStats(projectIds, from, to);
    const teamStats = teamStatsRaw.map((t) => ({
      department: t.department,
      members: t.members,
      projects: t.projects,
      tasks: t.tasks,
      completed: t.completed,
      rate: t.tasks > 0 ? Math.round((t.completed / t.tasks) * 100) : 0,
    }));

    // ── Attendance ──────────────────────────────────────────
    let attendance = null;
    let hrOverviewStats = null;

    // Attendance reporting is restricted to active Admin/HR attendance permissions.
    if (effectiveAttendanceRole === 'Admin' || effectiveAttendanceRole === 'HR') {
      const visibleUsers = await query<{ userid: number }>(
        `SELECT u.userid
           FROM iam.users u
          WHERE u.accountstatus = 'Active'
            AND NOT EXISTS (
              SELECT 1 FROM iam.userroles ur
              JOIN iam.roles r ON r.roleid = ur.roleid
              WHERE ur.userid = u.userid AND r.rolecode = 'Administrator'
                AND ur.revokedatutc IS NULL AND ur.startsatutc <= now()
                AND (ur.endsatutc IS NULL OR ur.endsatutc > now())
            )`
      );
      const attendanceUserPks = visibleUsers.rows.map((row) => row.userid);
      if (effectiveAttendanceRole === 'HR') attendanceUserPks.push(userPk);
      const uniqueAttendanceUserPks = [...new Set(attendanceUserPks)];
      const attStats = await repo.getAttendanceStats(from, to, uniqueAttendanceUserPks);
      const attRecords = await repo.getAttendanceRecords(from, to, uniqueAttendanceUserPks);
      const pending = await repo.getPendingRequests();
      const todayAtt = await repo.getTodayAttendance(uniqueAttendanceUserPks);

      const totalHours = attStats.totalHours;
      const avgHours = attStats.totalRecords > 0 ? (totalHours / attStats.totalRecords).toFixed(1) : '0';
      const avgHoursToday = todayAtt.totalRecordsToday > 0
        ? (todayAtt.totalMinutesToday / 60 / todayAtt.totalRecordsToday).toFixed(1)
        : '0';

      attendance = {
        present: attStats.present,
        late: attStats.late,
        absent: attStats.absent,
        onLeave: attStats.onLeave,
        halfDay: attStats.halfDay,
        avgHours,
        total: attStats.totalRecords,
        pendingCorrections: pending.pendingCorrections,
        pendingLeaves: pending.pendingLeaves,
        records: attRecords,
      };

      hrOverviewStats = {
        presentToday: todayAtt.presentToday,
        absentToday: todayAtt.absentToday,
        onLeaveToday: todayAtt.onLeaveToday,
        lateToday: todayAtt.lateToday,
        avgHours: avgHoursToday,
        pendingLeaveReqs: pending.pendingLeaves,
        pendingCorrections: pending.pendingCorrections,
      };
    }

    res.json({
      success: true,
      data: {
        overview: {
          totalProjects: overview.totalProjects,
          activeTasks: overview.activeTasks,
          completedTasks: overview.completedTasks,
          overdueTasks: overview.overdueTasks,
          archivedCount,
          completionRate: overview.totalTasks > 0
            ? Math.round((overview.completedTasks / overview.totalTasks) * 100)
            : 0,
          activeMembers: uniqueMemberIds.size,
        },
        projects: projectDetails,
        tasks: {
          statusDistribution,
          priorityDistribution,
          completionTrend,
        },
        workload,
        deadlines: { dueToday, dueTomorrow, upcoming, overdue },
        teams: teamStats,
        attendance,
        hrOverviewStats,
        dateRange: { from, to },
        role,
      },
    });
  } catch (err: any) {
    console.error('[Reports Data Error]', err);
    res.status(500).json({ success: false, message: 'Failed to generate report data.', details: err.message });
  }
});

// GET /api/reports/export — exports report as CSV
router.get('/export', authenticateJWT, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const user = req.user!;
    const { from, to, type = 'overview' } = req.query as { from?: string; to?: string; type?: string };

    if (!from || !to) {
      res.status(400).json({ success: false, message: 'Date range (from, to) is required.' });
      return;
    }

    const dateError = validateDateRange(from, to);
    if (dateError) {
      res.status(400).json({ success: false, message: dateError });
      return;
    }

    const userPk = toUserPk(user.id);
    const role = user.role;
    const visibleProjects = await repo.findProjectsForRole(userPk, role, from, to);
    const projectIds = visibleProjects.map((p) => p.projectid);

    const escapeCsv = (value: string): string => `"${value.replace(/"/g, '""')}"`;

    let csvContent = '';

    if (type === 'projects') {
      const stats = await repo.getProjectStats(projectIds, from, to);
      const members = await repo.getProjectMembers(projectIds);
      const header = ['Project', 'Code', 'Status', 'Progress %', 'Start Date', 'End Date'].map(escapeCsv).join(',');
      const rows = stats.map((ps) => {
        const progress = ps.totalTasks > 0 ? Math.round((ps.completedTasks / ps.totalTasks) * 100) : 0;
        const status = ps.statuscode === 'PendingActivation' ? 'Pending Approval'
                       : ps.statuscode === 'OnHold' ? 'On Hold'
                       : ps.statuscode;
        return [ps.projectname, ps.projectcode, status, String(progress), ps.startdate, ps.enddate]
          .map(escapeCsv).join(',');
      });
      csvContent = [header, ...rows].join('\n');
    } else if (type === 'tasks') {
      const statusDist = await repo.getTaskStatusDistribution(projectIds, from, to);
      const priorityDist = await repo.getTaskPriorityDistribution(projectIds, from, to);
      csvContent = [
        ['Metric', 'Value'].map(escapeCsv).join(','),
        ['Total Tasks', String(statusDist.reduce((s, d) => s + d.value, 0))].map(escapeCsv).join(','),
        ...statusDist.map((d) => [d.name, String(d.value)].map(escapeCsv).join(',')),
        ['---', '---'].map(escapeCsv).join(','),
        ...priorityDist.map((d) => [d.name, String(d.value)].map(escapeCsv).join(',')),
      ].join('\n');
    } else {
      const overviewStats = await repo.getOverviewStats(projectIds, from, to);
      csvContent = [
        ['Metric', 'Value'].map(escapeCsv).join(','),
        ['Total Projects', String(overviewStats.totalProjects)].map(escapeCsv).join(','),
        ['Total Tasks', String(overviewStats.totalTasks)].map(escapeCsv).join(','),
        ['Completed Tasks', String(overviewStats.completedTasks)].map(escapeCsv).join(','),
        ['Overdue Tasks', String(overviewStats.overdueTasks)].map(escapeCsv).join(','),
        ['Completion Rate', overviewStats.totalTasks > 0
          ? `${Math.round((overviewStats.completedTasks / overviewStats.totalTasks) * 100)}%`
          : '0%'].map(escapeCsv).join(','),
      ].join('\n');
    }

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="report_${type}_${from}_${to}.csv"`);
    res.send(csvContent);
  } catch (err: any) {
    console.error('[Reports Export Error]', err);
    res.status(500).json({ success: false, message: 'Failed to export report.' });
  }
});

export default router;
