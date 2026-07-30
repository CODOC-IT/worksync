import { ApprovedLeaveEntry, CalendarEvent, Project, Task } from '../../types';
import { getPakistanHolidays } from './pakistanHolidays';

// Milestones and project deadlines reuse CalendarEvent's own type vocabulary instead of
// duplicating it; 'Task Due' and 'Holiday' are the only kinds CalendarEvent has no literal for.
export type CalendarEntryKind = CalendarEvent['type'] | 'Task Due' | 'Holiday';

export type CalendarNavigateTab = 'projects' | 'tasks';

// Which side of the app an entry originates from. 'Deadline'/'Milestone' come from a Project,
// 'Task Due' comes from a Task; standalone calendarEvents (Meeting/Review/Leave) are neither and
// are only controllable via the kind filter, not the project/task origin toggle.
export type CalendarEntryOrigin = 'project' | 'task' | 'other';

export const ALL_CALENDAR_KINDS: CalendarEntryKind[] = [
  'Deadline',
  'Milestone',
  'Task Due',
  'Meeting',
  'Review',
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
  completed?: boolean; // milestone.completed, or task.status === 'Done'
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

// Static, read-only Pakistan public holiday entries -- see pakistanHolidays.ts for the
// underlying data and its per-year coverage. `years` should cover whatever range the caller is
// currently displaying (or navigating near); requesting the same year twice is harmless since
// getPakistanHolidays is a pure lookup, but callers should dedupe before calling for efficiency.
export const buildHolidayEntries = (years: number[]): CalendarEntry[] =>
  Array.from(new Set(years)).flatMap((year) =>
    getPakistanHolidays(year).map((holiday) => ({
      id: `holiday-${holiday.date}-${holiday.name.replace(/\s+/g, '-').toLowerCase()}`,
      date: holiday.date,
      title: holiday.name,
      kind: 'Holiday' as const
    }))
  );

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
// boardAccess.getDueDateIndicator's "days left" cyan, 'Review' mirrors StatusBadge's own
// literal 'review' amber bucket, 'Meeting' reuses the purple/violet brand accent seen in
// Sidebar and GlassCard, 'Leave' falls back to StatusBadge's neutral slate bucket since no
// existing status maps to it, and 'Holiday' uses StatusBadge's completed/approved emerald bucket
// so read-only public holidays read as distinctly "settled" entries. `glow` values are
// GlassCard's own glowColor tokens; with 7 kinds and 6 tokens, 'Holiday' shares 'none' with
// 'Leave' (both are informational, non-project/non-task entries) rather than inventing a 7th.
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
    case 'Meeting':
      return {
        badgeClass: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
        dotClass: 'bg-purple-400',
        glow: 'violet'
      };
    case 'Review':
      return {
        badgeClass: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
        dotClass: 'bg-amber-400',
        glow: 'amber'
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
