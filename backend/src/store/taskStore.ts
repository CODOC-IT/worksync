import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

export type StoredTaskStatus = 'Todo' | 'In Progress' | 'Review' | 'Done' | 'Blocked';
export type StoredTaskPriority = 'Low' | 'Medium' | 'High' | 'Urgent';

export interface StoredTask {
  id: string;
  taskNumber: string;
  projectId: string;
  title: string;
  description: string;
  status: StoredTaskStatus;
  priority: StoredTaskPriority;
  startDate: string;
  assigneeId: string;
  assigneeIds: string[];
  creatorId: string;
  dueDate: string;
  estimatedHours: number;
  subtasks: [];
  dependencies: string[];
  tags: string[];
  attachments: [];
  approvalStatus: 'Approved';
  createdAt: string;
}

export interface CreateStoredTaskInput {
  projectId: string;
  projectCode: string;
  title: string;
  description: string;
  status: StoredTaskStatus;
  priority: StoredTaskPriority;
  startDate: string;
  assigneeIds: string[];
  creatorId: string;
  dueDate: string;
}

export interface UpdateStoredTaskInput {
  title?: string;
  description?: string;
  status?: StoredTaskStatus;
  priority?: StoredTaskPriority;
  startDate?: string;
  assigneeIds?: string[];
  dueDate?: string;
}

const TASK_DB_PATH = process.env.TASK_DB_PATH
  ? path.resolve(process.env.TASK_DB_PATH)
  : path.resolve(process.cwd(), 'database', 'tasks_db.json');

const initialTask = (
  id: string,
  taskNumber: string,
  projectId: string,
  title: string,
  description: string,
  status: StoredTaskStatus,
  priority: StoredTaskPriority,
  assigneeId: string,
  creatorId: string,
  startDate: string,
  dueDate: string,
  dependencies: string[] = []
): StoredTask => ({
  id,
  taskNumber,
  projectId,
  title,
  description,
  status,
  priority,
  startDate,
  assigneeId,
  assigneeIds: [assigneeId],
  creatorId,
  dueDate,
  estimatedHours: 8,
  subtasks: [],
  dependencies,
  tags: ['Task'],
  attachments: [],
  approvalStatus: 'Approved',
  createdAt: startDate
});

const INITIAL_TASKS: StoredTask[] = [
  initialTask(
    'tsk-101',
    'NX-12',
    'prj-1',
    'Implement Issue & PR Markdown Composer tab in AI Assistant',
    'Build a dedicated sub-view in AI Assistant with type picker, live Markdown preview, code snippet insertion, and exact finalized PR template output.',
    'In Progress',
    'Urgent',
    'usr-4',
    'usr-2',
    '2026-07-21',
    '2026-07-26'
  ),
  initialTask(
    'tsk-102',
    'NX-15',
    'prj-1',
    'Grounding Context Picker for Task & Project Data',
    'Enable selecting a specific project or task to supply structured context into prompt generation.',
    'Todo',
    'High',
    'usr-4',
    'usr-2',
    '2026-07-22',
    '2026-07-29',
    ['tsk-101']
  ),
  initialTask(
    'tsk-103',
    'KG-04',
    'prj-2',
    'Cursor-reactive Radial Glow & 3D Parallax Tilt Cards',
    'Add mouse position tracking for radial light bleed and spring-damped 3D perspective shift.',
    'Review',
    'Medium',
    'usr-5',
    'usr-6',
    '2026-07-18',
    '2026-07-25'
  ),
  initialTask(
    'tsk-104',
    'AT-08',
    'prj-3',
    'Multi-Break Counter & HR Review Queue Integration',
    'Build running break timers and route policy exceptions to the HR review queue.',
    'Done',
    'Urgent',
    'usr-4',
    'usr-3',
    '2026-07-15',
    '2026-07-23'
  ),
  initialTask(
    'tsk-105',
    'NX-22',
    'prj-1',
    'Optimize Vector Embedding Search Cache',
    'Blocked due to pending security rate limiter approval from DevOps.',
    'Blocked',
    'High',
    'usr-7',
    'usr-2',
    '2026-07-20',
    '2026-07-27'
  ),
  initialTask(
    'tsk-106',
    'OS-01',
    'prj-4',
    'Implement Pinned Messages Cap (~10) in Project Chat',
    'Create a pinned messages panel with a maximum of ten pinned messages.',
    'Todo',
    'Medium',
    'usr-2',
    'usr-2',
    '2026-07-24',
    '2026-08-05'
  ),
  initialTask(
    'tsk-107',
    'KG-09',
    'prj-2',
    'Dark/Light Theme Sweep Animation',
    'Animate the dark and light mode toggle with a radial sweep overlay.',
    'In Progress',
    'Low',
    'usr-5',
    'usr-6',
    '2026-07-23',
    '2026-07-30'
  ),
  initialTask(
    'tsk-108',
    'QA-03',
    'prj-5',
    'Two-Step Admin Deactivation Confirmation Modal',
    'Build a fail-safe confirmation flow for administrator deactivation.',
    'In Progress',
    'High',
    'usr-7',
    'usr-2',
    '2026-07-22',
    '2026-07-28'
  )
];

