import {
  User,
  Project,
  Task,
  AttendanceRecord,
  HRRequest,
  SystemApproval,
  ChatMessage,
  AIQueryLog,
  AIUsageAudit,
  NotificationItem,
  ActivityLogItem,
  CalendarEvent,
  SavedPrompt,
  WeeklySummaryDraft
} from '../types';

export const INITIAL_USERS: User[] = [
  {
    id: 'usr-1',
    name: 'Alexander Wright',
    email: 'alexander.w@cyberoffice.io',
    role: 'Admin',
    department: 'Executive Operations',
    avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
    title: 'Managing Director & Operations Oversight',
    status: 'active',
    lastActive: 'Just now'
  },
  {
    id: 'usr-2',
    name: 'Elena Rostova',
    email: 'elena.r@cyberoffice.io',
    role: 'Team_Lead',
    department: 'Engineering',
    avatar: 'https://images.unsplash.com/photo-1580489944761-15a19d654956?w=150&auto=format&fit=crop&q=80',
    title: 'Lead Software Architect',
    status: 'active',
    lastActive: '2 mins ago'
  },
  {
    id: 'usr-3',
    name: 'Marcus Vance',
    email: 'marcus.v@cyberoffice.io',
    role: 'HR',
    department: 'Human Resources & People Ops',
    avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80',
    title: 'Head of People Operations',
    status: 'active',
    lastActive: '10 mins ago'
  },
  {
    id: 'usr-4',
    name: 'Sophia Chen',
    email: 'sophia.c@cyberoffice.io',
    role: 'Team_Member',
    department: 'Engineering',
    avatar: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=150&auto=format&fit=crop&q=80',
    title: 'Senior Frontend Engineer',
    status: 'active',
    lastActive: 'Just now'
  },
  {
    id: 'usr-5',
    name: 'Liam Gallagher',
    email: 'liam.g@cyberoffice.io',
    role: 'Team_Member',
    department: 'Product Design',
    avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150&auto=format&fit=crop&q=80',
    title: 'Lead Product Designer',
    status: 'away',
    lastActive: '25 mins ago'
  },
  {
    id: 'usr-6',
    name: 'Priya Sharma',
    email: 'priya.s@cyberoffice.io',
    role: 'Team_Lead',
    department: 'AI Research',
    avatar: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=150&auto=format&fit=crop&q=80',
    title: 'AI Product Lead',
    status: 'active',
    lastActive: '1 hr ago'
  },
  {
    id: 'usr-7',
    name: 'Derrick Miller',
    email: 'derrick.m@cyberoffice.io',
    role: 'Team_Member',
    department: 'QA & Infrastructure',
    avatar: 'https://images.unsplash.com/photo-1492562080023-ab3db95bfbce?w=150&auto=format&fit=crop&q=80',
    title: 'DevOps & Reliability Engineer',
    status: 'active',
    lastActive: 'Just now'
  },
  {
    id: 'usr-8',
    name: 'Aisha Omar',
    email: 'aisha.o@cyberoffice.io',
    role: 'HR',
    department: 'Human Resources & People Ops',
    avatar: 'https://images.unsplash.com/photo-1531746020798-e6953c6e8e04?w=150&auto=format&fit=crop&q=80',
    title: 'HR Compliance Officer',
    status: 'inactive',
    lastActive: 'Yesterday'
  }
];

