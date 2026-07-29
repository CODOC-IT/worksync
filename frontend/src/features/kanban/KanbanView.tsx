import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertCircle,
  ArrowRight,
  Calendar,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronDown,
  Eye,
  ListTodo,
  Lock,
  RotateCcw,
  Search,
  Square,
  Users as UsersIcon,
  X,
  Zap
} from 'lucide-react';
import { useApp } from '../../store/AppContext';
import { StatusBadge } from '../../components/common/StatusBadge';
import {
  Project,
  Subtask,
  Task,
  TaskPriority,
  TaskStatus,
  TaskStatusHistoryEntry,
  User,
  UserRole
} from '../../types';
import {
  canEditTask,
  getTaskAssigneeIds,
  getTaskStartDate,
  getTaskStatusLabel,
  isTaskOverdue
} from '../tasks/taskRules';
import {
  BOARD_COLUMNS,
  REOPEN_TARGETS,
  canDecideReview,
  canReopenTask,
  getAccessibleProjects,
  getDueDateIndicator
} from './boardAccess';
import { fetchTaskHistoryViaApi, loadTaskDetailFromApi } from '../tasks/taskRepository';

const inputClass =
  'w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-400/10';

const today = new Date().toISOString().split('T')[0];

const formatDate = (value: string) =>
  new Date(`${value}T00:00:00`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });

const COLUMN_META: Record<Exclude<TaskStatus, 'Blocked'>, { icon: React.ReactNode; accent: string }> = {
  Todo: { icon: <ListTodo size={15} />, accent: 'text-cyan-400' },
  'In Progress': { icon: <Zap size={15} />, accent: 'text-amber-400' },
  Review: { icon: <Eye size={15} />, accent: 'text-violet-400' },
  Done: { icon: <CheckCircle2 size={15} />, accent: 'text-emerald-400' }
};

const PRIORITY_CLASSES: Record<TaskPriority, string> = {
  Low: 'border-slate-500/30 bg-slate-500/15 text-slate-300',
  Medium: 'border-cyan-500/30 bg-cyan-500/10 text-cyan-300',
  High: 'border-amber-500/30 bg-amber-500/15 text-amber-300',
  Urgent: 'border-fuchsia-500/30 bg-fuchsia-500/15 text-fuchsia-300'
};

const PRIORITY_OPTIONS: TaskPriority[] = ['Low', 'Medium', 'High', 'Urgent'];

type PendingChange = {
  task: Task;
  toStatus: TaskStatus;
  kind: 'move' | 'approve' | 'reject';
};

