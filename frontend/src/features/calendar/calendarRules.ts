import { ApprovedLeaveEntry, CalendarEvent, Holiday, Project, Task } from '../../types';

// Milestones and project deadlines reuse CalendarEvent's own type vocabulary instead of
// duplicating it; 'Task Due' and 'Holiday' are the only kinds CalendarEvent has no literal for.
export type CalendarEntryKind = CalendarEvent['type'] | 'Task Due' | 'Holiday';

export type CalendarNavigateTab = 'projects' | 'tasks';

// Which side of the app an entry originates from. 'Deadline'/'Milestone' come from a Project,
// 'Task Due' comes from a Task; standalone calendarEvents (Leave) are neither and are only
// controllable via the kind filter, not the project/task origin toggle.
export type CalendarEntryOrigin = 'project' | 'task' | 'other';

export const ALL_CALENDAR_KINDS: CalendarEntryKind[] = [
  'Deadline',
  'Milestone',
  'Task Due',
  'Leave',
  'Holiday'
];

export interface CalendarEntry {
  id: string;
  date: string; // YYYY-MM-DD
  time?: string;
  title: string;
  kind: CalendarEntryKind;
  projectId?: string;
  taskId?: string;
  completed?: boolean; // milestone.completed, task.status === 'Done', or project.status === 'Completed'
  navigateTab?: CalendarNavigateTab;
  navigateId?: string;
}

export interface CalendarEntryTone {
  badgeClass: string;
  dotClass: string;
  glow: 'cyan' | 'violet' | 'emerald' | 'amber' | 'magenta' | 'none';
}

export interface CalendarYearMonth {
  month: number; // 0-11, native Date convention
  label: string;
  dates: Date[]; // 6x7 grid for this month, see getMonthGridDates
}

const MONTH_LABELS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

const pad2 = (value: number): string => value.toString().padStart(2, '0');