export const INITIAL_PROJECTS: Project[] = [
  {
    id: 'prj-1',
    code: 'PROJ-NX',
    title: 'Nexus AI Copilot Integration',
    description: 'Next-gen LLM copilot engine embedded across all workstation tools for automated code reviews and task summaries.',
    status: 'Active',
    approvalStatus: 'Approved',
    createdBy: 'usr-1',
    teamLeadId: 'usr-2',
    memberIds: ['usr-2', 'usr-4', 'usr-5', 'usr-7'],
    startDate: '2026-06-01',
    targetDate: '2026-08-30',
    progress: 68,
    tags: ['AI', 'Core Platform', 'High Priority'],
    pinnedMessagesCount: 4,
    milestones: [
      { id: 'm-1', title: 'Context Retrieval Engine Pipeline', dueDate: '2026-07-10', completed: true },
      { id: 'm-2', title: 'Kanban & Chat Auto-Summarizer', dueDate: '2026-07-28', completed: false },
      { id: 'm-3', title: 'Security Audit & Rate Limit Shield', dueDate: '2026-08-15', completed: false }
    ],
    files: [
      { id: 'f-1', name: 'copilot_architecture_v2.pdf', size: '4.2 MB', type: 'PDF', uploadedBy: 'usr-2', uploadedAt: '2026-07-15', url: '#' },
      { id: 'f-2', name: 'prompt_grounding_benchmark.json', size: '890 KB', type: 'JSON', uploadedBy: 'usr-4', uploadedAt: '2026-07-20', url: '#' }
    ]
  },
  {
    id: 'prj-2',
    code: 'PROJ-KG',
    title: 'Kinetic Glass Design System',
    description: 'Comprehensive UI token library and glassmorphic micro-interaction framework powering the entire product suit.',
    status: 'Active',
    approvalStatus: 'Approved',
    createdBy: 'usr-1',
    teamLeadId: 'usr-6',
    memberIds: ['usr-5', 'usr-4'],
    startDate: '2026-05-15',
    targetDate: '2026-09-01',
    progress: 82,
    tags: ['Design System', 'Frontend', 'Kinetic Glass'],
    pinnedMessagesCount: 2,
    milestones: [
      { id: 'm-4', title: 'Token Foundation & Color Math', dueDate: '2026-06-01', completed: true },
      { id: 'm-5', title: '3D Parallax & Cursor Radial Glow', dueDate: '2026-07-12', completed: true },
      { id: 'm-6', title: 'Accessibility Contrast Audit', dueDate: '2026-08-05', completed: false }
    ],
    files: [
      { id: 'f-3', name: 'kinetic_tokens_v1.fig', size: '18.4 MB', type: 'Figma', uploadedBy: 'usr-5', uploadedAt: '2026-07-02', url: '#' }
    ]
  },
  {
    id: 'prj-3',
    code: 'PROJ-AT',
    title: 'Automated Attendance & HR Vault',
    description: 'Live clocking, multi-break counter, automated leave policy exceptions, and HR approval portal.',
    status: 'Active',
    approvalStatus: 'Approved',
    createdBy: 'usr-3',
    teamLeadId: 'usr-2',
    memberIds: ['usr-3', 'usr-4', 'usr-8'],
    startDate: '2026-06-15',
    targetDate: '2026-08-20',
    progress: 45,
    tags: ['HR Tech', 'Compliance', 'Attendance'],
    pinnedMessagesCount: 1,
    milestones: [
      { id: 'm-7', title: 'Multi-Break Timer Engine', dueDate: '2026-07-18', completed: true },
      { id: 'm-8', title: 'HR Exception Approval Queue', dueDate: '2026-08-01', completed: false }
    ],
    files: []
  },
  {
    id: 'prj-4',
    code: 'PROJ-OS',
    title: 'OmniStream Realtime Communication',
    description: 'Ultra-low latency web-sockets messaging with pinned message caps, @mentions, and file previews.',
    status: 'Pending Approval',
    approvalStatus: 'Pending Approval',
    createdBy: 'usr-2', // Team Lead created -> needs Admin approval!
    teamLeadId: 'usr-2',
    memberIds: ['usr-2', 'usr-7'],
    startDate: '2026-08-01',
    targetDate: '2026-10-30',
    progress: 10,
    tags: ['WebSockets', 'Realtime', 'Pending Approval'],
    pinnedMessagesCount: 0,
    milestones: [
      { id: 'm-9', title: 'Socket Connection Mesh', dueDate: '2026-08-20', completed: false }
    ],
    files: []
  },
  {
    id: 'prj-5',
    code: 'PROJ-QA',
    title: 'Zero-Trust Security & Backup Vault',
    description: 'Automated database snapshots, Admin two-step deactivation flow safeguards, and audit log vault.',
    status: 'Active',
    approvalStatus: 'Approved',
    createdBy: 'usr-1',
    teamLeadId: 'usr-2',
    memberIds: ['usr-7', 'usr-2'],
    startDate: '2026-04-01',
    targetDate: '2026-07-30',
    progress: 95,
    tags: ['Security', 'DevOps', 'Admin Oversight'],
    pinnedMessagesCount: 3,
    milestones: [
      { id: 'm-10', title: 'Database Export & Snapshot Utility', dueDate: '2026-07-01', completed: true }
    ],
    files: []
  },
  {
    id: 'prj-6',
    code: 'PROJ-LEG',
    title: 'Legacy Monolith Migration',
    description: 'Archived project representing the initial monolithic refactoring pass.',
    status: 'Archived',
    approvalStatus: 'Approved',
    createdBy: 'usr-1',
    teamLeadId: 'usr-2',
    memberIds: ['usr-2', 'usr-4'],
    startDate: '2025-01-01',
    targetDate: '2025-12-31',
    progress: 100,
    tags: ['Archived', 'Legacy'],
    pinnedMessagesCount: 0,
    milestones: [],
    files: []
  }
];

