interface BackendProject {
  id: string;
  code: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  ownerUserId: string;
  memberIds: string[];
  startDate: string;
  endDate: string;
  milestones: { id: string; title: string; dueDate: string; completed: boolean }[];
}

interface BackendTask {
  id: string;
  projectId: string;
  taskNumber: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  assigneeId: string;
  dueDate: string;
  dependencies: string[];
}

const INITIAL_PROJECTS: BackendProject[] = [
  {
    id: 'prj-1',
    code: 'PROJ-NX',
    title: 'Nexus AI Copilot Integration',
    description: 'Next-gen LLM copilot engine embedded across all workstation tools for automated code reviews and task summaries.',
    status: 'Active',
    priority: 'High',
    ownerUserId: 'usr-1',
    memberIds: ['usr-1', 'usr-2', 'usr-4', 'usr-5', 'usr-7'],
    startDate: '2026-06-01',
    endDate: '2026-08-30',
    milestones: [
      { id: 'm-1', title: 'Context Retrieval Engine Pipeline', dueDate: '2026-07-10', completed: true },
      { id: 'm-2', title: 'Kanban & Chat Auto-Summarizer', dueDate: '2026-07-28', completed: false },
      { id: 'm-3', title: 'Security Audit & Rate Limit Shield', dueDate: '2026-08-15', completed: false },
    ],
  },
  {
    id: 'prj-2',
    code: 'PROJ-KG',
    title: 'Kinetic Glass Design System',
    description: 'Comprehensive UI token library and glassmorphic micro-interaction framework powering the entire product suit.',
    status: 'Active',
    priority: 'Medium',
    ownerUserId: 'usr-1',
    memberIds: ['usr-1', 'usr-6', 'usr-5', 'usr-4'],
    startDate: '2026-05-15',
    endDate: '2026-09-01',
    milestones: [
      { id: 'm-4', title: 'Token Foundation & Color Math', dueDate: '2026-06-01', completed: true },
      { id: 'm-5', title: '3D Parallax & Cursor Radial Glow', dueDate: '2026-07-12', completed: true },
      { id: 'm-6', title: 'Accessibility Contrast Audit', dueDate: '2026-08-05', completed: false },
    ],
  },
  {
    id: 'prj-3',
    code: 'PROJ-AT',
    title: 'Automated Attendance & HR Vault',
    description: 'Live clocking, multi-break counter, automated leave policy exceptions, and HR approval portal.',
    status: 'Active',
    priority: 'High',
    ownerUserId: 'usr-3',
    memberIds: ['usr-3', 'usr-2', 'usr-4', 'usr-8'],
    startDate: '2026-06-15',
    endDate: '2026-08-20',
    milestones: [
      { id: 'm-7', title: 'Multi-Break Timer Engine', dueDate: '2026-07-18', completed: true },
      { id: 'm-8', title: 'HR Exception Approval Queue', dueDate: '2026-08-01', completed: false },
    ],
  },
  {
    id: 'prj-4',
    code: 'PROJ-OS',
    title: 'OmniStream Realtime Communication',
    description: 'Ultra-low latency web-sockets messaging with pinned message caps, @mentions, and file previews.',
    status: 'Pending Approval',
    priority: 'Medium',
    ownerUserId: 'usr-2',
    memberIds: ['usr-2', 'usr-7'],
    startDate: '2026-08-01',
    endDate: '2026-10-30',
    milestones: [
      { id: 'm-9', title: 'Socket Connection Mesh', dueDate: '2026-08-20', completed: false },
    ],
  },
  {
    id: 'prj-5',
    code: 'PROJ-QA',
    title: 'Zero-Trust Security & Backup Vault',
    description: 'Automated database snapshots, Admin two-step deactivation flow safeguards, and audit log vault.',
    status: 'Active',
    priority: 'Urgent',
    ownerUserId: 'usr-1',
    memberIds: ['usr-1', 'usr-7', 'usr-2'],
    startDate: '2026-04-01',
    endDate: '2026-07-30',
    milestones: [
      { id: 'm-10', title: 'Database Export & Snapshot Utility', dueDate: '2026-07-01', completed: true },
    ],
  },
  {
    id: 'prj-6',
    code: 'PROJ-LEG',
    title: 'Legacy Monolith Migration',
    description: 'Archived project representing the initial monolithic refactoring pass.',
    status: 'Archived',
    priority: 'Low',
    ownerUserId: 'usr-1',
    memberIds: ['usr-1', 'usr-2', 'usr-4'],
    startDate: '2025-01-01',
    endDate: '2025-12-31',
    milestones: [],
  },
];