export const KanbanView: React.FC = () => {
  const { currentRole, currentUser, projects, tasks, users, updateTaskStatus, reopenTask } = useApp();

  const accessibleProjects = useMemo(
    () => getAccessibleProjects(currentRole, currentUser.id, projects),
    [currentRole, currentUser.id, projects]
  );

  const [selectedProjectId, setSelectedProjectId] = useState<string>(() => accessibleProjects[0]?.id || '');
  const [search, setSearch] = useState('');
  const [priorityFilter, setPriorityFilter] = useState<TaskPriority | ''>('');
  const [pendingChange, setPendingChange] = useState<PendingChange | null>(null);
  const [modalSubmitting, setModalSubmitting] = useState(false);
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [dragOverStatus, setDragOverStatus] = useState<TaskStatus | null>(null);
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [reopenTarget, setReopenTarget] = useState<Task | null>(null);
  const [reopenSubmitting, setReopenSubmitting] = useState(false);
  const [detailsTaskId, setDetailsTaskId] = useState<string | null>(null);

  useEffect(() => {
    if (!accessibleProjects.some((project) => project.id === selectedProjectId)) {
      setSelectedProjectId(accessibleProjects[0]?.id || '');
    }
  }, [accessibleProjects, selectedProjectId]);

  const selectedProject = accessibleProjects.find((project) => project.id === selectedProjectId);

  const boardTasks = useMemo(() => {
    if (!selectedProject) return [];
    const normalizedSearch = search.trim().toLowerCase();
    return tasks.filter((task) => {
      if (task.projectId !== selectedProject.id) return false;
      if (!(BOARD_COLUMNS as TaskStatus[]).includes(task.status)) return false;
      if (priorityFilter && task.priority !== priorityFilter) return false;
      if (
        normalizedSearch &&
        !task.title.toLowerCase().includes(normalizedSearch) &&
        !task.description.toLowerCase().includes(normalizedSearch)
      ) {
        return false;
      }
      return true;
    });
  }, [tasks, selectedProject, search, priorityFilter]);

  const requestMove = (task: Task, toStatus: TaskStatus) => {
    if (!selectedProject || toStatus === task.status) return;
    if (!canEditTask(currentRole, currentUser.id, selectedProject, task)) {
      setNotice({ type: 'error', message: 'You do not have permission to move this task.' });
      return;
    }
    if (toStatus === 'Done') {
      setNotice({
        type: 'error',
        message: 'Tasks can only reach Done through Team Lead / Admin approval from Review.'
      });
      return;
    }
    setNotice(null);
    setPendingChange({ task, toStatus, kind: 'move' });
  };

  const requestReviewDecision = (task: Task, decision: 'approve' | 'reject') => {
    if (!selectedProject || !canDecideReview(currentRole, currentUser.id, selectedProject)) return;
    setNotice(null);
    setPendingChange({
      task,
      toStatus: decision === 'approve' ? 'Done' : 'In Progress',
      kind: decision
    });
  };

  const handleModalSubmit = async (note: string) => {
    if (!pendingChange) return;
    const { task, toStatus, kind } = pendingChange;
    setModalSubmitting(true);
    const result = await updateTaskStatus(task.id, toStatus, {
      note,
      reviewDecision: kind === 'approve' ? 'Approve' : kind === 'reject' ? 'Reject' : undefined
    });
    setModalSubmitting(false);
    setNotice({ type: result.success ? 'success' : 'error', message: result.message });
    // Only close on success — a failed request (network error, server rejection) keeps the
    // modal open with the user's note intact so they can retry without retyping it. Never
    // treat a rejected/failed call as if the move happened.
    if (result.success) setPendingChange(null);
  };

  const handleReopenSubmit = async (toStatus: TaskStatus, reason: string) => {
    if (!reopenTarget) return;
    setReopenSubmitting(true);
    const result = await reopenTask(reopenTarget.id, toStatus, reason);
    setReopenSubmitting(false);
    setNotice({ type: result.success ? 'success' : 'error', message: result.message });
    // Same contract as the status modal: only close on success, so a rejected reopen keeps the
    // reason the user typed available to retry.
    if (result.success) setReopenTarget(null);
  };

  const handleDrop = (status: TaskStatus) => {
    setDragOverStatus(null);
    if (!draggedTaskId) return;
    const task = boardTasks.find((item) => item.id === draggedTaskId);
    setDraggedTaskId(null);
    if (task) requestMove(task, status);
  };

  const roleIntro =
    currentRole === 'Admin'
      ? 'Monitor every project workspace. Task editing stays with Team Leads and assignees.'
      : currentRole === 'Team_Lead'
      ? 'Track progress and approve reviewed work across the projects you lead.'
      : 'View your project context and move your own tasks through the workflow.';

  return (
    <section data-kanban className="mx-auto flex h-full max-w-[1600px] flex-col gap-5">
      <header className="shrink-0">
        <div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-cyan-400">
          <ListTodo size={15} />
          Project board
        </div>
        <h1 className="text-2xl font-bold text-white">Kanban Board</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-400">{roleIntro}</p>
      </header>

      {notice && (
        <div
          role="status"
          className={`flex shrink-0 items-center justify-between rounded-xl border px-4 py-3 text-sm ${
            notice.type === 'success'
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
              : 'border-rose-500/30 bg-rose-500/10 text-rose-300'
          }`}
        >
          <span className="flex items-center gap-2">
            {notice.type === 'success' ? <Check size={16} /> : <AlertCircle size={16} />}
            {notice.message}
          </span>
          <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss message">
            <X size={16} />
          </button>
        </div>
      )}

      {accessibleProjects.length === 0 ? (
        <div className="glass-panel flex min-h-52 flex-col items-center justify-center px-6 text-center">
          <UsersIcon className="text-slate-500" size={26} />
          <h3 className="mt-3 font-semibold text-slate-200">No projects assigned</h3>
          <p className="mt-1 text-xs text-slate-500">
            {currentRole === 'Team_Lead'
              ? "You aren't leading any projects yet."
              : "You haven't been added to a project yet."}
          </p>
        </div>
      ) : (
        <>
          <div className="glass-panel shrink-0 space-y-3 p-4">
            <ProjectSelect
              projects={accessibleProjects}
              selectedProjectId={selectedProjectId}
              onSelect={setSelectedProjectId}
            />

            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <label className="relative sm:col-span-2">
                <Search
                  size={14}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"
                />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  className={`${inputClass} pl-9`}
                  placeholder="Search tasks by title or description..."
                />
              </label>
              <label className="relative">
                <select
                  value={priorityFilter}
                  onChange={(event) => setPriorityFilter(event.target.value as TaskPriority | '')}
                  className={`${inputClass} appearance-none pr-8 text-xs`}
                >
                  <option value="">All priorities</option>
                  {PRIORITY_OPTIONS.map((priority) => (
                    <option key={priority} value={priority}>
                      {priority} priority
                    </option>
                  ))}
                </select>
                <ChevronDown
                  size={13}
                  className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-500"
                />
              </label>
              {(search || priorityFilter) && (
                <button
                  type="button"
                  onClick={() => {
                    setSearch('');
                    setPriorityFilter('');
                  }}
                  className="rounded-lg border border-white/10 px-3 py-2 text-xs font-semibold text-slate-300 transition hover:bg-white/5"
                >
                  Reset filters
                </button>
              )}
            </div>
          </div>

          {!selectedProject ? (
            <div className="glass-panel flex min-h-52 flex-1 items-center justify-center text-sm text-slate-400">
              Loading project board...
            </div>
          ) : (
            <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-4">
              {BOARD_COLUMNS.map((status) => {
                const columnTasks = boardTasks.filter((task) => task.status === status);
                return (
                  <BoardColumn
                    key={status}
                    status={status}
                    tasks={columnTasks}
                    isDragOver={dragOverStatus === status}
                    onDragEnter={() => setDragOverStatus(status)}
                    onDragLeave={() =>
                      setDragOverStatus((current) => (current === status ? null : current))
                    }
                    onDrop={() => handleDrop(status)}
                    renderCard={(task) => (
                      <BoardCard
                        key={task.id}
                        task={task}
                        project={selectedProject}
                        users={users}
                        currentRole={currentRole}
                        currentUserId={currentUser.id}
                        onDragStart={() => setDraggedTaskId(task.id)}
                        onDragEnd={() => setDraggedTaskId(null)}
                        onRequestMove={(newStatus) => requestMove(task, newStatus)}
                        onApprove={() => requestReviewDecision(task, 'approve')}
                        onReject={() => requestReviewDecision(task, 'reject')}
                        onReopen={() => {
                          setNotice(null);
                          setReopenTarget(task);
                        }}
                        onOpenDetails={() => setDetailsTaskId(task.id)}
                      />
                    )}
                  />
                );
              })}
            </div>
          )}
        </>
      )}

      {pendingChange && (
        <StatusChangeModal
          pending={pendingChange}
          submitting={modalSubmitting}
          onCancel={() => setPendingChange(null)}
          onSubmit={handleModalSubmit}
        />
      )}

      {reopenTarget && (
        <ReopenTaskModal
          task={reopenTarget}
          submitting={reopenSubmitting}
          onCancel={() => setReopenTarget(null)}
          onSubmit={handleReopenSubmit}
        />
      )}

      {detailsTaskId && selectedProject && (
        <TaskDetailsModal
          taskId={detailsTaskId}
          users={users}
          project={selectedProject}
          currentRole={currentRole}
          currentUserId={currentUser.id}
          onClose={() => setDetailsTaskId(null)}
        />
      )}
    </section>
  );
};