export const INITIAL_TASKS: Task[] = [
  {
    id: 'tsk-101',
    taskNumber: 'NX-12',
    projectId: 'prj-1',
    title: 'Implement Issue & PR Markdown Composer tab in AI Assistant',
    description: 'Build a dedicated sub-view in AI Assistant with type picker, live Markdown preview, code snippet insertion, and exact finalized PR template output.',
    status: 'In Progress',
    priority: 'Urgent',
    assigneeId: 'usr-4',
    creatorId: 'usr-2',
    dueDate: '2026-07-26',
    estimatedHours: 12,
    approvalStatus: 'Approved',
    tags: ['AI Assistant', 'PR Template', 'Frontend'],
    dependencies: [],
    subtasks: [
      { id: 'sub-1', title: 'Template string definition with exact headings', completed: true },
      { id: 'sub-2', title: 'Live split-pane markdown renderer', completed: true },
      { id: 'sub-3', title: 'Copy to clipboard & download .md button', completed: false }
    ],
    attachments: [
      { id: 'ta-1', name: 'pr_composer_wireframe.png', size: '1.2 MB', type: 'PNG', uploadedBy: 'usr-5', uploadedAt: '2026-07-22' }
    ],
    createdAt: '2026-07-21'
  },
  {
    id: 'tsk-102',
    taskNumber: 'NX-15',
    projectId: 'prj-1',
    title: 'Grounding Context Picker for Task & Project Data',
    description: 'Enable selecting a specific project or task to supply structured mock context into prompt generation.',
    status: 'Todo',
    priority: 'High',
    assigneeId: 'usr-4',
    creatorId: 'usr-2',
    dueDate: '2026-07-29',
    estimatedHours: 8,
    approvalStatus: 'Approved',
    tags: ['AI Assistant', 'Context Grounding'],
    dependencies: ['tsk-101'],
    subtasks: [
      { id: 'sub-4', title: 'Multi-select dropdown with project badge filters', completed: false },
      { id: 'sub-5', title: 'Mock context serialization handler', completed: false }
    ],
    attachments: [],
    createdAt: '2026-07-22'
  },
  {
    id: 'tsk-103',
    taskNumber: 'KG-04',
    projectId: 'prj-2',
    title: 'Cursor-reactive Radial Glow & 3D Parallax Tilt Cards',
    description: 'Add mouse position tracking on Kinetic Glass cards for soft radial light bleed and spring-damped 3D perspective shift.',
    status: 'Review',
    priority: 'Medium',
    assigneeId: 'usr-5',
    creatorId: 'usr-6',
    dueDate: '2026-07-25',
    estimatedHours: 14,
    approvalStatus: 'Approved',
    workSummary: 'Implemented tilt calculations using motion spring values and pointer coordinates. Tested across project grid and dashboard widgets.',
    tags: ['Animation', 'Kinetic Glass', 'Framer Motion'],
    dependencies: [],
    subtasks: [
      { id: 'sub-6', title: 'Math calculations for mouse rotateX/rotateY', completed: true },
      { id: 'sub-7', title: 'Fallback for prefers-reduced-motion', completed: true }
    ],
    attachments: [],
    createdAt: '2026-07-18'
  },
  {
    id: 'tsk-104',
    taskNumber: 'AT-08',
    projectId: 'prj-3',
    title: 'Multi-Break Counter & HR Review Queue Integration',
    description: 'Build running break timer for Lunch, Short Break, and Other. Route break policy exceptions and attendance corrections to HR queue.',
    status: 'Done',
    priority: 'Urgent',
    assigneeId: 'usr-4',
    creatorId: 'usr-3',
    dueDate: '2026-07-23',
    estimatedHours: 16,
    approvalStatus: 'Approved',
    completionSummary: 'Fully functional break counter with live interval timer and separate HR approval queue.',
    tags: ['HR', 'Attendance', 'Break Timer'],
    dependencies: [],
    subtasks: [
      { id: 'sub-8', title: 'Live break timer hook', completed: true },
      { id: 'sub-9', title: 'HR review action handlers', completed: true }
    ],
    attachments: [],
    createdAt: '2026-07-15'
  },
  {
    id: 'tsk-105',
    taskNumber: 'NX-22',
    projectId: 'prj-1',
    title: 'Optimize Vector Embedding Search Cache',
    description: 'Blocked due to pending security rate limiter approval from DevOps team.',
    status: 'Blocked',
    priority: 'High',
    assigneeId: 'usr-7',
    creatorId: 'usr-2',
    dueDate: '2026-07-27',
    estimatedHours: 10,
    approvalStatus: 'Approved',
    blockerReason: 'Awaiting clearance on rate-limit headers from DevOps security policy audit.',
    tags: ['Backend', 'Security', 'Blocked'],
    dependencies: [],
    subtasks: [],
    attachments: [],
    createdAt: '2026-07-20'
  },
  {
    id: 'tsk-106',
    taskNumber: 'OS-01',
    projectId: 'prj-4',
    title: 'Implement Pinned Messages Cap (~10) in Project Chat',
    description: 'Create pinned messages side panel with max 10 pins, pin/unpin micro-animation, and reverse-chronological order.',
    status: 'Todo',
    priority: 'Medium',
    assigneeId: 'usr-2',
    creatorId: 'usr-2',
    dueDate: '2026-08-05',
    estimatedHours: 6,
    approvalStatus: 'Pending Approval', // Pending Admin Approval!
    tags: ['Chat', 'Pending Approval'],
    dependencies: [],
    subtasks: [],
    attachments: [],
    createdAt: '2026-07-23'
  },
  {
    id: 'tsk-107',
    taskNumber: 'KG-09',
    projectId: 'prj-2',
    title: 'Dark/Light Theme Sweep Animation',
    description: 'Animate dark and light mode toggle with radial sweep overlay rather than instantaneous color jump.',
    status: 'In Progress',
    priority: 'Low',
    assigneeId: 'usr-5',
    creatorId: 'usr-6',
    dueDate: '2026-07-30',
    estimatedHours: 5,
    approvalStatus: 'Approved',
    pendingEdit: {
      id: 'ed-1',
      taskId: 'tsk-107',
      requestedBy: 'usr-5',
      field: 'dueDate',
      oldValue: '2026-07-28',
      newValue: '2026-07-30',
      reason: 'Additional time required to handle safari clip-path radial sweep compatibility.',
      status: 'Pending',
      createdAt: '2026-07-23 14:30'
    },
    tags: ['Theme', 'Animation'],
    dependencies: [],
    subtasks: [],
    attachments: [],
    createdAt: '2026-07-19'
  },
  {
    id: 'tsk-108',
    taskNumber: 'QA-03',
    projectId: 'prj-5',
    title: 'Two-Step Admin Deactivation Confirmation Modal',
    description: 'Build fail-safe dialog flow requiring explicit second confirmation and preventing deactivation of the last Admin.',
    status: 'In Progress',
    priority: 'High',
    assigneeId: 'usr-7',
    creatorId: 'usr-1',
    dueDate: '2026-07-28',
    estimatedHours: 8,
    approvalStatus: 'Approved',
    tags: ['Security', 'Settings', 'Admin Oversight'],
    dependencies: [],
    subtasks: [
      { id: 'sub-10', title: 'Check count of active Admins before allowing submit', completed: true },
      { id: 'sub-11', title: 'Step 2 secondary password/phrase confirmation UI', completed: true }
    ],
    attachments: [],
    createdAt: '2026-07-22'
  }
];

