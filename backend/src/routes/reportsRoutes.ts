import { Router, Response } from 'express';
import { authenticateJWT, AuthenticatedRequest } from '../middleware/authMiddleware.js';
import { userStore } from '../store/userStore.js';
import { projectStore } from '../store/projectStore.js';

const router = Router();

function toDateString(date: Date): string {
  return date.toISOString().split('T')[0];
}

function validateDateRange(from: string, to: string): string | null {
  const today = toDateString(new Date());
  if (from > today) return 'From Date cannot be in the future.';
  if (to > today) return 'To Date cannot be in the future.';
  if (to < from) return 'To Date cannot be earlier than From Date.';
  return null;
}

function isInRange(dateStr: string | undefined, from: string, to: string): boolean {
  if (!dateStr) return false;
  const d = dateStr.slice(0, 10);
  return d >= from && d <= to;
}

function escapeCsv(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

// GET /api/reports/data — returns aggregated report data filtered by role
router.get('/data', authenticateJWT, (req: AuthenticatedRequest, res: Response): void => {
  try {
    const user = req.user!;
    const userProfile = userStore.findById(user.id);
    if (!userProfile) {
      res.status(404).json({ success: false, message: 'User not found.' });
      return;
    }

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

    const role = userProfile.role;
    const userId = user.id;

    const allProjects = projectStore.getAllProjects();
    const allTasks = projectStore.getAllTasks();

    let visibleProjects = allProjects;
    let visibleTasks = allTasks;

    if (role === 'Team_Lead') {
      visibleProjects = allProjects.filter((p) => p.ownerUserId === userId);
      const leadProjectIds = visibleProjects.map((p) => p.id);
      visibleTasks = allTasks.filter((t) => leadProjectIds.includes(t.projectId));
    } else if (role === 'Team_Member') {
      visibleProjects = allProjects.filter((p) => p.memberIds.includes(userId));
      visibleTasks = allTasks.filter((t) => t.assigneeId === userId);
    }

    const filteredProjects = visibleProjects.filter(
      (p) => isInRange(p.startDate, from, to) || isInRange(p.endDate, from, to) || p.status === 'Active'
    );

    const filteredTasks = visibleTasks.filter(
      (t) => isInRange(t.dueDate, from, to) || t.status !== 'Done'
    );

    const completed = filteredTasks.filter((t) => t.status === 'Done').length;
    const active = filteredTasks.filter((t) => t.status !== 'Done').length;
    const overdue = filteredTasks.filter((t) => t.status !== 'Done' && t.dueDate < toDateString(new Date())).length;

    const statusCounts: Record<string, number> = { Todo: 0, 'In Progress': 0, Review: 0, Done: 0, Blocked: 0 };
    filteredTasks.forEach((t) => { statusCounts[t.status] = (statusCounts[t.status] || 0) + 1; });

    const priorityCounts: Record<string, number> = { Low: 0, Medium: 0, High: 0, Urgent: 0 };
    filteredTasks.forEach((t) => { priorityCounts[t.priority] = (priorityCounts[t.priority] || 0) + 1; });

    res.json({
      success: true,
      data: {
        projects: filteredProjects.map((p) => ({
          id: p.id,
          code: p.code,
          title: p.title,
          status: p.status,
          taskCount: filteredTasks.filter((t) => t.projectId === p.id).length,
          startDate: p.startDate,
          endDate: p.endDate
        })),
        tasks: {
          total: filteredTasks.length,
          completed,
          active,
          overdue,
          completionRate: filteredTasks.length > 0 ? Math.round((completed / filteredTasks.length) * 100) : 0,
          statusDistribution: statusCounts,
          priorityDistribution: priorityCounts
        },
        dateRange: { from, to },
        role
      }
    });
  } catch (err: any) {
    console.error('[Reports Data Error]', err);
    res.status(500).json({ success: false, message: 'Failed to generate report data.' });
  }
});

// GET /api/reports/export — exports report as CSV
router.get('/export', authenticateJWT, (req: AuthenticatedRequest, res: Response): void => {
  try {
    const user = req.user!;
    const userProfile = userStore.findById(user.id);
    if (!userProfile) {
      res.status(404).json({ success: false, message: 'User not found.' });
      return;
    }

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

    const role = userProfile.role;
    const userId = user.id;

    const allProjects = projectStore.getAllProjects();
    const allTasks = projectStore.getAllTasks();
    const allUsers = userStore.getAllUsers();
    const userNameMap: Record<string, string> = {};
    allUsers.forEach((u) => { userNameMap[u.id] = u.name; });

    let visibleProjects = allProjects;
    let visibleTasks = allTasks;

    if (role === 'Team_Lead') {
      visibleProjects = allProjects.filter((p) => p.ownerUserId === userId);
      const leadProjectIds = visibleProjects.map((p) => p.id);
      visibleTasks = allTasks.filter((t) => leadProjectIds.includes(t.projectId));
    } else if (role === 'Team_Member') {
      visibleProjects = allProjects.filter((p) => p.memberIds.includes(userId));
      visibleTasks = allTasks.filter((t) => t.assigneeId === userId);
    }

    const filteredProjects = visibleProjects.filter(
      (p) => isInRange(p.startDate, from, to) || isInRange(p.endDate, from, to) || p.status === 'Active'
    );
    const filteredTasks = visibleTasks.filter(
      (t) => isInRange(t.dueDate, from, to) || t.status !== 'Done'
    );

    let csvContent = '';

    if (type === 'projects') {
      csvContent = [
        ['Project', 'Code', 'Status', 'Start', 'End', 'Owner'].map(escapeCsv).join(','),
        ...filteredProjects.map((p) =>
          [p.title, p.code, p.status, p.startDate, p.endDate, userNameMap[p.ownerUserId] || p.ownerUserId]
            .map(escapeCsv).join(',')
        )
      ].join('\n');
    } else if (type === 'tasks') {
      csvContent = [
        ['Task', 'Status', 'Priority', 'Due Date', 'Assignee', 'Project'].map(escapeCsv).join(','),
        ...filteredTasks.map((t) => {
          const project = visibleProjects.find((p) => p.id === t.projectId);
          return [t.title, t.status, t.priority, t.dueDate, userNameMap[t.assigneeId] || t.assigneeId, project?.title || '']
            .map(escapeCsv).join(',');
        })
      ].join('\n');
    } else {
      const completed = filteredTasks.filter((t) => t.status === 'Done').length;
      const overdue = filteredTasks.filter((t) => t.status !== 'Done' && t.dueDate < toDateString(new Date())).length;
      csvContent = [
        ['Metric', 'Value'].map(escapeCsv).join(','),
        ['Total Projects', String(filteredProjects.length)].map(escapeCsv).join(','),
        ['Total Tasks', String(filteredTasks.length)].map(escapeCsv).join(','),
        ['Completed Tasks', String(completed)].map(escapeCsv).join(','),
        ['Overdue Tasks', String(overdue)].map(escapeCsv).join(','),
        ['Completion Rate', filteredTasks.length > 0 ? `${Math.round((completed / filteredTasks.length) * 100)}%` : '0%'].map(escapeCsv).join(',')
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