// Searchable project selector -- replaces the old horizontal button list, which stopped
// scaling once a workspace had more than a handful of projects. Built from scratch (no
// combobox library in this repo's dependencies) as a button-triggered popover with an
// internal search input, matching the pattern used by e.g. GitHub's/Linear's project
// switchers: simpler to keep fully keyboard-operable than a full WAI-ARIA combobox, while
// still supporting type-to-filter, arrow-key navigation, Enter to select, and Escape to close.
const ProjectSelect: React.FC<{
  projects: Project[];
  selectedProjectId: string;
  onSelect: (projectId: string) => void;
}> = ({ projects, selectedProjectId, onSelect }) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlightIndex, setHighlightIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const selectedProject = projects.find((project) => project.id === selectedProjectId);

  const filteredProjects = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return projects;
    return projects.filter(
      (project) =>
        project.title.toLowerCase().includes(normalized) || project.code.toLowerCase().includes(normalized)
    );
  }, [projects, query]);

  useEffect(() => {
    setHighlightIndex(0);
  }, [query, open]);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  const openDropdown = () => {
    setOpen(true);
    setQuery('');
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const closeDropdown = (returnFocus?: boolean) => {
    setOpen(false);
    setQuery('');
    if (returnFocus) triggerRef.current?.focus();
  };

  const selectProject = (projectId: string) => {
    onSelect(projectId);
    closeDropdown(true);
  };

  const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlightIndex((index) => Math.min(index + 1, filteredProjects.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlightIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const target = filteredProjects[highlightIndex];
      if (target) selectProject(target.id);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      closeDropdown(true);
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <label id="kanban-project-select-label" className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
        Select Project
      </label>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? closeDropdown() : openDropdown())}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby="kanban-project-select-label"
        className="flex w-full items-center justify-between gap-2 rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2.5 text-left text-sm text-slate-100 outline-none transition focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-400/10 sm:w-80"
      >
        {selectedProject ? (
          <span className="min-w-0 truncate">
            <span className="font-semibold text-slate-100">{selectedProject.title}</span>
            <span className="ml-1.5 font-mono text-[10px] text-slate-500">{selectedProject.code}</span>
          </span>
        ) : (
          <span className="text-slate-500">Select a project…</span>
        )}
        <ChevronDown
          size={14}
          className={`shrink-0 text-slate-500 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div
          role="listbox"
          aria-labelledby="kanban-project-select-label"
          className="glass-panel-glow absolute left-0 top-full z-30 mt-1.5 w-full overflow-hidden sm:w-80"
        >
          <label className="relative block border-b border-white/10 p-2">
            <Search
              size={13}
              className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-500"
            />
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder="Search projects by name or code..."
              aria-label="Search projects"
              className="w-full rounded-md border-none bg-transparent py-1.5 pl-7 pr-2 text-xs text-slate-100 outline-none placeholder:text-slate-500"
            />
          </label>
          <div className="max-h-64 overflow-y-auto scroll-smooth p-1">
            {filteredProjects.length === 0 ? (
              <p className="px-3 py-4 text-center text-xs text-slate-500">No projects match "{query}".</p>
            ) : (
              filteredProjects.map((project, index) => (
                <button
                  key={project.id}
                  type="button"
                  role="option"
                  aria-selected={project.id === selectedProjectId}
                  onMouseEnter={() => setHighlightIndex(index)}
                  onClick={() => selectProject(project.id)}
                  className={`flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-xs transition ${
                    index === highlightIndex ? 'bg-cyan-500/15 text-cyan-200' : 'text-slate-300 hover:bg-white/5'
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">{project.title}</span>
                    <span className="block font-mono text-[10px] text-slate-500">{project.code}</span>
                  </span>
                  {project.id === selectedProjectId && <Check size={13} className="shrink-0 text-cyan-400" />}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};

const BoardColumn: React.FC<{
  status: TaskStatus;
  tasks: Task[];
  isDragOver: boolean;
  onDragEnter: () => void;
  onDragLeave: () => void;
  onDrop: () => void;
  renderCard: (task: Task) => React.ReactNode;
}> = ({ status, tasks, isDragOver, onDragEnter, onDragLeave, onDrop, renderCard }) => (
  <div
    data-kanban-column={status.toLowerCase().replace(' ', '-')}
    onDragOver={(event) => {
      event.preventDefault();
      onDragEnter();
    }}
    onDragEnter={(event) => {
      event.preventDefault();
      onDragEnter();
    }}
    onDragLeave={onDragLeave}
    onDrop={(event) => {
      event.preventDefault();
      onDrop();
    }}
    className={`glass-panel flex h-full min-h-[320px] flex-col gap-3 p-3 transition ${
      isDragOver ? 'border-cyan-400/60 bg-cyan-500/5' : ''
    }`}
  >
    <div className="flex shrink-0 items-center justify-between px-1">
      <span className={`flex items-center gap-2 text-sm font-bold ${COLUMN_META[status as Exclude<TaskStatus, 'Blocked'>].accent}`}>
        {COLUMN_META[status as Exclude<TaskStatus, 'Blocked'>].icon}
        {getTaskStatusLabel(status)}
      </span>
      <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] font-semibold text-slate-400">
        {tasks.length}
      </span>
    </div>
    {/* Each column scrolls independently -- min-h-0 lets this flex child shrink below its
        content size so overflow-y-auto actually kicks in here instead of the whole page
        growing (the classic flexbox gotcha: without min-h-0, a flex-1 child never shrinks
        past its content, so it just pushes the page taller instead of scrolling). */}
    <div className="flex flex-1 min-h-0 flex-col gap-3 overflow-y-auto scroll-smooth pr-1">
      {tasks.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-white/10 py-8 text-center text-xs text-slate-500">
          No tasks in {getTaskStatusLabel(status)}
        </div>
      ) : (
        tasks.map((task) => renderCard(task))
      )}
    </div>
  </div>
);

