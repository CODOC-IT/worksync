import { supabase } from '../../../utils/supabase';
import { Project, Task, TaskPriority, TaskStatus } from '../../types';

interface TaskRow {
  taskid: number;
  projectid: number;
  tasknumber: number;
  title: string;
  description: string;
  taskstatusid: number;
  priorityid: number;
  startdate: string;
  duedate: string;
  createdbyuserid: number;
  completionsummary: string | null;
  createdatutc: string;
}

interface TaskAssigneeRow {
  taskid: number;
  userid: number;
  unassignedatutc: string | null;
}

interface TaskDependencyRow {
  taskid: number;
  dependsontaskid: number;
}

const statusByCode: Record<string, TaskStatus> = {
  Todo: 'Todo',
  InProgress: 'In Progress',
  Review: 'Review',
  Done: 'Done',
  Blocked: 'Blocked'
};

const priorityByCode: Record<string, TaskPriority> = {
  Low: 'Low',
  Medium: 'Medium',
  High: 'High',
  Critical: 'Urgent'
};

const frontendId = (prefix: 'prj' | 'tsk' | 'usr', value: number | string) =>
  `${prefix}-${value}`;

export const loadTasksFromSupabase = async (
  projects: Project[]
): Promise<Task[] | null> => {
  if (!supabase) return null;

  const [
    tasksResponse,
    statusesResponse,
    prioritiesResponse,
    assigneesResponse,
    dependenciesResponse
  ] = await Promise.all([
    supabase
      .schema('work')
      .from('tasks')
      .select(
        'taskid, projectid, tasknumber, title, description, taskstatusid, priorityid, startdate, duedate, createdbyuserid, completionsummary, createdatutc'
      )
      .is('archivedatutc', null)
      .order('createdatutc', { ascending: false }),
    supabase
      .schema('work')
      .from('taskstatuses')
      .select('taskstatusid, statuscode'),
    supabase
      .schema('work')
      .from('priorities')
      .select('priorityid, prioritycode'),
    supabase
      .schema('work')
      .from('taskassignees')
      .select('taskid, userid, unassignedatutc')
      .is('unassignedatutc', null),
    supabase
      .schema('work')
      .from('taskdependencies')
      .select('taskid, dependsontaskid')
  ]);

  const queryError = [
    tasksResponse.error,
    statusesResponse.error,
    prioritiesResponse.error,
    assigneesResponse.error,
    dependenciesResponse.error
  ].find(Boolean);

  if (queryError) {
    throw new Error(queryError.message);
  }

  const statuses = new Map(
    (statusesResponse.data || []).map((row) => [
      row.taskstatusid,
      row.statuscode
    ])
  );
  const priorities = new Map(
    (prioritiesResponse.data || []).map((row) => [
      row.priorityid,
      row.prioritycode
    ])
  );
  const assigneesByTask = new Map<number, string[]>();
  const dependenciesByTask = new Map<number, string[]>();

  ((assigneesResponse.data || []) as TaskAssigneeRow[]).forEach((row) => {
    const assignees = assigneesByTask.get(row.taskid) || [];
    assignees.push(frontendId('usr', row.userid));
    assigneesByTask.set(row.taskid, assignees);
  });

  ((dependenciesResponse.data || []) as TaskDependencyRow[]).forEach((row) => {
    const dependencies = dependenciesByTask.get(row.taskid) || [];
    dependencies.push(frontendId('tsk', row.dependsontaskid));
    dependenciesByTask.set(row.taskid, dependencies);
  });

  return ((tasksResponse.data || []) as TaskRow[]).map((row) => {
    const projectId = frontendId('prj', row.projectid);
    const project = projects.find((item) => item.id === projectId);
    const assigneeIds = assigneesByTask.get(row.taskid) || [];
    const statusCode = statuses.get(row.taskstatusid) || 'Todo';
    const priorityCode = priorities.get(row.priorityid) || 'Medium';

    return {
      id: frontendId('tsk', row.taskid),
      taskNumber: `${project?.code || `PRJ-${row.projectid}`}-${row.tasknumber}`,
      projectId,
      title: row.title,
      description: row.description,
      status: (statusByCode as Record<string, TaskStatus>)[statusCode as string] || 'Todo',
      priority: (priorityByCode as Record<string, TaskPriority>)[priorityCode as string] || 'Medium',
      startDate: row.startdate,
      dueDate: row.duedate,
      assigneeId: assigneeIds[0] || '',
      assigneeIds,
      creatorId: frontendId('usr', row.createdbyuserid),
      estimatedHours: 0,
      subtasks: [],
      dependencies: dependenciesByTask.get(row.taskid) || [],
      tags: ['Task'],
      attachments: [],
      approvalStatus: 'Approved',
      completionSummary: row.completionsummary || undefined,
      createdAt: row.createdatutc.split('T')[0]
    };
  });
};
