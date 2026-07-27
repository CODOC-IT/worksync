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
  Search,
  Users as UsersIcon,
  X,
  Zap
} from 'lucide-react';
import { useApp } from '../../store/AppContext';
import { StatusBadge } from '../../components/common/StatusBadge';
import { Project, Task, TaskPriority, TaskStatus, User, UserRole } from '../../types';
import {
  canEditTask,
  getTaskAssigneeIds,
  getTaskStartDate,
  getTaskStatusLabel,
  isTaskOverdue
} from '../tasks/taskRules';
import { BOARD_COLUMNS, canDecideReview, getAccessibleProjects, getDueDateIndicator } from './boardAccess';

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
  const { currentRole, currentUser, projects, tasks, users, updateTaskStatus } = useApp();

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
    <section data-kanban className="mx-auto max-w-[1600px] space-y-5">
      <header>
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
          className={`flex items-center justify-between rounded-xl border px-4 py-3 text-sm ${
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
          <div className="glass-panel space-y-3 p-4">
            <div className="flex flex-wrap items-center gap-2 overflow-x-auto pb-1">
              {accessibleProjects.map((project) => (
                <button
                  key={project.id}
                  type="button"
                  onClick={() => setSelectedProjectId(project.id)}
                  className={`shrink-0 rounded-lg border px-3 py-2 text-left text-xs font-semibold transition ${
                    project.id === selectedProjectId
                      ? 'border-cyan-400/50 bg-cyan-500/15 text-cyan-300'
                      : 'border-white/10 text-slate-300 hover:bg-white/5'
                  }`}
                >
                  <span className="block">{project.title}</span>
                  <span className="block font-mono text-[10px] font-normal text-slate-500">{project.code}</span>
                </button>
              ))}
            </div>

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
            <div className="glass-panel flex min-h-52 items-center justify-center text-sm text-slate-400">
              Loading project board...
            </div>
          ) : (
            <div className="grid gap-4 lg:grid-cols-4">
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
    </section>
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
    className={`glass-panel flex min-h-[420px] flex-col gap-3 p-3 transition ${
      isDragOver ? 'border-cyan-400/60 bg-cyan-500/5' : ''
    }`}
  >
    <div className="flex items-center justify-between px-1">
      <span className={`flex items-center gap-2 text-sm font-bold ${COLUMN_META[status as Exclude<TaskStatus, 'Blocked'>].accent}`}>
        {COLUMN_META[status as Exclude<TaskStatus, 'Blocked'>].icon}
        {getTaskStatusLabel(status)}
      </span>
      <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] font-semibold text-slate-400">
        {tasks.length}
      </span>
    </div>
    <div className="flex flex-1 flex-col gap-3 overflow-y-auto">
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
  onReject
}) => {
  const canDrag = canEditTask(currentRole, currentUserId, project, task) && task.status !== 'Done';
  const canDecide = canDecideReview(currentRole, currentUserId, project);
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
      className={`glass-panel space-y-3 p-3 text-xs transition ${
        canDrag ? 'cursor-grab hover:border-cyan-400/40 active:cursor-grabbing' : ''
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
      </div>

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