const BoardCard: React.FC<{
  task: Task;
  project: Project;
  users: User[];
  currentRole: UserRole;
  currentUserId: string;
  onDragStart: () => void;
  onDragEnd: () => void;
  onRequestMove: (status: TaskStatus) => void;
  onApprove: () => void;
  onReject: () => void;
  onReopen: () => void;
  onOpenDetails: () => void;
}> = ({
  task,
  project,
  users,
  currentRole,
  currentUserId,
  onDragStart,
  onDragEnd,
  onRequestMove,
  onApprove,
  onReject,
  onReopen,
  onOpenDetails
}) => {
  // A Done task is never draggable by anyone, including its Team Lead — reopening is an
  // explicit, reason-carrying action via the Reopen button, not an accidental drag.
  const canDrag = canEditTask(currentRole, currentUserId, project, task) && task.status !== 'Done';
  const canDecide = canDecideReview(currentRole, currentUserId, project);
  const canReopen = canReopenTask(currentRole, currentUserId, project);
  const overdue = isTaskOverdue(task, today);
  const dueIndicator = getDueDateIndicator(task.dueDate, today, task.status === 'Done');
  const startDate = getTaskStartDate(task);
  const assignees = getTaskAssigneeIds(task)
    .map((id) => users.find((user) => user.id === id)?.name)
    .filter((name): name is string => Boolean(name));
  const creatorName = users.find((user) => user.id === task.creatorId)?.name || 'Unknown';
  const isInReview = task.status === 'Review';
  const dropdownOptions = BOARD_COLUMNS.filter((status) => status !== 'Done');

  return (
    <div
      draggable={canDrag}
      onDragStart={(event) => {
        event.dataTransfer.setData('text/plain', task.id);
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onClick={onOpenDetails}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpenDetails();
        }
      }}
      className={`glass-panel space-y-3 p-3 text-xs transition ${
        canDrag ? 'cursor-grab hover:border-cyan-400/40 active:cursor-grabbing' : 'cursor-pointer hover:border-cyan-400/40'
      }`}
    >
      <div className="space-y-1">
        <div className="flex items-start justify-between gap-2">
          <span className="font-semibold text-slate-100">{task.title}</span>
          <span
            className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium ${PRIORITY_CLASSES[task.priority]}`}
          >
            {task.priority}
          </span>
        </div>
        {task.description && (
          <p className="line-clamp-2 text-[11px] text-slate-400">{task.description}</p>
        )}
      </div>

      {isInReview && <StatusBadge status="Pending Approval" size="sm" />}

      <SubtaskProgress task={task} />

      <div className="space-y-1.5 border-t border-white/5 pt-2 text-[11px] text-slate-400">
        <AssigneesDisplay names={assignees} />
        <div className="flex items-center gap-1.5">
          <CalendarClock size={12} className="shrink-0 text-slate-500" />
          <span>Start {formatDate(startDate)}</span>
        </div>
        <div className={`flex flex-wrap items-center gap-1.5 ${overdue ? 'font-semibold text-rose-300' : ''}`}>
          <Calendar size={12} className="shrink-0 text-slate-500" />
          <span>Due {formatDate(task.dueDate)}</span>
          {dueIndicator && (
            <span
              className={`rounded-full border px-1.5 py-0.5 text-[9px] font-bold uppercase ${dueIndicator.className}`}
            >
              {dueIndicator.label}
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-white/5 pt-2">
        <span className="truncate text-[10px] text-slate-500">Created by {creatorName}</span>
        {task.status !== 'Done' && !isInReview && (
          <select
            value={task.status}
            onChange={(event) => onRequestMove(event.target.value as TaskStatus)}
            onClick={(event) => event.stopPropagation()}
            disabled={!canDrag}
            className="rounded-md border border-white/10 bg-slate-950/70 px-1.5 py-1 text-[10px] text-slate-200 outline-none disabled:opacity-40"
          >
            {dropdownOptions.map((status) => (
              <option key={status} value={status}>
                {getTaskStatusLabel(status)}
              </option>
            ))}
          </select>
        )}
        {task.status === 'Done' && (
          <span
            className="flex shrink-0 items-center gap-1 text-[10px] text-slate-500"
            title="Completed tasks are locked. Only the project's Team Lead can reopen them."
          >
            <Lock size={10} />
            Locked
          </span>
        )}
      </div>

      {task.status === 'Done' && canReopen && (
        <div className="border-t border-white/5 pt-2">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onReopen();
            }}
            className="w-full rounded-lg border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[11px] font-semibold text-amber-300 transition hover:bg-amber-500/20"
          >
            Reopen Task
          </button>
        </div>
      )}

      {isInReview && canDecide && (
        <div className="flex gap-2 border-t border-white/5 pt-2">
          <button
            type="button"
            onClick={onReject}
            className="flex-1 rounded-lg border border-rose-500/30 bg-rose-500/10 px-2 py-1.5 text-[11px] font-semibold text-rose-300 transition hover:bg-rose-500/20"
          >
            Reject
          </button>
          <button
            type="button"
            onClick={onApprove}
            className="flex-1 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2 py-1.5 text-[11px] font-semibold text-emerald-300 transition hover:bg-emerald-500/20"
          >
            Approve
          </button>
        </div>
      )}
    </div>
  );
};

// Subtask completion bar for a board card. Every number here comes from the server
// (`subtaskCount`/`completedSubtaskCount`/`subtaskProgress` on the Task DTO, computed in
// backend/src/tasks/task.repository.ts) — the board never recounts from local state, so the bar
// always reflects what the database says, including subtasks completed by someone else.
// Renders nothing at all for a task with no subtasks, so existing cards are visually unchanged.
const SubtaskProgress: React.FC<{ task: Task }> = ({ task }) => {
  const total = task.subtaskCount ?? 0;
  if (total === 0) return null;

  const completed = task.completedSubtaskCount ?? 0;
  const percent = task.subtaskProgress ?? 0;
  const isComplete = completed === total;

  return (
    <div className="space-y-1">
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800/80"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${completed} of ${total} subtasks completed`}
      >
        <div
          className={`h-full rounded-full transition-all duration-300 ${
            isComplete ? 'bg-emerald-400/80' : 'bg-cyan-400/80'
          }`}
          style={{ width: `${percent}%` }}
        />
      </div>
      <div className="flex items-center justify-between text-[10px]">
        <span className="text-slate-400">
          {completed} / {total} Subtasks Completed
        </span>
        <span className={`font-semibold ${isComplete ? 'text-emerald-300' : 'text-cyan-300'}`}>{percent}%</span>
      </div>
    </div>
  );
};