// Every date field on Project/Task/CalendarEvent is a plain YYYY-MM-DD string. Grid dates are
// built and read back using local Date components (never toISOString, which is UTC-based and
// can shift the calendar day in timezones ahead of UTC) so a date never drifts across days.
export const toDateKey = (date: Date): string =>
  `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;

// Mirrors the `${dateStr}T00:00:00` local-midnight parse already used in AppContext's
// due-tomorrow scanner and boardAccess.getDueDateIndicator.
export const parseDateKey = (dateKey: string): Date => new Date(`${dateKey}T00:00:00`);

// Timezone-safe "today" as a YYYY-MM-DD string, reusing toDateKey's local-getter approach (see
// its comment above). Callers that need "today" for a Calendar-relevant comparison (overdue
// checks, date-picker minimums, default due dates) should use this instead of
// `new Date().toISOString().split('T')[0]`, which reports UTC and reads a full calendar day
// behind local time for roughly 5 hours after midnight in Pakistan (UTC+5) and any other
// positive-offset timezone.
export const todayDateKey = (): string => toDateKey(new Date());

const sortByTimeThenTitle = (left: CalendarEntry, right: CalendarEntry): number => {
  const timeComparison = (left.time || '').localeCompare(right.time || '');
  return timeComparison !== 0 ? timeComparison : left.title.localeCompare(right.title);
};

// Merges project deadlines, project milestones, task due dates and standalone calendarEvents
// into one flat list of CalendarEntry. Visibility is intentionally unfiltered — every project
// and task is included regardless of role, matching ProjectsView's own (unfiltered) list.
export const buildCalendarEntries = (
  projects: Project[],
  tasks: Task[],
  calendarEvents: CalendarEvent[]
): CalendarEntry[] => {
  const entries: CalendarEntry[] = [];

  projects.forEach((project) => {
    if (project.targetDate) {
      entries.push({
        id: `deadline-${project.id}`,
        date: project.targetDate,
        title: project.title,
        kind: 'Deadline',
        projectId: project.id,
        completed: project.status === 'Completed',
        navigateTab: 'projects',
        navigateId: project.id
      });
    }

    project.milestones.forEach((milestone) => {
      if (!milestone.dueDate) return;
      entries.push({
        id: `milestone-${milestone.id}`,
        date: milestone.dueDate,
        title: milestone.title,
        kind: 'Milestone',
        projectId: project.id,
        completed: milestone.completed,
        navigateTab: 'projects',
        navigateId: project.id
      });
    });
  });

  tasks.forEach((task) => {
    if (!task.dueDate) return;
    entries.push({
      id: `task-${task.id}`,
      date: task.dueDate,
      title: task.title,
      kind: 'Task Due',
      projectId: task.projectId,
      taskId: task.id,
      completed: task.status === 'Done',
      navigateTab: 'tasks',
      navigateId: task.id
    });
  });

  calendarEvents.forEach((event) => {
    entries.push({
      id: `event-${event.id}`,
      date: event.date,
      time: event.time,
      title: event.title,
      kind: event.type,
      projectId: event.projectId,
      taskId: event.taskId,
      navigateTab: event.taskId ? 'tasks' : event.projectId ? 'projects' : undefined,
      navigateId: event.taskId || event.projectId || undefined
    });
  });

  return entries;
};

// Holiday entries, read-only on the Calendar. hr.Holidays is the single source of truth (see
// AppContext's `holidays`, fetched from GET /api/calendar/holidays) -- HR manages the underlying
// rows via Manage Holidays. `holidays` here already arrives audience-filtered per viewer (Admin/HR
// see every holiday; everyone else only the ones their audience includes them in -- see
// backend/src/calendar/calendar.service.ts's listHolidays), so this function never needs to filter
// by role itself. A recurring holiday's stored `date` is one representative occurrence; its
// month/day is repeated across every year in
// `years`. A non-recurring (dated, e.g. lunar-calendar) holiday only appears in the specific year
// its stored date falls in. `years` should cover whatever range the caller is currently
// displaying; requesting the same year twice is harmless (deduped internally).
export const buildHolidayEntries = (years: number[], holidays: Holiday[]): CalendarEntry[] => {
  const uniqueYears = Array.from(new Set(years));

  return holidays.flatMap((holiday) => {
    const [, month, day] = holiday.date.split('-');

    if (holiday.isRecurringAnnual) {
      return uniqueYears.map((year) => ({
        id: `holiday-${holiday.id}-${year}`,
        date: `${year}-${month}-${day}`,
        title: holiday.name,
        kind: 'Holiday' as const
      }));
    }

    const holidayYear = Number(holiday.date.slice(0, 4));
    if (!uniqueYears.includes(holidayYear)) return [];
    return [{
      id: `holiday-${holiday.id}`,
      date: holiday.date,
      title: holiday.name,
      kind: 'Holiday' as const
    }];
  });
};

// Approved HR leave requests, read-only on the Calendar (see AppContext's approvedLeave, sourced
// from GET /api/calendar/approved-leave). Visible to every role -- Employee/Team Lead/HR/Admin
// alike -- matching this module's existing unfiltered-visibility convention.
export const buildApprovedLeaveEntries = (approvedLeave: ApprovedLeaveEntry[]): CalendarEntry[] =>
  approvedLeave.map((leave) => ({
    id: `leave-${leave.id}`,
    date: leave.date,
    title: `${leave.userName} — ${leave.leaveType}`,
    kind: 'Leave' as const
  }));

export const entryOrigin = (entry: CalendarEntry): CalendarEntryOrigin => {
  if (entry.kind === 'Deadline' || entry.kind === 'Milestone') return 'project';
  if (entry.kind === 'Task Due') return 'task';
  return 'other';
};

// "My Deadlines" predicate, reusing the same task-assignee/project-member/project-lead
// relationships already established elsewhere (DashboardView's isMyTask, ProjectsView's
// isProjectLead/categoryFilter) rather than a new data structure. A project-origin entry counts
// only while its project is 'Active' -- Completed/Archived/On Hold/Draft/Pending Approval
// projects are excluded from "my deadlines" the same way DashboardView's upcoming-deadlines
// widget excludes them. A task-origin entry counts only while the task is neither archived nor
// Done. 'other'-origin entries (Leave/Holiday) are never personal deadlines.
export const isMyDeadlineEntry = (
  entry: CalendarEntry,
  projects: Project[],
  tasks: Task[],
  currentUserId: string
): boolean => {
  if (entry.kind === 'Task Due') {
    const task = tasks.find((t) => t.id === entry.taskId);
    if (!task || task.isArchived || task.status === 'Done') return false;
    return task.assigneeId === currentUserId || (task.assigneeIds ?? []).includes(currentUserId);
  }
  if (entry.kind === 'Deadline' || entry.kind === 'Milestone') {
    const project = projects.find((p) => p.id === entry.projectId);
    if (!project || project.status !== 'Active') return false;
    return project.teamLeadId === currentUserId || project.memberIds.includes(currentUserId);
  }
  return false;
};

// The four independently-toggleable personal filters. 'My Deadlines' stays the special combined
// convenience filter above (active-project-only, excludes Done/archived tasks); the other three
// are plain relationship filters with no completion/status narrowing, matching how the Kind
// filter itself imposes no status opinion -- a completed item still renders (dimmed, see
// entry.completed) rather than disappearing.
export type PersonalFilterKind = 'My Assigned Tasks' | 'My Assigned Projects' | 'My Led Projects' | 'My Deadlines';

export const isMyAssignedTaskEntry = (entry: CalendarEntry, tasks: Task[], currentUserId: string): boolean => {
  if (entry.kind !== 'Task Due') return false;
  const task = tasks.find((t) => t.id === entry.taskId);
  if (!task) return false;
  return task.assigneeId === currentUserId || (task.assigneeIds ?? []).includes(currentUserId);
};

export const isMyAssignedProjectEntry = (entry: CalendarEntry, projects: Project[], currentUserId: string): boolean => {
  if (entry.kind !== 'Deadline' && entry.kind !== 'Milestone') return false;
  const project = projects.find((p) => p.id === entry.projectId);
  return Boolean(project && project.memberIds.includes(currentUserId));
};

// Team Lead is not a user role (see project.teamLeadId being the only source of truth throughout
// the Projects module) -- "leads this project" is always this same per-project comparison, never
// a role check, both here and in leadsAnyProject below.
export const isMyLedProjectEntry = (entry: CalendarEntry, projects: Project[], currentUserId: string): boolean => {
  if (entry.kind !== 'Deadline' && entry.kind !== 'Milestone') return false;
  const project = projects.find((p) => p.id === entry.projectId);
  return Boolean(project && project.teamLeadId === currentUserId);
};

// Whether the current user leads at least one project -- determines whether "My Led Projects" is
// worth showing as a filter option at all (see CalendarView.tsx), reusing the exact
// project.teamLeadId comparison every other lead check in this codebase already uses.
export const leadsAnyProject = (projects: Project[], currentUserId: string): boolean =>
  projects.some((project) => project.teamLeadId === currentUserId);

// Independent-toggle combinator: entries matching ANY active personal filter are kept (same
// union semantics as the existing Kind multi-select), and an empty selection applies no personal
// restriction at all.
export const matchesPersonalFilters = (
  entry: CalendarEntry,
  activePersonalFilters: Set<PersonalFilterKind>,
  projects: Project[],
  tasks: Task[],
  currentUserId: string
): boolean => {
  if (activePersonalFilters.size === 0) return true;
  return Array.from(activePersonalFilters).some((filter) => {
    switch (filter) {
      case 'My Assigned Tasks':
        return isMyAssignedTaskEntry(entry, tasks, currentUserId);
      case 'My Assigned Projects':
        return isMyAssignedProjectEntry(entry, projects, currentUserId);
      case 'My Led Projects':
        return isMyLedProjectEntry(entry, projects, currentUserId);
      case 'My Deadlines':
        return isMyDeadlineEntry(entry, projects, tasks, currentUserId);
      default:
        return false;
    }
  });
};

// View-only filtering layered on top of buildCalendarEntries' output — never changes what data
// enters the pipeline, only what's shown. originFilter narrows to project- or task-origin entries
// ('other'-origin standalone events are unaffected by it, only by activeKinds). activeKinds narrows
// by the entry's own kind regardless of origin.
export const filterCalendarEntries = (
  entries: CalendarEntry[],
  originFilter: 'all' | CalendarEntryOrigin,
  activeKinds: Set<CalendarEntryKind>
): CalendarEntry[] =>
  entries.filter((entry) => {
    if (!activeKinds.has(entry.kind)) return false;
    if (originFilter === 'all') return true;
    return entryOrigin(entry) === originFilter;
  });

// Groups entries under their YYYY-MM-DD date key, each day's entries sorted by time then title
// so grid cells and day-detail popovers render in a stable, predictable order.
export const groupEntriesByDate = (entries: CalendarEntry[]): Map<string, CalendarEntry[]> => {
  const grouped = new Map<string, CalendarEntry[]>();

  entries.forEach((entry) => {
    const existing = grouped.get(entry.date);
    if (existing) {
      existing.push(entry);
    } else {
      grouped.set(entry.date, [entry]);
    }
  });

  grouped.forEach((dayEntries) => dayEntries.sort(sortByTimeThenTitle));

  return grouped;
};

// Standard 6x7 (42-cell) month grid, Sunday-start, including the leading/trailing days from
// the adjacent months needed to fill whole weeks. `month` is 0-indexed (native Date convention).
export const getMonthGridDates = (year: number, month: number): Date[] => {
  const firstOfMonth = new Date(year, month, 1);
  const gridStart = new Date(year, month, 1 - firstOfMonth.getDay());

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);
    return date;
  });
};

// The 7 days (Sunday-start, matching getMonthGridDates) of the week containing anchorDate.
export const getWeekDates = (anchorDate: Date): Date[] => {
  const weekStart = new Date(anchorDate);
  weekStart.setDate(anchorDate.getDate() - anchorDate.getDay());

  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(weekStart);
    date.setDate(weekStart.getDate() + index);
    return date;
  });
};

// 12 month buckets for a Year view, each carrying its own 6x7 grid (reusing getMonthGridDates)
// so a year view can render 12 mini month-calendars without recomputing grid math.
export const getYearMonths = (year: number): CalendarYearMonth[] =>
  Array.from({ length: 12 }, (_, month) => ({
    month,
    label: MONTH_LABELS[month],
    dates: getMonthGridDates(year, month)
  }));

// Per-kind color tone, reusing WorkSync's existing semantic palette instead of inventing a new
// one: 'Deadline' mirrors StatusBadge's blocked/rejected rose bucket (hardest cutoff), 'Milestone'
// mirrors its urgent/high fuchsia bucket, 'Task Due' mirrors StatusBadge's todo cyan and
// boardAccess.getDueDateIndicator's "days left" cyan, 'Leave' falls back to StatusBadge's neutral
// slate bucket since no existing status maps to it, and 'Holiday' uses StatusBadge's
// completed/approved emerald bucket so read-only public holidays read as distinctly "settled"
// entries. `glow` values are GlassCard's own glowColor tokens; 'Holiday' shares 'none' with
// 'Leave' (both are informational, non-project/non-task entries) rather than inventing a new one.
export const entryToneClasses = (kind: CalendarEntryKind): CalendarEntryTone => {
  switch (kind) {
    case 'Deadline':
      return {
        badgeClass: 'bg-rose-500/15 text-rose-400 border-rose-500/30',
        dotClass: 'bg-rose-400',
        glow: 'magenta'
      };
    case 'Milestone':
      return {
        badgeClass: 'bg-fuchsia-500/15 text-fuchsia-400 border-fuchsia-500/30',
        dotClass: 'bg-fuchsia-400',
        glow: 'emerald'
      };
    case 'Task Due':
      return {
        badgeClass: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30',
        dotClass: 'bg-cyan-400',
        glow: 'cyan'
      };
    case 'Holiday':
      return {
        badgeClass: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
        dotClass: 'bg-emerald-400',
        glow: 'none'
      };
    case 'Leave':
    default:
      return {
        badgeClass: 'bg-slate-500/15 text-slate-300 border-slate-500/30',
        dotClass: 'bg-slate-400',
        glow: 'none'
      };
  }
};
