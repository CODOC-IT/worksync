import assert from 'node:assert/strict';
import test from 'node:test';
import { Project, User } from '../../types';
import {
  canCreateTaskForProject,
  canDeleteTask,
  canEditTask,
  getAssignableProjectUsers,
  filterAndSortTasks,
  TaskModuleTask,
  TaskFormInput,
  validateTaskInput
} from './taskRules';
import {
  prepareTaskCreation,
  prepareTaskDeletion,
  prepareTaskUpdate
} from './taskMutations';

const users: User[] = [
  {
    id: 'admin',
    name: 'Admin',
    email: 'admin@example.com',
    role: 'Admin',
    department: 'Operations',
    title: 'Administrator',
    status: 'active'
  },
  {
    id: 'lead',
    name: 'Lead',
    email: 'lead@example.com',
    role: 'Team_Lead',
    department: 'Engineering',
    title: 'Team Lead',
    status: 'active'
  },
  {
    id: 'member',
    name: 'Member',
    email: 'member@example.com',
    role: 'Team_Member',
    department: 'Engineering',
    title: 'Developer',
    status: 'active'
  },
  {
    id: 'outsider',
    name: 'Outsider',
    email: 'outsider@example.com',
    role: 'Team_Member',
    department: 'Finance',
    title: 'Analyst',
    status: 'active'
  }
];

const project: Project = {
  id: 'project-1',
  code: 'P1',
  title: 'Project One',
  description: 'A project',
  status: 'Active',
  approvalStatus: 'Approved',
  createdBy: 'admin',
  teamLeadId: 'lead',
  memberIds: ['lead', 'member'],
  teams: [],
  startDate: '2026-07-01',
  targetDate: '2026-07-31',
  progress: 0,
  milestones: [],
  files: [],
  tags: []
};

const validInput: TaskFormInput = {
  projectId: project.id,
  title: 'Create task module',
  description: 'Build and validate the task workflow.',
  priority: 'High',
  startDate: '2026-07-28',
  dueDate: '2026-07-29',
  assigneeIds: ['member'],
  status: 'Todo'
};

const task: TaskModuleTask = {
  id: 'task-1',
  projectId: project.id,
  title: validInput.title,
  description: validInput.description,
  status: 'Todo',
  priority: 'High',
  startDate: validInput.startDate,
  dueDate: validInput.dueDate,
  assigneeId: 'member',
  assigneeIds: ['member'],
  taskNumber: 'P1-1',
  creatorId: 'admin',
  estimatedHours: 8,
  subtasks: [],
  dependencies: [],
  tags: [],
  attachments: [],
  approvalStatus: 'Approved',
  createdAt: '2026-07-28'
};

test('accepts a valid task creation request', () => {
  assert.deepEqual(validateTaskInput(validInput, project, users), {});
});

test('creates a normalized task result with project-member assignees', () => {
  const result = prepareTaskCreation(
    {
      ...validInput,
      priority: 'High',
      assigneeId: 'member',
      assigneeIds: ['member']
    },
    {
      currentRole: 'Team_Lead',
      currentUserId: 'lead',
      projects: [project],
      tasks: [],
      users
    },
    Date.parse('2026-07-28T00:00:00Z')
  );

  assert.equal(result.success, true);
  assert.equal(result.task?.creatorId, 'lead');
  assert.deepEqual(result.task?.assigneeIds, ['member']);
  assert.equal(result.task?.projectId, project.id);
});

test('rejects missing required fields', () => {
  const errors = validateTaskInput(
    { ...validInput, title: ' ', description: '', priority: '', assigneeIds: [] },
    project,
    users
  );
  assert.ok(errors.title);
  assert.ok(errors.description);
  assert.ok(errors.priority);
  assert.ok(errors.assigneeIds);
});

test('rejects invalid task and project date ranges', () => {
  const errors = validateTaskInput(
    { ...validInput, startDate: '2026-06-30', dueDate: '2026-08-01' },
    project,
    users,
    true,
    '2026-07-27'
  );
  assert.ok(errors.startDate);
  assert.ok(errors.dueDate);
});