// Shows up to two assignee names inline; any remaining names collapse into a "+N" chip
// whose hover/click reveals every full name in a portal-rendered popover (so it never gets
// clipped by the board column's scroll container).
const AssigneesDisplay: React.FC<{ names: string[] }> = ({ names }) => {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  if (names.length === 0) {
    return (
      <div className="flex items-center gap-1.5">
        <UsersIcon size={12} className="shrink-0 text-slate-500" />
        <span className="truncate">Unassigned</span>
      </div>
    );
  }

  const visibleNames = names.slice(0, 2);
  const overflowCount = names.length - visibleNames.length;

  const openTooltip = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      setCoords({ top: rect.top - 8, left: Math.min(rect.left, window.innerWidth - 232) });
    }
    setOpen(true);
  };
  const closeTooltip = () => setOpen(false);

  return (
    <div className="flex items-center gap-1.5">
      <UsersIcon size={12} className="shrink-0 text-slate-500" />
      <span className="truncate">{visibleNames.join(', ')}</span>
      {overflowCount > 0 && (
        <button
          ref={triggerRef}
          type="button"
          onMouseEnter={openTooltip}
          onMouseLeave={closeTooltip}
          onClick={(event) => {
            event.stopPropagation();
            if (open) closeTooltip();
            else openTooltip();
          }}
          className="shrink-0 rounded-full border border-white/10 bg-white/5 px-1.5 py-0.5 text-[9px] font-semibold text-slate-300 transition hover:border-cyan-400/40 hover:text-cyan-300"
          aria-label={`Show all ${names.length} assigned members`}
        >
          +{overflowCount}
        </button>
      )}
      {open &&
        coords &&
        createPortal(
          <div
            style={{ position: 'fixed', top: coords.top, left: coords.left, transform: 'translateY(-100%)' }}
            className="glass-panel-glow pointer-events-none z-50 w-max max-w-[220px] p-2.5 text-[11px] normal-case text-slate-200 shadow-xl"
          >
            <span className="mb-1 block text-[9px] uppercase tracking-wider text-slate-500">Assigned to</span>
            <ul className="space-y-0.5">
              {names.map((name) => (
                <li key={name} className="truncate">{name}</li>
              ))}
            </ul>
          </div>,
          document.body
        )}
    </div>
  );
};

const StatusChangeModal: React.FC<{
  pending: PendingChange;
  submitting: boolean;
  onCancel: () => void;
  onSubmit: (note: string) => void;
}> = ({ pending, submitting, onCancel, onSubmit }) => {
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  const titles: Record<PendingChange['kind'], string> = {
    move: 'Change Task Status',
    approve: 'Approve & Move to Done',
    reject: 'Reject & Return to In Progress'
  };

  const submitLabels: Record<PendingChange['kind'], string> = {
    move: 'Update Status',
    approve: 'Approve Task',
    reject: 'Reject Task'
  };

  const handleSubmit = () => {
    if (!note.trim()) {
      setError('A description is required before changing status.');
      return;
    }
    onSubmit(note.trim());
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div className="glass-panel-glow w-full max-w-lg overflow-hidden">
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <h2 className="font-bold text-white">{titles[pending.kind]}</h2>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg p-2 text-slate-400 hover:bg-white/10 hover:text-white"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>
        <div className="space-y-4 p-5">
          <div className="rounded-xl border border-white/10 bg-slate-950/40 p-3">
            <span className="block text-[10px] uppercase tracking-wider text-slate-500">Task</span>
            <span className="mt-1 block text-sm font-semibold text-slate-100">{pending.task.title}</span>
          </div>
          <div className="flex items-center justify-center gap-3 text-xs">
            <span className="rounded-full border border-white/10 bg-slate-900/60 px-3 py-1 font-semibold text-slate-300">
              {getTaskStatusLabel(pending.task.status)}
            </span>
            <ArrowRight size={14} className="text-slate-500" />
            <span className="rounded-full border border-cyan-400/40 bg-cyan-500/10 px-3 py-1 font-semibold text-cyan-300">
              {getTaskStatusLabel(pending.toStatus)}
            </span>
          </div>
          <label className="block space-y-1.5">
            <span className="text-xs font-semibold text-slate-300">
              Reason for status change <span className="text-rose-400">*</span>
            </span>
            <textarea
              autoFocus
              value={note}
              onChange={(event) => {
                setNote(event.target.value);
                if (error) setError('');
              }}
              rows={4}
              className={`${inputClass} ${
                error ? 'border-rose-500/60 focus:border-rose-500/60 focus:ring-rose-500/10' : ''
              }`}
              placeholder="e.g. Completed login validation."
            />
            {error && <span className="block text-[11px] text-rose-400">{error}</span>}
          </label>
        </div>
        <div className="flex justify-end gap-2 border-t border-white/10 bg-black/10 px-5 py-4">
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="rounded-lg border border-white/10 px-4 py-2 text-sm text-slate-300 transition hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="glass-button-neon rounded-lg px-5 py-2 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? 'Saving...' : submitLabels[pending.kind]}
          </button>
        </div>
      </div>
    </div>
  );
};