const cloneTask = (task: StoredTask): StoredTask => ({
  ...task,
  assigneeIds: [...task.assigneeIds],
  dependencies: [...task.dependencies],
  tags: [...task.tags],
  subtasks: [],
  attachments: []
});

class TaskStore {
  private tasks = new Map<string, StoredTask>();

  constructor() {
    this.load();
  }

  private load(): void {
    try {
      if (fs.existsSync(TASK_DB_PATH)) {
        const storedTasks = JSON.parse(fs.readFileSync(TASK_DB_PATH, 'utf-8')) as StoredTask[];
        storedTasks.forEach((task) => this.tasks.set(task.id, cloneTask(task)));
        return;
      }
    } catch (error: any) {
      console.error(`[TaskStore] Failed to load persisted tasks: ${error.message}`);
    }

    INITIAL_TASKS.forEach((task) => this.tasks.set(task.id, cloneTask(task)));
    this.persist();
  }

  private persist(): void {
    try {
      fs.mkdirSync(path.dirname(TASK_DB_PATH), { recursive: true });
      fs.writeFileSync(
        TASK_DB_PATH,
        JSON.stringify(Array.from(this.tasks.values()), null, 2),
        'utf-8'
      );
    } catch (error: any) {
      console.error(`[TaskStore] Failed to persist tasks: ${error.message}`);
    }
  }

  list(): StoredTask[] {
    return Array.from(this.tasks.values())
      .map(cloneTask)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  create(input: CreateStoredTaskInput): StoredTask {
    const projectPrefix = input.projectCode.replace(/^PROJ-/, '') || input.projectCode;
    const nextTaskNumber = this.list()
      .filter((task) => task.projectId === input.projectId)
      .reduce((highest, task) => {
        const match = task.taskNumber.match(/-(\d+)$/);
        return match ? Math.max(highest, Number(match[1])) : highest;
      }, 0) + 1;

    const task: StoredTask = {
      id: `tsk-${randomUUID()}`,
      taskNumber: `${projectPrefix}-${String(nextTaskNumber).padStart(2, '0')}`,
      projectId: input.projectId,
      title: input.title,
      description: input.description,
      status: input.status,
      priority: input.priority,
      startDate: input.startDate,
      assigneeId: input.assigneeIds[0],
      assigneeIds: [...input.assigneeIds],
      creatorId: input.creatorId,
      dueDate: input.dueDate,
      estimatedHours: 8,
      subtasks: [],
      dependencies: [],
      tags: ['Task'],
      attachments: [],
      approvalStatus: 'Approved',
      createdAt: new Date().toISOString().split('T')[0]
    };

    this.tasks.set(task.id, task);
    this.persist();
    return cloneTask(task);
  }

  getById(taskId: string): StoredTask | undefined {
    const task = this.tasks.get(taskId);
    return task ? cloneTask(task) : undefined;
  }

  update(taskId: string, input: UpdateStoredTaskInput): StoredTask | undefined {
    const existing = this.tasks.get(taskId);
    if (!existing) return undefined;

    const assigneeIds = input.assigneeIds?.length
      ? [...input.assigneeIds]
      : existing.assigneeIds;
    const updated: StoredTask = {
      ...existing,
      ...input,
      assigneeId: assigneeIds[0],
      assigneeIds
    };

    this.tasks.set(taskId, updated);
    this.persist();
    return cloneTask(updated);
  }

  delete(taskId: string): StoredTask | undefined {
    const existing = this.tasks.get(taskId);
    if (!existing) return undefined;

    this.tasks.delete(taskId);
    this.persist();
    return cloneTask(existing);
  }
}

export const taskStore = new TaskStore();