test('rejects an assignee outside the project membership', () => {
  const errors = validateTaskInput(
    { ...validInput, assigneeIds: ['outsider'] },
    project,
    users
  );
  assert.ok(errors.assigneeIds);
});

test('shows active non-admin, non-HR members and the Team Lead as task assignees', () => {
  const inactiveMember = { ...users[1], id: 'inactive-member', status: 'inactive' as const };
  const hrMember: User = {
    ...users[1],
    id: 'hr-member',
    name: 'HR Member',
    role: 'HR',
    title: 'HR Specialist'
  };
  const projectWithInactiveMember = {
    ...project,
    memberIds: ['lead', 'member', 'admin', hrMember.id, inactiveMember.id]
  };
  const options = getAssignableProjectUsers(
    projectWithInactiveMember,
    [...users, hrMember, inactiveMember]
  );

  assert.deepEqual(options.map((user) => user.id), ['lead', 'member']);
});

test('rejects HR and Admin users as task assignees even when they are project members', () => {
  const hrMember: User = {
    ...users[1],
    id: 'hr-member',
    name: 'HR Member',
    role: 'HR',
    title: 'HR Specialist'
  };
  const projectWithAdministrativeMembers = {
    ...project,
    memberIds: ['lead', 'member', 'admin', hrMember.id]
  };

  assert.ok(validateTaskInput({ ...validInput, assigneeIds: ['admin'] }, projectWithAdministrativeMembers, [...users, hrMember]).assigneeIds);
  assert.ok(validateTaskInput({ ...validInput, assigneeIds: [hrMember.id] }, projectWithAdministrativeMembers, [...users, hrMember]).assigneeIds);
});

test('rejects duplicate assignees', () => {
  const errors = validateTaskInput(
    { ...validInput, assigneeIds: ['member', 'member'] },
    project,
    users
  );
  assert.ok(errors.assigneeIds);
});

test('rejects archived projects', () => {
  const archived = { ...project, status: 'Archived' as const };
  assert.ok(validateTaskInput(validInput, archived, users).projectId);
});

test('rejects pending project approval for task creation', () => {
  const pending = { ...project, status: 'Pending Approval' as const, approvalStatus: 'Pending Approval' as const };
  assert.equal(canCreateTaskForProject('Team_Lead', 'lead', pending), false);
});

test('enforces task creation roles and Team Lead project scope', () => {
  assert.equal(canCreateTaskForProject('Admin', 'admin', project), true);
  assert.equal(canCreateTaskForProject('Team_Lead', 'lead', project), true);
  assert.equal(canCreateTaskForProject('Team_Lead', 'outsider', project), false);
  assert.equal(canCreateTaskForProject('Team_Member', 'member', project), false);
  assert.equal(canCreateTaskForProject('Team_Member', 'lead', { ...project, teamLeadId: 'lead' }), true);
  assert.equal(canCreateTaskForProject('HR', 'outsider', project), false);
});

test('filters task lists and sorts by due date', () => {
  const later = { ...task, id: 'task-2', title: 'Later task', dueDate: '2026-07-30' };
  const result = filterAndSortTasks([later, task], [project], {
    search: 'task',
    projectId: project.id,
    status: 'Todo',
    priority: 'High',
    assigneeId: 'member',
    myTasksOnly: true,
    currentUserId: 'member',
    dueDateDirection: 'asc'
  });
  assert.deepEqual(result.map((item) => item.id), ['task-1', 'task-2']);
});