// Confirmation dialog for reopening a completed task. Reuses StatusChangeModal's exact shell
// (same overlay, header, footer and inputClass) rather than introducing a second modal style —
// what differs is the destination picker, since a reopen may land in any of three statuses.
const ReopenTaskModal: React.FC<{
  task: Task;
  submitting: boolean;
  onCancel: () => void;
  onSubmit: (toStatus: TaskStatus, reason: string) => void;
}> = ({ task, submitting, onCancel, onSubmit }) => {
  const [toStatus, setToStatus] = useState<TaskStatus>('Review');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = () => {
    if (!reason.trim()) {
      setError('A reason is required to reopen a completed task.');
      return;
    }
    onSubmit(toStatus, reason.trim());
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div className="glass-panel-glow w-full max-w-lg overflow-hidden">
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <h2 className="flex items-center gap-2 font-bold text-white">
            <RotateCcw size={16} className="text-amber-300" />
            Reopen Completed Task
          </h2>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg p-2 text-slate-400 hover:bg-white/10 hover:text-white"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>
        <div className="space-y-4 p-5">
          <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 p-3 text-[11px] text-amber-200">
            This task was completed and approved. Reopening it returns it to active work and is
            recorded in the task's status history.
          </div>
          <div className="rounded-xl border border-white/10 bg-slate-950/40 p-3">
            <span className="block text-[10px] uppercase tracking-wider text-slate-500">Task</span>
            <span className="mt-1 block text-sm font-semibold text-slate-100">{task.title}</span>
          </div>
          <label className="block space-y-1.5">
            <span className="text-xs font-semibold text-slate-300">Reopen to</span>
            <div className="flex gap-2">
              {REOPEN_TARGETS.map((status) => (
                <button
                  key={status}
                  type="button"
                  onClick={() => setToStatus(status)}
                  className={`flex-1 rounded-lg border px-3 py-2 text-xs font-semibold transition ${
                    toStatus === status
                      ? 'border-cyan-400/40 bg-cyan-500/10 text-cyan-300'
                      : 'border-white/10 text-slate-400 hover:bg-white/5'
                  }`}
                >
                  {getTaskStatusLabel(status)}
                </button>
              ))}
            </div>
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-semibold text-slate-300">
              Reason for reopening <span className="text-rose-400">*</span>
            </span>
            <textarea
              autoFocus
              value={reason}
              onChange={(event) => {
                setReason(event.target.value);
                if (error) setError('');
              }}
              rows={4}
              className={`${inputClass} ${
                error ? 'border-rose-500/60 focus:border-rose-500/60 focus:ring-rose-500/10' : ''
              }`}
              placeholder="e.g. Regression found in the login flow after release."
            />
            {error && <span className="block text-[11px] text-rose-400">{error}</span>}
          </label>
        </div>
        <div className="flex justify-end gap-2 border-t border-white/10 bg-black/10 px-5 py-4">
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="rounded-lg border border-white/10 px-4 py-2 text-sm text-slate-300 transition hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="rounded-lg border border-amber-500/40 bg-amber-500/15 px-5 py-2 text-sm font-bold text-amber-200 transition hover:bg-amber-500/25 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? 'Reopening...' : `Reopen to ${getTaskStatusLabel(toStatus)}`}
          </button>
        </div>
      </div>
    </div>
  );
};