export const INITIAL_ATTENDANCE: AttendanceRecord[] = [
  {
    id: 'att-1',
    userId: 'usr-4', // Sophia Chen
    date: '2026-07-24',
    checkIn: '08:52',
    status: 'Present',
    totalHours: 4.5,
    breaks: [
      { id: 'brk-1', type: 'Short Break', startTime: '10:30', endTime: '10:45', durationMinutes: 15 }
    ]
  },
  {
    id: 'att-2',
    userId: 'usr-2', // Elena Rostova
    date: '2026-07-24',
    checkIn: '08:45',
    status: 'Present',
    totalHours: 4.8,
    breaks: [
      { id: 'brk-2', type: 'Lunch', startTime: '12:00', endTime: '12:45', durationMinutes: 45 }
    ]
  },
  {
    id: 'att-3',
    userId: 'usr-5', // Liam Gallagher
    date: '2026-07-24',
    checkIn: '09:18',
    status: 'Late',
    totalHours: 3.8,
    breaks: []
  },
  {
    id: 'att-4',
    userId: 'usr-1', // Alexander Wright
    date: '2026-07-24',
    checkIn: '08:30',
    status: 'Present',
    totalHours: 5.1,
    breaks: [
      { id: 'brk-3', type: 'Short Break', startTime: '11:15', endTime: '11:25', durationMinutes: 10 }
    ]
  }
];