test('enforces edit and delete permission checks', () => {
  assert.equal(canEditTask('Admin', 'admin', project, task), true);
  assert.equal(canEditTask('Team_Lead', 'lead', project, task), true);
  assert.equal(canEditTask('Team_Member', 'lead', { ...project, teamLeadId: 'lead' }, task), true);
  assert.equal(canEditTask('Team_Member', 'member', project, task), true);
  assert.equal(canEditTask('Team_Member', 'outsider', project, task), false);
  assert.equal(canEditTask('Team_Member', 'member', project, { ...task, subtaskCount: 2 }), false);
  assert.equal(canEditTask('Team_Lead', 'lead', project, { ...task, subtaskCount: 2 }), true);
  assert.equal(canEditTask('Team_Member', 'member', project, {
    ...task,
    parentTaskId: 'tsk-parent',
    subtaskCount: 0
  }), true);
  assert.equal(canEditTask('Team_Member', 'lead', { ...project, teamLeadId: 'lead' }, {
    ...task,
    parentTaskId: 'tsk-parent',
    subtaskCount: 0
  }), true);
  assert.equal(canDeleteTask('Admin', 'admin', project, task), true);
  assert.equal(canDeleteTask('Team_Lead', 'lead', project, task), true);
  assert.equal(canDeleteTask('Team_Member', 'lead', { ...project, teamLeadId: 'lead' }, task), true);
  assert.equal(canDeleteTask('Team_Lead', 'lead', project, task, true), true);

  const deniedEdit = prepareTaskUpdate(task.id, { status: 'Done' }, {
    currentRole: 'Team_Member',
    currentUserId: 'outsider',
    projects: [project],
    tasks: [task],
    users
  });
  assert.equal(deniedEdit.success, false);

  const allowedContentEdit = prepareTaskUpdate(task.id, { title: 'Updated assigned task' }, {
    currentRole: 'Team_Member',
    currentUserId: 'member',
    projects: [project],
    tasks: [task],
    users
  });
  assert.equal(allowedContentEdit.success, true);

  const deniedReassignment = prepareTaskUpdate(task.id, { assigneeIds: ['lead'] }, {
    currentRole: 'Team_Member',
    currentUserId: 'member',
    projects: [project],
    tasks: [task],
    users
  });
  assert.equal(deniedReassignment.success, false);

  const deniedDelete = prepareTaskDeletion(task.id, {
    currentRole: 'Team_Member',
    currentUserId: 'member',
    projects: [project],
    tasks: [task],
    users
  });
  assert.equal(deniedDelete.success, false);
});

test('scopes Team Lead task creation and assignees to the lead\'s own team', () => {
  const teamProject: Project = {
    ...project,
    teams: [
      { id: 'tm-1', projectId: project.id, name: 'Team Alpha', description: '', leadId: 'lead', memberIds: ['lead', 'member'] },
      { id: 'tm-2', projectId: project.id, name: 'Team Beta', description: '', leadId: 'outsider', memberIds: ['outsider'] }
    ],
    memberIds: ['lead', 'member', 'outsider'],
    teamLeadId: 'lead'
  };

  assert.equal(canCreateTaskForProject('Team_Lead', 'lead', teamProject), true);
  assert.equal(canCreateTaskForProject('Team_Lead', 'outsider', teamProject), true);
  assert.deepEqual(
    getAssignableProjectUsers(teamProject, users, 'tm-1').map((user) => user.id),
    ['lead', 'member']
  );
  assert.ok(validateTaskInput(
    { ...validInput, assigneeIds: ['outsider'], teamId: 'tm-1' },
    teamProject,
    users,
    true,
    undefined,
    { allowedAssigneeIds: ['lead', 'member'] }
  ).assigneeIds);
  assert.equal(canEditTask('Team_Lead', 'outsider', teamProject, { ...task, teamId: 'tm-1' }), false);
  assert.equal(canDeleteTask('Team_Lead', 'outsider', teamProject, { ...task, teamId: 'tm-1' }), false);
});

test('makes every related task read-only while its project is archived', () => {
  const archivedProject = { ...project, status: 'Archived' as const };
  const archivedTask = { ...task, isArchived: true, archivedAt: '2026-07-30T10:00:00.000Z' };

  assert.equal(canEditTask('Team_Lead', 'lead', archivedProject, archivedTask), false);
  assert.equal(canEditTask('Team_Member', 'member', archivedProject, archivedTask), false);
  assert.equal(canDeleteTask('Team_Lead', 'lead', archivedProject, archivedTask), false);
  assert.equal(canDeleteTask('Team_Lead', 'lead', project, archivedTask), false);

  const deniedUpdate = prepareTaskUpdate(archivedTask.id, { title: 'Should not change' }, {
    currentRole: 'Team_Lead',
    currentUserId: 'lead',
    projects: [archivedProject],
    tasks: [archivedTask],
    users
  });
  assert.equal(deniedUpdate.success, false);
});