// Task detail for a board card. Fetches the *detail* payload (GET /api/tasks/:id, the only
// endpoint that returns the `subtasks` array — the list endpoint returns counts only) plus the
// status history, rather than reading from AppContext's `tasks`. That keeps the board's list
// payload small and guarantees the subtask rows shown here are the database's current state,
// including work done by other people since this page loaded.
//
// Task *fields* (title, description, assignees, dates) stay read-only here — editing those is
// the Task Module's job (docs/BoardModuleGuide.md §15). Ticking a subtask is the one write this
// modal performs, because subtask completion is what drives the board's own progress and
// status rules; it goes through the Task Module's existing status endpoint rather than any
// board-specific one (see AppContext.setSubtaskCompletion).
const TaskDetailsModal: React.FC<{
  taskId: string;
  users: User[];
  project: Project;
  currentRole: UserRole;
  currentUserId: string;
  onClose: () => void;
}> = ({ taskId, users, project, currentRole, currentUserId, onClose }) => {
  const { tasks, setSubtaskCompletion } = useApp();
  // Seed from the board's already-loaded task so the dialog paints instantly with the title,
  // description, dates and progress the card was showing. The detail fetch (the only source of
  // the `subtasks` array) then fills in the checklist without ever blocking the first render —
  // previously this modal showed a spinner for the whole round trip before anything appeared.
  const seed = tasks.find((item) => item.id === taskId) || null;
  const [task, setTask] = useState<Task | null>(seed);
  const [history, setHistory] = useState<TaskStatusHistoryEntry[]>([]);
  const [loadingSubtasks, setLoadingSubtasks] = useState(true);
  const [error, setError] = useState('');
  const [busySubtaskId, setBusySubtaskId] = useState<string | null>(null);
  const [subtaskError, setSubtaskError] = useState('');
  const [pendingSubtask, setPendingSubtask] = useState<Subtask | null>(null);
  const [savingSubtask, setSavingSubtask] = useState(false);

  const load = React.useCallback(
    (showSpinner: boolean) => {
      if (showSpinner) setLoadingSubtasks(true);
      setError('');
      return Promise.all([loadTaskDetailFromApi(taskId), fetchTaskHistoryViaApi(taskId).catch(() => [])])
        .then(([detail, entries]) => {
          setTask(detail);
          setHistory(entries);
        })
        .catch((err: any) => setError(err?.message || 'Unable to load this task right now.'))
        .finally(() => setLoadingSubtasks(false));
    },
    [taskId]
  );

  useEffect(() => {
    load(true);
  }, [load]);

  // Per-subtask, not per-parent: everyone can *see* every subtask, but only the people it is
  // assigned to may tick it — no role overrides it, not Team Lead and not Admin. Mirrors exactly
  // what the backend enforces in task.authorization.ts's getTaskEditDenialReason ("Only users
  // assigned to this subtask can edit it"), so the UI never enables a control the server will
  // reject. This is UX only; the server check is the authoritative one.
  const canToggleSubtask = (subtask: Subtask): boolean =>
    (subtask.assigneeIds || []).includes(currentUserId);

  const submitSubtask = async (note: string) => {
    if (!task || !pendingSubtask) return;
    setSavingSubtask(true);
    setSubtaskError('');
    setBusySubtaskId(pendingSubtask.id);

    const result = await setSubtaskCompletion(pendingSubtask.id, task.id, !pendingSubtask.completed, note);
    if (!result.success) setSubtaskError(result.message);
    // Re-read either way: on success the parent may have cascaded to a new status, and on
    // failure the local view must not drift from what the server actually stored.
    await load(false);

    setSavingSubtask(false);
    setBusySubtaskId(null);
    if (result.success) setPendingSubtask(null);
  };

  const nameOf = (userId: string) => users.find((user) => user.id === userId)?.name || 'Unassigned';
  const subtasks = task?.subtasks ?? [];
  const completedCount = subtasks.filter((subtask) => subtask.completed).length;
  // A subtask's "completed by / completed at" is not a column on the subtask itself — it's the
  // history entry that moved it into Done, so it's read from that shared audit trail. The
  // history itself is not rendered; it is only used for this attribution.
  const completionOf = (subtaskId: string) =>
    history.find((entry) => entry.taskId === subtaskId && entry.toStatus === 'Done');

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="glass-panel-glow flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden">
        <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-5 py-4">
          <h2 className="truncate font-bold text-white">{task?.title || 'Task Details'}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-slate-400 hover:bg-white/10 hover:text-white"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
          {error && (
            <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-300">{error}</div>
          )}

          {task && (
            <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <DetailTile label="Status" value={getTaskStatusLabel(task.status)} />
                <DetailTile label="Priority" value={task.priority} />
                <DetailTile label="Due" value={formatDate(task.dueDate)} />
                <DetailTile label="Task" value={task.taskNumber} />
              </div>

              {task.description && (
                <div>
                  <h3 className="mb-1.5 text-[10px] uppercase tracking-wider text-slate-500">Description</h3>
                  {/* break-words + min-w-0 so a long unbroken string wraps onto the next line
                      instead of forcing the dialog to scroll sideways. */}
                  <p className="min-w-0 whitespace-pre-wrap break-words text-xs leading-relaxed text-slate-300">
                    {task.description}
                  </p>
                </div>
              )}

              <div>
                <h3 className="mb-1.5 text-[10px] uppercase tracking-wider text-slate-500">Assigned Members</h3>
                <div className="flex flex-wrap gap-1.5">
                  {getTaskAssigneeIds(task).length === 0 && (
                    <span className="text-xs text-slate-500">No one assigned.</span>
                  )}
                  {getTaskAssigneeIds(task).map((id) => (
                    <span
                      key={id}
                      className="rounded-full border border-white/10 bg-slate-900/60 px-2.5 py-1 text-[11px] text-slate-300"
                    >
                      {nameOf(id)}
                    </span>
                  ))}
                </div>
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-slate-500">
                    <ListTodo size={12} />
                    Subtasks
                  </h3>
                  {subtasks.length > 0 && (
                    <span className="text-[11px] text-slate-400">
                      {completedCount} / {subtasks.length} completed
                    </span>
                  )}
                </div>

                {subtaskError && (
                  <div className="mb-2 rounded-lg border border-rose-500/30 bg-rose-500/10 p-2 text-[11px] text-rose-300">
                    {subtaskError}
                  </div>
                )}

                {loadingSubtasks && subtasks.length === 0 ? (
                  <p className="rounded-xl border border-white/5 bg-slate-950/30 p-3 text-xs text-slate-500">
                    Loading subtasks...
                  </p>
                ) : subtasks.length === 0 ? (
                  <p className="rounded-xl border border-white/5 bg-slate-950/30 p-3 text-xs text-slate-500">
                    This task has no subtasks.
                  </p>
                ) : (
                  <ul className="space-y-1.5">
                    {subtasks.map((subtask) => {
                      const completion = completionOf(subtask.id);
                      const busy = busySubtaskId === subtask.id;
                      const canToggle = canToggleSubtask(subtask);
                      return (
                        <li
                          key={subtask.id}
                          className={`rounded-lg border border-white/5 bg-slate-950/30 p-2.5 transition ${
                            canToggle && !busySubtaskId ? 'hover:border-cyan-400/30' : ''
                          } ${busy ? 'opacity-60' : ''}`}
                        >
                          <div className="flex items-start gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setSubtaskError('');
                                setPendingSubtask(subtask);
                              }}
                              disabled={!canToggle || Boolean(busySubtaskId)}
                              aria-label={
                                subtask.completed
                                  ? `Reopen subtask ${subtask.title}`
                                  : `Complete subtask ${subtask.title}`
                              }
                              title={
                                canToggle
                                  ? subtask.completed
                                    ? 'Reopen this subtask'
                                    : 'Mark this subtask complete'
                                  : 'Only this subtask\'s assignee can change it.'
                              }
                              className="mt-0.5 shrink-0 rounded transition disabled:cursor-not-allowed enabled:hover:scale-110"
                            >
                              {subtask.completed ? (
                                <CheckCircle2 size={14} className="text-emerald-400" />
                              ) : (
                                <Square
                                  size={14}
                                  className={canToggle ? 'text-slate-500 hover:text-cyan-300' : 'text-slate-600'}
                                />
                              )}
                            </button>
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-start justify-between gap-2">
                                <span
                                  className={`min-w-0 break-words text-xs ${
                                    subtask.completed ? 'text-slate-400 line-through' : 'text-slate-200'
                                  }`}
                                >
                                  {subtask.title}
                                </span>
                                <div className="flex shrink-0 items-center gap-1.5">
                                  {subtask.priority && (
                                    <span
                                      className={`rounded-full border px-1.5 py-0.5 text-[9px] font-medium ${
                                        PRIORITY_CLASSES[subtask.priority]
                                      }`}
                                    >
                                      {subtask.priority}
                                    </span>
                                  )}
                                  {subtask.status && (
                                    <span className="rounded-full border border-white/10 bg-slate-900/60 px-1.5 py-0.5 text-[9px] font-medium text-slate-400">
                                      {getTaskStatusLabel(subtask.status)}
                                    </span>
                                  )}
                                  {!canToggle && (
                                    <span title="Read-only — not assigned to you">
                                      <Lock size={9} className="text-slate-600" />
                                    </span>
                                  )}
                                </div>
                              </div>

                              {subtask.description && (
                                <p className="mt-1 min-w-0 whitespace-pre-wrap break-words text-[10px] leading-relaxed text-slate-400">
                                  {subtask.description}
                                </p>
                              )}

                              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-slate-500">
                                <span className="flex items-center gap-1">
                                  <UsersIcon size={9} />
                                  {(subtask.assigneeIds || []).map(nameOf).join(', ') || 'Unassigned'}
                                </span>
                                {subtask.startDate && (
                                  <span className="flex items-center gap-1">
                                    <CalendarClock size={9} />
                                    Start {formatDate(subtask.startDate)}
                                  </span>
                                )}
                                {subtask.dueDate && (
                                  <span className="flex items-center gap-1">
                                    <Calendar size={9} />
                                    Due {formatDate(subtask.dueDate)}
                                  </span>
                                )}
                              </div>

                              {completion && (
                                <div className="mt-1.5 flex items-center gap-1 text-[10px] text-emerald-400/90">
                                  <CheckCircle2 size={10} />
                                  Completed by {completion.changedByName} on{' '}
                                  {new Date(completion.timestamp).toLocaleString()}
                                </div>
                              )}
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

            </>
          )}
        </div>
      </div>

      {pendingSubtask && (
        <SubtaskNoteModal
          subtask={pendingSubtask}
          submitting={savingSubtask}
          onCancel={() => setPendingSubtask(null)}
          onSubmit={submitSubtask}
        />
      )}
    </div>
  );
};

// Mandatory-description prompt for completing (or reopening) a subtask. A subtask completion is
// a real status change on a real task row, so it carries the same "why" the board already
// demands for every column move — and that note lands in work.TaskStatusHistory identically.
const SubtaskNoteModal: React.FC<{
  subtask: Subtask;
  submitting: boolean;
  onCancel: () => void;
  onSubmit: (note: string) => void;
}> = ({ subtask, submitting, onCancel, onSubmit }) => {
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const reopening = subtask.completed;

  const handleSubmit = () => {
    if (!note.trim()) {
      setError('A description is required.');
      return;
    }
    onSubmit(note.trim());
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div className="glass-panel-glow w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <h2 className="font-bold text-white">{reopening ? 'Reopen Subtask' : 'Complete Subtask'}</h2>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg p-2 text-slate-400 hover:bg-white/10 hover:text-white"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>
        <div className="space-y-4 p-5">
          <div className="rounded-xl border border-white/10 bg-slate-950/40 p-3">
            <span className="block text-[10px] uppercase tracking-wider text-slate-500">Subtask</span>
            <span className="mt-1 block break-words text-sm font-semibold text-slate-100">{subtask.title}</span>
          </div>
          <label className="block space-y-1.5">
            <span className="text-xs font-semibold text-slate-300">
              {reopening ? 'Reason for reopening' : 'What did you complete?'}{' '}
              <span className="text-rose-400">*</span>
            </span>
            <textarea
              autoFocus
              value={note}
              onChange={(event) => {
                setNote(event.target.value);
                if (error) setError('');
              }}
              rows={3}
              className={`${inputClass} ${
                error ? 'border-rose-500/60 focus:border-rose-500/60 focus:ring-rose-500/10' : ''
              }`}
              placeholder={reopening ? 'e.g. Needs rework after QA feedback.' : 'e.g. Implemented and tested the login form.'}
            />
            {error && <span className="block text-[11px] text-rose-400">{error}</span>}
          </label>
        </div>
        <div className="flex justify-end gap-2 border-t border-white/10 bg-black/10 px-5 py-4">
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="rounded-lg border border-white/10 px-4 py-2 text-sm text-slate-300 transition hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="glass-button-neon rounded-lg px-5 py-2 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? 'Saving...' : reopening ? 'Reopen Subtask' : 'Mark Complete'}
          </button>
        </div>
      </div>
    </div>
  );
};

const DetailTile: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="rounded-xl border border-white/10 bg-slate-950/40 p-2.5">
    <span className="block text-[9px] uppercase tracking-wider text-slate-500">{label}</span>
    <span className="mt-0.5 block truncate text-xs font-semibold text-slate-200">{value}</span>
  </div>
);