const INITIAL_TASKS: BackendTask[] = [
  { id: 'tsk-101', projectId: 'prj-1', taskNumber: 'NX-12', title: 'Implement Issue & PR Markdown Composer tab in AI Assistant', description: 'Build a dedicated sub-view in AI Assistant with type picker, live Markdown preview, code snippet insertion, and exact finalized PR template output.', status: 'In Progress', priority: 'Urgent', assigneeId: 'usr-4', dueDate: '2026-07-26', dependencies: [] },
  { id: 'tsk-102', projectId: 'prj-1', taskNumber: 'NX-15', title: 'Grounding Context Picker for Task & Project Data', description: 'Enable selecting a specific project or task to supply structured mock context into prompt generation.', status: 'Todo', priority: 'High', assigneeId: 'usr-4', dueDate: '2026-07-29', dependencies: ['tsk-101'] },
  { id: 'tsk-103', projectId: 'prj-2', taskNumber: 'KG-04', title: 'Cursor-reactive Radial Glow & 3D Parallax Tilt Cards', description: 'Add mouse position tracking on Kinetic Glass cards for soft radial light bleed and spring-damped 3D perspective shift.', status: 'Review', priority: 'Medium', assigneeId: 'usr-5', dueDate: '2026-07-25', dependencies: [] },
  { id: 'tsk-104', projectId: 'prj-3', taskNumber: 'AT-08', title: 'Multi-Break Counter & HR Review Queue Integration', description: 'Build running break timer for Lunch, Short Break, and Other.', status: 'Done', priority: 'Urgent', assigneeId: 'usr-4', dueDate: '2026-07-23', dependencies: [] },
  { id: 'tsk-105', projectId: 'prj-1', taskNumber: 'NX-22', title: 'Optimize Vector Embedding Search Cache', description: 'Blocked due to pending security rate limiter approval from DevOps team.', status: 'Blocked', priority: 'High', assigneeId: 'usr-7', dueDate: '2026-07-27', dependencies: [] },
  { id: 'tsk-106', projectId: 'prj-4', taskNumber: 'OS-01', title: 'Implement Pinned Messages Cap (~10) in Project Chat', description: 'Create pinned messages side panel with max 10 pins.', status: 'Todo', priority: 'Medium', assigneeId: 'usr-2', dueDate: '2026-08-05', dependencies: [] },
  { id: 'tsk-107', projectId: 'prj-2', taskNumber: 'KG-09', title: 'Dark/Light Theme Sweep Animation', description: 'Animate dark and light mode toggle with radial sweep overlay.', status: 'In Progress', priority: 'Low', assigneeId: 'usr-5', dueDate: '2026-07-30', dependencies: [] },
  { id: 'tsk-108', projectId: 'prj-5', taskNumber: 'QA-03', title: 'Two-Step Admin Deactivation Confirmation Modal', description: 'Build fail-safe dialog flow for admin deactivation.', status: 'In Progress', priority: 'High', assigneeId: 'usr-7', dueDate: '2026-07-28', dependencies: [] },
];

class ProjectStore {
  private projects: Map<string, BackendProject> = new Map();
  private tasks: Map<string, BackendTask> = new Map();

  constructor() {
    INITIAL_PROJECTS.forEach((p) => this.projects.set(p.id, p));
    INITIAL_TASKS.forEach((t) => this.tasks.set(t.id, t));
  }

  getProjectsForUser(userId: string, role: string): BackendProject[] {
    if (role === 'Admin') {
      return Array.from(this.projects.values());
    }
    return Array.from(this.projects.values()).filter(
      (p) => p.memberIds.includes(userId) || p.ownerUserId === userId
    );
  }

  getProjectById(projectId: string): BackendProject | undefined {
    return this.projects.get(projectId);
  }

  isProjectAccessible(projectId: string, userId: string, role: string): boolean {
    if (role === 'Admin') return true;
    const project = this.projects.get(projectId);
    if (!project) return false;
    return project.memberIds.includes(userId) || project.ownerUserId === userId;
  }

  getTasksForProject(projectId: string, userId: string, role: string): BackendTask[] {
    if (!this.isProjectAccessible(projectId, userId, role)) return [];
    return Array.from(this.tasks.values()).filter((t) => t.projectId === projectId);
  }

  getTaskById(taskId: string): BackendTask | undefined {
    return this.tasks.get(taskId);
  }

  isTaskAccessible(taskId: string, userId: string, role: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;
    return this.isProjectAccessible(task.projectId, userId, role);
  }
}

export const projectStore = new ProjectStore();