export const INITIAL_HR_REQUESTS: HRRequest[] = [
  {
    id: 'hrq-1',
    userId: 'usr-5',
    type: 'Correction',
    date: '2026-07-23',
    reason: 'Forgot to check out on time due to late release call with client.',
    status: 'Pending',
    details: {
      requestedCheckIn: '09:00',
      requestedCheckOut: '18:15'
    },
    submittedAt: '2026-07-24 08:30'
  },
  {
    id: 'hrq-2',
    userId: 'usr-7',
    type: 'Leave',
    date: '2026-07-31',
    reason: 'Medical checkup and dental appointment.',
    status: 'Pending',
    details: {
      leaveType: 'Casual',
      leaveDays: 1
    },
    submittedAt: '2026-07-23 16:45'
  },
  {
    id: 'hrq-3',
    userId: 'usr-4',
    type: 'Break_Exception',
    date: '2026-07-22',
    reason: 'Extended emergency tech support call required 25 min extra break.',
    status: 'Pending',
    details: {
      extraBreakMinutes: 25
    },
    submittedAt: '2026-07-23 09:10'
  }
];

export const INITIAL_SYSTEM_APPROVALS: SystemApproval[] = [
  {
    id: 'app-101',
    type: 'Project_Creation',
    targetId: 'prj-4',
    targetTitle: 'OmniStream Realtime Communication',
    requestedBy: 'usr-2',
    requestedRole: 'Team_Lead',
    createdAt: '2026-07-23 11:20',
    details: 'New WebSocket messaging architecture proposal for real-time team synchronization.',
    status: 'Pending'
  },
  {
    id: 'app-102',
    type: 'Task_Creation',
    targetId: 'tsk-106',
    targetTitle: 'Implement Pinned Messages Cap (~10) in Project Chat',
    requestedBy: 'usr-2',
    requestedRole: 'Team_Lead',
    createdAt: '2026-07-23 11:25',
    details: 'Task created under pending project OmniStream.',
    status: 'Pending'
  },
  {
    id: 'app-103',
    type: 'Controlled_Edit',
    targetId: 'tsk-107',
    targetTitle: 'Dark/Light Theme Sweep Animation',
    requestedBy: 'usr-5',
    requestedRole: 'Team_Member',
    createdAt: '2026-07-23 14:30',
    details: 'Controlled field edit: Proposed due date extension.',
    status: 'Pending',
    proposedDiff: {
      field: 'Due Date',
      oldValue: '2026-07-28',
      newValue: '2026-07-30'
    }
  }
];

export const INITIAL_CHAT_MESSAGES: ChatMessage[] = [
  {
    id: 'msg-1',
    projectId: 'prj-1',
    senderId: 'usr-2',
    message: 'Welcome team! @Sophia Chen and @Liam Gallagher, let\'s prioritize the AI Assistant PR template tab first.',
    timestamp: 'Today, 09:15',
    isPinned: true
  },
  {
    id: 'msg-2',
    projectId: 'prj-1',
    senderId: 'usr-4',
    message: 'Working on tsk-101 right now. The live Markdown split preview looks sharp in Kinetic Glass dark mode!',
    timestamp: 'Today, 09:40',
    isPinned: false
  },
  {
    id: 'msg-3',
    projectId: 'prj-1',
    senderId: 'usr-5',
    message: 'Attached the updated glassmorphic design token specs. Check f-3 in project files when you get a chance.',
    timestamp: 'Today, 10:12',
    isPinned: true
  },
  {
    id: 'msg-4',
    projectId: 'prj-1',
    senderId: 'usr-1',
    message: 'Great progress. Remember that all controlled field edits must be routed for Team Lead/Admin approval.',
    timestamp: 'Today, 10:30',
    isPinned: true
  }
];

export const INITIAL_AI_LOGS: AIQueryLog[] = [
  {
    id: 'qlog-1',
    userId: 'usr-4',
    userName: 'Sophia Chen',
    userRole: 'Team_Member',
    queryText: 'Which tasks are overdue in Project Nexus AI Copilot integration this week?',
    scopeTouched: 'Project: Nexus AI Copilot (prj-1), Tasks [tsk-101, tsk-102]',
    timestamp: '2026-07-24 10:15',
    responseSummary: 'Identified 1 task nearing deadline (tsk-101 due July 26). Provided summary breakdown.'
  },
  {
    id: 'qlog-2',
    userId: 'usr-2',
    userName: 'Elena Rostova',
    userRole: 'Team_Lead',
    queryText: 'Draft weekly summary digest for project Kinetic Glass Design System.',
    scopeTouched: 'Project: Kinetic Glass (prj-2), Milestones [m-4, m-5, m-6]',
    timestamp: '2026-07-24 09:00',
    responseSummary: 'Generated weekly progress digest with 82% overall completion and 0 active blockers.'
  },
  {
    id: 'qlog-3',
    userId: 'usr-1',
    userName: 'Alexander Wright',
    userRole: 'Admin',
    queryText: 'System-wide audit of pending project approvals and HR attendance exceptions.',
    scopeTouched: 'All Projects (6), System Approvals (3), HR Requests (3)',
    timestamp: '2026-07-23 17:30',
    responseSummary: 'Summarized 1 pending project creation, 1 task creation, 1 controlled edit, and 3 HR requests.'
  }
];

export const INITIAL_AI_AUDIT: AIUsageAudit[] = [
  {
    id: 'audit-1',
    userId: 'usr-4',
    userName: 'Sophia Chen',
    projectTitle: 'Nexus AI Copilot Integration',
    prCount: 8,
    issuesCount: 14,
    tokensUsed: 42500,
    toolUsed: 'PR & Issue Composer',
    lastUsed: 'Today 10:15'
  },
  {
    id: 'audit-2',
    userId: 'usr-2',
    userName: 'Elena Rostova',
    projectTitle: 'Nexus AI Copilot Integration',
    prCount: 12,
    issuesCount: 19,
    tokensUsed: 68100,
    toolUsed: 'Weekly Digest & Grounded Assistant',
    lastUsed: 'Today 09:00'
  },
  {
    id: 'audit-3',
    userId: 'usr-5',
    userName: 'Liam Gallagher',
    projectTitle: 'Kinetic Glass Design System',
    prCount: 5,
    issuesCount: 7,
    tokensUsed: 29400,
    toolUsed: 'PR & Issue Composer',
    lastUsed: 'Yesterday'
  }
];

export const INITIAL_NOTIFICATIONS: NotificationItem[] = [
  {
    id: 'notif-1',
    userId: 'usr-1', // Admin
    title: 'New Project Pending Approval',
    message: 'Elena Rostova created project "OmniStream Realtime Communication". Admin approval required.',
    type: 'approval',
    read: false,
    timestamp: '1 hr ago',
    linkRoute: 'approvals'
  },
  {
    id: 'notif-2',
    userId: 'usr-3', // HR
    title: 'New HR Attendance Correction Request',
    message: 'Liam Gallagher submitted an attendance correction request for July 23.',
    type: 'attendance',
    read: false,
    timestamp: '2 hrs ago',
    linkRoute: 'attendance'
  },
  {
    id: 'notif-3',
    userId: 'usr-4', // Sophia
    title: 'Task Assigned',
    message: 'You were assigned to "Implement Issue & PR Markdown Composer tab".',
    type: 'task',
    read: true,
    timestamp: '3 hrs ago',
    linkRoute: 'tasks'
  }
];

export const INITIAL_ACTIVITY_LOGS: ActivityLogItem[] = [
  {
    id: 'act-1',
    userId: 'usr-4',
    userName: 'Sophia Chen',
    userAvatar: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=150&auto=format&fit=crop&q=80',
    action: 'Updated task status to Review',
    targetType: 'Task',
    targetId: 'tsk-103',
    targetTitle: 'Cursor-reactive Radial Glow & 3D Parallax Tilt Cards',
    timestamp: '2026-07-24 10:45',
    diff: {
      field: 'status',
      oldVal: 'In Progress',
      newVal: 'Review'
    }
  },
  {
    id: 'act-2',
    userId: 'usr-2',
    userName: 'Elena Rostova',
    userAvatar: 'https://images.unsplash.com/photo-1580489944761-15a19d654956?w=150&auto=format&fit=crop&q=80',
    action: 'Submitted new Project proposal',
    targetType: 'Project',
    targetId: 'prj-4',
    targetTitle: 'OmniStream Realtime Communication',
    timestamp: '2026-07-23 11:20',
    diff: {
      field: 'approvalStatus',
      oldVal: 'Draft',
      newVal: 'Pending Admin Approval'
    }
  },
  {
    id: 'act-3',
    userId: 'usr-5',
    userName: 'Liam Gallagher',
    userAvatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150&auto=format&fit=crop&q=80',
    action: 'Proposed controlled field edit for Task due date',
    targetType: 'Task',
    targetId: 'tsk-107',
    targetTitle: 'Dark/Light Theme Sweep Animation',
    timestamp: '2026-07-23 14:30',
    diff: {
      field: 'dueDate',
      oldVal: '2026-07-28',
      newVal: '2026-07-30'
    }
  }
];

export const INITIAL_CALENDAR_EVENTS: CalendarEvent[] = [
  {
    id: 'cal-1',
    title: 'Nexus Copilot AI Sprint Review',
    date: '2026-07-28',
    time: '14:00 - 15:30',
    type: 'Review',
    projectId: 'prj-1'
  },
  {
    id: 'cal-2',
    title: 'Kinetic Design Token Hand-off',
    date: '2026-07-29',
    time: '11:00 - 12:00',
    type: 'Milestone',
    projectId: 'prj-2'
  },
  {
    id: 'cal-3',
    title: 'HR Compliance Quarterly Review',
    date: '2026-07-30',
    time: '09:30 - 10:30',
    type: 'Meeting'
  },
  {
    id: 'cal-4',
    title: 'Derrick Miller - Approved Casual Leave',
    date: '2026-07-31',
    time: 'All Day',
    type: 'Leave'
  }
];

export const INITIAL_SAVED_PROMPTS: SavedPrompt[] = [
  {
    id: 'p-1',
    title: 'Overdue Task Scoped Diagnostic',
    promptText: 'Analyze all tasks under selected project with status != Done and dueDate < today. Categorize by assignee and suggest immediate resolution actions.',
    category: 'Project Management'
  },
  {
    id: 'p-2',
    title: 'Pull Request AI Usage Disclosure',
    promptText: 'Generate a standardized AI disclosure block detailing tool used, prompt technique, mistakes corrected, and token consumption.',
    category: 'Engineering & Code'
  },
  {
    id: 'p-3',
    title: 'Weekly Executive Briefing Draft',
    promptText: 'Summarize completed milestones, active blockers, overdue items, and key wins into a 3-bullet executive digest suitable for stakeholders.',
    category: 'Reporting'
  }
];

export const INITIAL_WEEKLY_DRAFT: WeeklySummaryDraft = {
  id: 'ws-1',
  projectId: 'prj-1',
  weekEnding: '2026-07-26',
  progressSummary: 'Nexus AI Copilot integration reached 68% milestone completion this week. Primary focus was placed on grounding context retrievers and PR template synthesis.',
  blockersText: 'Task NX-22 remains blocked pending security rate limit policy audit from DevOps.',
  overdueTasksCount: 0,
  completedTasksCount: 4,
  keyHighlights: [
    'Completed PR & Issue Composer tab inside AI Assistant',
    'Integrated live Markdown split previewer with exact template structure',
    'Grounded context selector passing structured mock fixtures to AI prompts'
  ],
  recipientChannel: 'Project Chat',
  generatedAt: '2026-07-24 08:30'
};
