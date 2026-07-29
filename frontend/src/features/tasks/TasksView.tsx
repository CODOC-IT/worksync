import React, { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowDownAZ,
  Check,
  CheckSquare,
  ChevronDown,
  ClipboardList,
  Filter,
  Layers,
  LoaderCircle,
  MoreHorizontal,
  Plus,
  Search,
  UserRound,
  UsersRound,
  X
} from 'lucide-react';
import { useApp } from '../../store/AppContext';
import { Project, Task, TaskPriority, TaskStatus, User } from '../../types';
import {
  canCreateTaskForProject,
  canDeleteTask,
  canEditTask,
  filterAndSortTasks,
  getProjectEndDate,
  getProjectMemberIds,
  getProjectName,
  getLatestDate,
  getTaskAssigneeIds,
  getTaskPriorityValue,
  getTaskStartDate,
  getTaskStatusLabel,
  getTodayIsoDate,
  isTaskOverdue,
  TASK_PRIORITIES,
  TASK_STATUSES,
  TaskFormInput,
  TaskModulePriority,
  SubtaskFormInput,
  validateTaskInput
} from './taskRules';
import { loadTaskDetailFromApi } from './taskRepository';

const today = getTodayIsoDate();

const inputClass =
  'w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-400/10 disabled:cursor-not-allowed disabled:opacity-50';

const emptyForm = (): TaskFormInput => ({
  projectId: '',
  title: '',
  description: '',
  priority: 'Medium',
  startDate: '',
  dueDate: '',
  assigneeIds: [],
  status: 'Todo'
});

const formatDate = (value: string) =>
  new Date(`${value}T00:00:00`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });

const formatOptionalDate = (value?: string) => value ? formatDate(value) : 'Not set';

export const TasksView: React.FC = () => {
  const {
    currentRole,
    currentUser,
    users,
    projects,
    tasks,
    createTask,
    updateTask,
    deleteTask
  } = useApp();

  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [viewingTask, setViewingTask] = useState<Task | null>(null);
  const [taskPendingDeletion, setTaskPendingDeletion] = useState<Task | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [openMenuTaskId, setOpenMenuTaskId] = useState<string | null>(null);
  const [form, setForm] = useState<TaskFormInput>(emptyForm);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [search, setSearch] = useState('');
  const [projectFilter, setProjectFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [assigneeFilter, setAssigneeFilter] = useState('');
  const [myTasksOnly, setMyTasksOnly] = useState(false);
  const [dueDateDirection, setDueDateDirection] = useState<'asc' | 'desc'>('asc');
  const [subtaskStep, setSubtaskStep] = useState<'ask' | 'count' | 'details' | null>(null);
  const [subtaskCount, setSubtaskCount] = useState(1);
  const [subtaskDrafts, setSubtaskDrafts] = useState<SubtaskFormInput[]>([]);
  const [subtaskErrors, setSubtaskErrors] = useState<Record<string, string>>({});
  const [isCreatingSubtasks, setIsCreatingSubtasks] = useState(false);
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [expandedTaskDetails, setExpandedTaskDetails] = useState<Record<string, Task>>({});
  const [expandingTaskId, setExpandingTaskId] = useState<string | null>(null);
  const [expandedTaskError, setExpandedTaskError] = useState<{ taskId: string; message: string } | null>(null);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setIsLoading(false));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const closeTaskMenu = (event: PointerEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest('[data-task-actions]')) setOpenMenuTaskId(null);
    };

    document.addEventListener('pointerdown', closeTaskMenu);
    return () => document.removeEventListener('pointerdown', closeTaskMenu);
  }, []);

  const availableProjects = useMemo(
    () => projects.filter((project) =>
      canCreateTaskForProject(currentRole, currentUser.id, project)
      && getProjectEndDate(project) >= today
    ),
    [currentRole, currentUser.id, projects]
  );

  const selectedProject = projects.find((project) => project.id === form.projectId);
  const availableAssignees = useMemo(
    () => selectedProject
      ? users.filter((user) =>
          user.status !== 'inactive' && getProjectMemberIds(selectedProject).includes(user.id)
        )
      : [],
    [selectedProject, users]
  );

  const filteredTasks = useMemo(
    () => filterAndSortTasks(tasks, projects, {
      search,
      projectId: projectFilter,
      status: statusFilter,
      priority: priorityFilter,
      assigneeId: assigneeFilter,
      myTasksOnly,
      currentUserId: currentUser.id,
      dueDateDirection
    }),
    [
      assigneeFilter,
      currentUser.id,
      dueDateDirection,
      myTasksOnly,
      priorityFilter,
      projectFilter,
      projects,
      search,
      statusFilter,
      tasks
    ]
  );
  const parentTasks = useMemo(
    () => tasks.filter((task) => !task.parentTaskId),
    [tasks]
  );
  const visibleTasks = useMemo(
    () => filteredTasks.filter((task) => !task.parentTaskId),
    [filteredTasks]
  );

  const resetForm = () => {
    setForm(emptyForm());
    setEditingTaskId(null);
    setFieldErrors({});
    setFormError(null);
    setIsFormOpen(false);
    setSubtaskStep(null);
    setSubtaskDrafts([]);
    setSubtaskErrors({});
  };

  const openCreateForm = () => {
    const initialProject = availableProjects[0];
    const startDate = getLatestDate(today, initialProject?.startDate) || today;
    setEditingTaskId(null);
    setForm({
      ...emptyForm(),
      projectId: initialProject?.id || '',
      startDate,
      dueDate: initialProject ? getProjectEndDate(initialProject) : ''
    });
    setFieldErrors({});
    setFormError(null);
    setNotice(null);
    setIsFormOpen(true);
    setExpandedTaskId(null);
  };

  const openEditForm = (task: Task) => {
    setEditingTaskId(task.id);
    setForm({
      projectId: task.projectId,
      title: task.title,
      description: task.description,
      priority: getTaskPriorityValue(task.priority),
      startDate: getTaskStartDate(task),
      dueDate: task.dueDate,
      assigneeIds: getTaskAssigneeIds(task),
      status: task.status
    });
    setFieldErrors({});
    setFormError(null);
    setNotice(null);
    setIsFormOpen(true);
  };

  const handleProjectChange = (projectId: string) => {
    const project = projects.find((item) => item.id === projectId);
    const startDate = getLatestDate(today, project?.startDate) || '';
    setForm((current) => ({
      ...current,
      projectId,
      startDate,
      dueDate: project ? getProjectEndDate(project) : '',
      assigneeIds: []
    }));
    setFieldErrors((current) => ({
      ...current,
      projectId: '',
      startDate: '',
      dueDate: '',
      assigneeIds: ''
    }));
  };

  const toggleAssignee = (userId: string) => {
    setForm((current) => ({
      ...current,
      assigneeIds: current.assigneeIds.includes(userId)
        ? current.assigneeIds.filter((id) => id !== userId)
        : [...current.assigneeIds, userId]
    }));
    setFieldErrors((current) => ({ ...current, assigneeIds: '' }));
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (isSubmitting) return;

    const clientErrors = validateTaskInput(
      form,
      selectedProject,
      users,
      editingTaskId === null,
      editingTaskId === null ? today : undefined
    );
    if (Object.keys(clientErrors).length > 0) {
      setFieldErrors(clientErrors);
      setFormError(null);
      return;
    }
    if (!editingTaskId && subtaskStep === null) {
      setSubtaskStep('ask');
      return;
    }
    setIsSubmitting(true);
    try {
      const existingTask = editingTaskId
        ? tasks.find((task) => task.id === editingTaskId)
        : undefined;
      const isMemberStatusOnly = Boolean(existingTask && currentRole === 'Team_Member');
      const result = await (
        editingTaskId
          ? updateTask(
              editingTaskId,
              isMemberStatusOnly
                ? { status: form.status }
                : {
                    title: form.title,
                    description: form.description,
                    priority: form.priority as TaskModulePriority,
                    startDate: form.startDate,
                    dueDate: form.dueDate,
                    assigneeId: form.assigneeIds[0],
                    assigneeIds: form.assigneeIds,
                    status: form.status
                  }
            )
          : createTask({
              projectId: form.projectId,
              title: form.title,
              description: form.description,
              priority: form.priority as TaskModulePriority,
              startDate: form.startDate,
              dueDate: form.dueDate,
              assigneeId: form.assigneeIds[0],
              assigneeIds: form.assigneeIds,
              status: form.status
            })
      );

      if (!result.success) {
        setFieldErrors(result.fieldErrors || {});
        const message = result.message.toLowerCase();
        setFormError(
          message.includes('invalid token') || message.includes('not authenticated')
            ? 'Your sign-in session has expired. Please sign in again, then submit the task.'
            : result.fieldErrors && Object.keys(result.fieldErrors).length > 0
              ? null
              : result.message
        );
        return;
      }

      resetForm();
      setNotice({ type: 'success', message: result.message });
    } finally {
      setIsSubmitting(false);
    }
  };

  const startSubtasks = () => {
    const draft = (): SubtaskFormInput => ({ title: '', description: '', priority: form.priority, startDate: form.startDate, dueDate: form.dueDate, assigneeIds: [], status: 'Todo' });
    setSubtaskDrafts(Array.from({ length: subtaskCount }, draft));
    setSubtaskErrors({});
    setSubtaskStep('details');
  };

  const updateSubtask = (index: number, patch: Partial<SubtaskFormInput>) => {
    setSubtaskDrafts((current) => current.map((draft, draftIndex) => draftIndex === index ? { ...draft, ...patch } : draft));
    setSubtaskErrors((current) => {
      const next = { ...current };
      Object.keys(patch).forEach((field) => delete next[`${index}.${field}`]);
      return next;
    });
  };

  const handleSubtasksSubmit = async () => {
    if (isCreatingSubtasks) return;
    const nextErrors: Record<string, string> = {};
    subtaskDrafts.forEach((draft, index) => {
      const errors = validateTaskInput(
        { ...draft, projectId: form.projectId },
        selectedProject,
        users,
        true,
        form.startDate
      );
      Object.entries(errors).forEach(([field, message]) => {
        if (field !== 'projectId') nextErrors[`${index}.${field}`] = message;
      });
      if (draft.dueDate > form.dueDate) {
        nextErrors[`${index}.dueDate`] = 'Due date cannot be after the parent task due date.';
      }
    });
    if (Object.keys(nextErrors).length > 0) {
      setSubtaskErrors(nextErrors);
      return;
    }

    setIsCreatingSubtasks(true);
    try {
      const result = await createTask({
        projectId: form.projectId,
        title: form.title,
        description: form.description,
        priority: form.priority as TaskModulePriority,
        startDate: form.startDate,
        dueDate: form.dueDate,
        assigneeId: form.assigneeIds[0],
        assigneeIds: form.assigneeIds,
        status: form.status,
        subtasks: subtaskDrafts
      });
      if (!result.success) {
        setNotice({ type: 'error', message: result.message });
        return;
      }
      resetForm();
      setNotice({ type: 'success', message: 'Task and subtasks created successfully.' });
    } catch {
      setNotice({ type: 'error', message: 'Task and subtasks could not be created. Please try again.' });
    } finally {
      setIsCreatingSubtasks(false);
    }
  };

  const handleCancelSubtasks = async () => {
    if (isCreatingSubtasks) return;
    setIsCreatingSubtasks(true);
    try {
      const result = await createTask({
        projectId: form.projectId,
        title: form.title,
        description: form.description,
        priority: form.priority as TaskModulePriority,
        startDate: form.startDate,
        dueDate: form.dueDate,
        assigneeId: form.assigneeIds[0],
        assigneeIds: form.assigneeIds,
        status: form.status
      });
      if (!result.success) {
        setNotice({ type: 'error', message: result.message });
        return;
      }
      resetForm();
      setNotice({ type: 'success', message: 'Task created successfully.' });
    } catch {
      setNotice({ type: 'error', message: 'Task could not be created. Please try again.' });
    } finally {
      setIsCreatingSubtasks(false);
    }
  };

  const handleDelete = async () => {
    if (!taskPendingDeletion || isDeleting) return;
    setIsDeleting(true);
    setDeleteError(null);
    const task = taskPendingDeletion;
    const result = await deleteTask(task.id);
    if (!result.success) {
      setDeleteError(result.message);
    } else {
      setNotice({ type: 'success', message: result.message });
      if (viewingTask?.id === task.id) setViewingTask(null);
      setTaskPendingDeletion(null);
      setOpenMenuTaskId(null);
    }
    setIsDeleting(false);
  };

  const clearFilters = () => {
    setSearch('');
    setProjectFilter('');
    setStatusFilter('');
    setPriorityFilter('');
    setAssigneeFilter('');
    setMyTasksOnly(false);
    setDueDateDirection('asc');
  };

  const toggleTaskExpansion = async (task: Task) => {
    if (expandedTaskId === task.id) {
      setExpandedTaskId(null);
      setExpandedTaskError(null);
      return;
    }

    setExpandedTaskId(task.id);
    setExpandedTaskError(null);
    if (expandedTaskDetails[task.id]) return;

    setExpandingTaskId(task.id);
    try {
      const detail = await loadTaskDetailFromApi(task.id);
      setExpandedTaskDetails((current) => ({ ...current, [task.id]: detail }));
    } catch {
      setExpandedTaskError({
        taskId: task.id,
        message: 'Subtask details could not be loaded. Please try again.'
      });
    } finally {
      setExpandingTaskId((current) => current === task.id ? null : current);
    }
  };

  const memberStatusOnly = editingTaskId !== null && currentRole === 'Team_Member';
  const isCreatePage = isFormOpen && editingTaskId === null;
  const hasActiveFilters = Boolean(
    search || projectFilter || statusFilter || priorityFilter || assigneeFilter || myTasksOnly
  );

  return (
    <section className="mx-auto max-w-[1500px] space-y-5">
      {!isCreatePage && <header className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-white">
            <CheckSquare size={23} className="text-cyan-400" />
            Tasks
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-400">
            Track project work, ownership, and due dates in one focused workspace.
          </p>
        </div>

        {currentRole === 'Team_Lead' && (
          <button
            type="button"
            onClick={openCreateForm}
            disabled={availableProjects.length === 0}
            className="glass-button-neon inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Plus size={17} />
            Create task
          </button>
        )}
      </header>}

      {!isCreatePage && notice && (
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

      {isFormOpen && (
        <div
          className={editingTaskId ? 'fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm' : ''}
          onMouseDown={(event) => {
            if (editingTaskId && event.target === event.currentTarget) resetForm();
          }}
        >
        <form id="task-form" onSubmit={handleSubmit} className="glass-panel-glow mx-auto w-full max-w-5xl overflow-hidden">
          <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-300">Tasks</p>
              <h1 className="mt-1 text-2xl font-bold text-white">
                {editingTaskId ? 'Edit task' : 'Create task'}
              </h1>
              <p className="mt-1 text-sm text-slate-400">
                {memberStatusOnly
                  ? 'Update progress for your assigned work.'
                  : 'Add the work details, schedule, and assignees, then return to your task list.'}
              </p>
            </div>
          </div>

          <div className="grid gap-4 p-5 md:grid-cols-2 xl:grid-cols-4">
            <Field label="Project *" error={fieldErrors.projectId} className="xl:col-span-2">
              <select
                value={form.projectId}
                onChange={(event) => handleProjectChange(event.target.value)}
                disabled={Boolean(editingTaskId)}
                className={inputClass}
              >
                <option value="">Select project</option>
                {(editingTaskId
                  ? projects.filter((project) => project.id === form.projectId)
                  : availableProjects
                ).map((project) => (
                  <option key={project.id} value={project.id}>
                    {getProjectName(project)}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Priority *" error={fieldErrors.priority}>
              <select
                value={form.priority}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    priority: event.target.value as TaskModulePriority
                  }))
                }
                disabled={memberStatusOnly}
                className={inputClass}
              >
                {TASK_PRIORITIES.map((priority) => (
                  <option key={priority}>{priority}</option>
                ))}
              </select>
            </Field>

            <Field label="Status *" error={fieldErrors.status}>
              <select
                value={form.status}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    status: event.target.value as TaskStatus
                  }))
                }
                className={inputClass}
              >
                {TASK_STATUSES.map((status) => (
                  <option key={status} value={status}>{getTaskStatusLabel(status)}</option>
                ))}
              </select>
            </Field>

            <Field label="Task title *" error={fieldErrors.title} className="xl:col-span-2">
              <input
                value={form.title}
                onChange={(event) => {
                  setForm((current) => ({ ...current, title: event.target.value }));
                  setFieldErrors((current) => ({ ...current, title: '' }));
                }}
                disabled={memberStatusOnly}
                className={inputClass}
                placeholder="e.g. Build task creation endpoint"
              />
            </Field>

            <Field
              label="Start date *"
              error={fieldErrors.startDate}
              hint={`Choose ${getLatestDate(today, selectedProject?.startDate) || 'today'} or a later date.`}
            >
              <input
                type="date"
                value={form.startDate}
                min={getLatestDate(today, selectedProject?.startDate)}
                max={selectedProject ? getProjectEndDate(selectedProject) : undefined}
                onChange={(event) => {
                  setForm((current) => ({ ...current, startDate: event.target.value }));
                  setFieldErrors((current) => ({ ...current, startDate: '' }));
                }}
                disabled={memberStatusOnly}
                className={inputClass}
              />
            </Field>

            <Field
              label="Due date *"
              error={fieldErrors.dueDate}
              hint={`Choose the start date or later${selectedProject ? `, up to ${getProjectEndDate(selectedProject)}` : ''}.`}
            >
              <input
                type="date"
                value={form.dueDate}
                min={getLatestDate(form.startDate, today, selectedProject?.startDate)}
                max={selectedProject ? getProjectEndDate(selectedProject) : undefined}
                onChange={(event) => {
                  setForm((current) => ({ ...current, dueDate: event.target.value }));
                  setFieldErrors((current) => ({ ...current, dueDate: '' }));
                }}
                disabled={memberStatusOnly}
                className={inputClass}
              />
            </Field>

            <Field
              label="Description *"
              error={fieldErrors.description}
              className="md:col-span-2 xl:col-span-4"
            >
              <textarea
                value={form.description}
                onChange={(event) => {
                  setForm((current) => ({ ...current, description: event.target.value }));
                  setFieldErrors((current) => ({ ...current, description: '' }));
                }}
                disabled={memberStatusOnly}
                rows={3}
                className={inputClass}
                placeholder="Describe the expected outcome and relevant context."
              />
            </Field>

            {!memberStatusOnly && (
              <Field
                label={`Assignees * (${form.assigneeIds.length} selected)`}
                error={fieldErrors.assigneeIds}
                className="md:col-span-2 xl:col-span-4"
              >
                {!selectedProject ? (
                  <div className="rounded-lg border border-dashed border-white/10 px-4 py-5 text-center text-xs text-slate-500">
                    Select a project to load its members.
                  </div>
                ) : availableAssignees.length === 0 ? (
                  <div className="rounded-lg border border-rose-500/20 bg-rose-500/5 px-4 py-3 text-xs text-rose-300">
                    This project has no active members available for assignment.
                  </div>
                ) : (
                  <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                    {availableAssignees.map((user) => {
                      const selected = form.assigneeIds.includes(user.id);
                      return (
                        <button
                          key={user.id}
                          type="button"
                          onClick={() => toggleAssignee(user.id)}
                          className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition ${
                            selected
                              ? 'border-cyan-400/50 bg-cyan-500/12 text-white'
                              : 'border-white/10 bg-slate-950/40 text-slate-300 hover:border-white/20'
                          }`}
                        >
                          <span
                            className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${
                              selected
                                ? 'border-cyan-400 bg-cyan-400 text-slate-950'
                                : 'border-slate-600'
                            }`}
                          >
                            {selected && <Check size={13} />}
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate text-xs font-semibold">{user.name}</span>
                            <span className="block truncate text-[10px] text-slate-500">{user.title}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </Field>
            )}
          </div>

          <div className="border-t border-white/10 bg-black/10 px-5 py-4">
            {formError && (
              <p role="alert" className="mb-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
                {formError}
              </p>
            )}
            <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={resetForm}
              className="rounded-lg border border-white/10 px-4 py-2 text-sm text-slate-300 transition hover:bg-white/5"
            >
              {editingTaskId ? 'Cancel' : 'View Tasks'}
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="glass-button-neon inline-flex items-center gap-2 rounded-lg px-5 py-2 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting && <LoaderCircle size={14} className="animate-spin" />}
              {isSubmitting
                ? 'Saving...'
                : editingTaskId
                  ? 'Save changes'
                  : 'Create task'}
            </button>
            </div>
          </div>
        </form>
        </div>
      )}

      {subtaskStep && subtaskStep === 'ask' && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) handleCancelSubtasks();
          }}
        >
          <div className="glass-panel-glow w-full max-w-lg p-6">
            <div className="flex items-center gap-2 text-cyan-400">
              <Layers size={20} />
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-cyan-300">Subtasks</p>
            </div>
            <h2 className="mt-2 text-lg font-bold text-white">Add subtasks?</h2>
            <p className="mt-1 text-sm text-slate-400">
              Break this task into smaller pieces, or skip to view the task list.
            </p>
            <div className="mt-4">
              <label className="block text-xs font-semibold text-slate-300">Number of subtasks</label>
              <div className="mt-2 flex items-center gap-3">
                <button type="button" onClick={() => setSubtaskCount(Math.max(1, subtaskCount - 1))} className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 text-slate-300 hover:bg-white/5">-</button>
                <span className="w-12 text-center text-lg font-bold text-white">{subtaskCount}</span>
                <button type="button" onClick={() => setSubtaskCount(Math.min(10, subtaskCount + 1))} className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 text-slate-300 hover:bg-white/5">+</button>
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" onClick={handleCancelSubtasks} className="rounded-lg border border-white/10 px-4 py-2 text-sm text-slate-300 transition hover:bg-white/5">Skip</button>
              <button type="button" onClick={() => { if (subtaskCount <= 0) handleCancelSubtasks(); else startSubtasks(); }} className="glass-button-neon rounded-lg px-5 py-2 text-sm font-bold">Continue</button>
            </div>
          </div>
        </div>
      )}

      {subtaskStep === 'details' && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) handleCancelSubtasks();
          }}
        >
          <div className="glass-panel-glow flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden">
            <div className="border-b border-white/10 px-5 py-4">
              <div className="flex items-center gap-2 text-cyan-400">
                <Layers size={18} />
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-cyan-300">Subtasks</p>
              </div>
              <h2 className="mt-1 text-lg font-bold text-white">
                Create {subtaskDrafts.length} subtask{subtaskDrafts.length > 1 ? 's' : ''}
              </h2>
            </div>
            <div className="flex-1 space-y-3 overflow-y-auto p-5">
              {subtaskDrafts.map((sub, index) => (
                <div key={index} className="rounded-xl border border-white/10 bg-slate-950/40 p-4">
                  <div className="flex flex-col gap-3 border-b border-white/5 pb-3 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-cyan-300">
                        Subtask {index + 1}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">Set this subtask's workflow details here.</p>
                    </div>
                    <div className="grid grid-cols-2 gap-2 sm:w-[300px]">
                      <Field label="Priority *" error={subtaskErrors[`${index}.priority`]}>
                        <select
                          value={sub.priority}
                          onChange={(event) => updateSubtask(index, { priority: event.target.value as TaskModulePriority })}
                          className={`${inputClass} py-1.5 text-xs`}
                        >
                          {TASK_PRIORITIES.map((priority) => (
                            <option key={priority} value={priority}>{priority}</option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Status *" error={subtaskErrors[`${index}.status`]}>
                        <select
                          value={sub.status}
                          onChange={(event) => updateSubtask(index, { status: event.target.value as TaskStatus })}
                          className={`${inputClass} py-1.5 text-xs`}
                        >
                          {TASK_STATUSES.map((status) => (
                            <option key={status} value={status}>{getTaskStatusLabel(status)}</option>
                          ))}
                        </select>
                      </Field>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <Field label="Subtask name *" error={subtaskErrors[`${index}.title`]} className="sm:col-span-2">
                      <input
                        value={sub.title}
                        onChange={(event) => updateSubtask(index, { title: event.target.value })}
                        className={inputClass}
                        placeholder="What needs to be done?"
                      />
                    </Field>
                    <Field label="Description *" error={subtaskErrors[`${index}.description`]} className="sm:col-span-2">
                      <textarea
                        value={sub.description}
                        onChange={(event) => updateSubtask(index, { description: event.target.value })}
                        rows={2}
                        className={inputClass}
                        placeholder="Describe the expected outcome."
                      />
                    </Field>
                    <Field label="Start date *" error={subtaskErrors[`${index}.startDate`]}>
                      <input
                        type="date"
                        value={sub.startDate}
                        min={getLatestDate(form.startDate, selectedProject?.startDate)}
                        max={form.dueDate}
                        onChange={(event) => updateSubtask(index, { startDate: event.target.value })}
                        className={inputClass}
                      />
                    </Field>
                    <Field label="Due date *" error={subtaskErrors[`${index}.dueDate`]}>
                      <input
                        type="date"
                        value={sub.dueDate}
                        min={getLatestDate(sub.startDate, form.startDate)}
                        max={form.dueDate}
                        onChange={(event) => updateSubtask(index, { dueDate: event.target.value })}
                        className={inputClass}
                      />
                    </Field>
                    <Field
                      label={`Assignees * (${sub.assigneeIds.length} selected)`}
                      error={subtaskErrors[`${index}.assigneeIds`]}
                      className="sm:col-span-2"
                    >
                      <div className="grid gap-2 sm:grid-cols-2">
                        {availableAssignees.map((user) => {
                          const selected = sub.assigneeIds.includes(user.id);
                          return (
                            <button
                              key={user.id}
                              type="button"
                              onClick={() => updateSubtask(index, {
                                assigneeIds: selected
                                  ? sub.assigneeIds.filter((id) => id !== user.id)
                                  : [...sub.assigneeIds, user.id]
                              })}
                              className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-left transition ${
                                selected
                                  ? 'border-cyan-400/45 bg-cyan-500/10 text-white'
                                  : 'border-white/10 bg-slate-950/40 text-slate-300 hover:border-white/20'
                              }`}
                            >
                              <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                                selected ? 'border-cyan-400 bg-cyan-400 text-slate-950' : 'border-slate-600'
                              }`}>
                                {selected && <Check size={11} />}
                              </span>
                              <span className="min-w-0">
                                <span className="block truncate text-xs font-semibold">{user.name}</span>
                                <span className="block truncate text-[10px] text-slate-500">{user.title}</span>
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </Field>
                  </div>
                </div>
              ))}
            </div>
            <div className="border-t border-white/10 bg-black/10 px-5 py-4">
              <div className="flex justify-end gap-2">
                <button type="button" onClick={handleCancelSubtasks} disabled={isCreatingSubtasks} className="rounded-lg border border-white/10 px-4 py-2 text-sm text-slate-300 transition hover:bg-white/5 disabled:opacity-50">Cancel</button>
                <button type="button" onClick={handleSubtasksSubmit} disabled={isCreatingSubtasks} className="glass-button-neon inline-flex items-center gap-2 rounded-lg px-5 py-2 text-sm font-bold disabled:opacity-60">
                  {isCreatingSubtasks && <LoaderCircle size={14} className="animate-spin" />}
                  {isCreatingSubtasks ? 'Creating...' : `Create ${subtaskDrafts.length} subtask${subtaskDrafts.length > 1 ? 's' : ''}`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {!isCreatePage && <div className="glass-panel overflow-hidden">
        <div className="border-b border-white/10 p-4">
          <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="flex items-center gap-2 font-bold text-white">
                <CheckSquare size={17} className="text-cyan-400" />
                Task list
                <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] text-slate-400">
                  {visibleTasks.length}
                </span>
              </h2>
              <p className="mt-0.5 text-xs text-slate-500">
                Search, filter, and sort current work across projects.
              </p>
            </div>

            <button
              type="button"
              onClick={() => setMyTasksOnly((value) => !value)}
              className={`inline-flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold transition ${
                myTasksOnly
                  ? 'border-cyan-400/50 bg-cyan-500/15 text-cyan-300'
                  : 'border-white/10 text-slate-300 hover:bg-white/5'
              }`}
            >
              <UserRound size={14} />
              My Tasks
            </button>
          </div>

          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-6">
            <label className="relative md:col-span-2 xl:col-span-2">
              <Search
                size={14}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"
              />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className={`${inputClass} pl-9`}
                placeholder="Search task title"
              />
            </label>

            <FilterSelect value={projectFilter} onChange={setProjectFilter} label="All projects">
              {projects.map((project) => (
                <option key={project.id} value={project.id}>{getProjectName(project)}</option>
              ))}
            </FilterSelect>

            <FilterSelect value={statusFilter} onChange={setStatusFilter} label="All statuses">
              {TASK_STATUSES.map((status) => (
                <option key={status} value={status}>{getTaskStatusLabel(status)}</option>
              ))}
            </FilterSelect>

            <FilterSelect value={priorityFilter} onChange={setPriorityFilter} label="All priorities">
              {TASK_PRIORITIES.map((priority) => <option key={priority}>{priority}</option>)}
            </FilterSelect>

            <FilterSelect value={assigneeFilter} onChange={setAssigneeFilter} label="All assignees">
              {users.map((user) => (
                <option key={user.id} value={user.id}>{user.name}</option>
              ))}
            </FilterSelect>
          </div>

          <div className="mt-2 flex items-center justify-between">
            <button
              type="button"
              onClick={() =>
                setDueDateDirection((value) => value === 'asc' ? 'desc' : 'asc')
              }
              className="inline-flex items-center gap-1.5 text-[11px] text-slate-400 transition hover:text-cyan-300"
            >
              <ArrowDownAZ size={13} />
              Due date {dueDateDirection === 'asc' ? 'earliest first' : 'latest first'}
            </button>
            {hasActiveFilters && (
              <button
                type="button"
                onClick={clearFilters}
                className="text-[11px] font-semibold text-cyan-400 hover:text-cyan-300"
              >
                Clear filters
              </button>
            )}
          </div>
        </div>

        {isLoading ? (
          <StateMessage
            icon={<LoaderCircle className="animate-spin text-cyan-400" size={24} />}
            title="Loading tasks"
            description="Preparing the current task workspace."
          />
        ) : parentTasks.length === 0 ? (
          <StateMessage
            icon={<ClipboardList className="text-slate-500" size={26} />}
            title="No tasks yet"
            description="Create the first task for an active project."
          />
        ) : visibleTasks.length === 0 ? (
          <StateMessage
            icon={<Filter className="text-slate-500" size={24} />}
            title="No matching tasks"
            description="Try changing or clearing the current filters."
          />
        ) : (
          <div className="max-h-[calc(100vh-290px)] min-h-[420px] overflow-y-auto rounded-2xl border border-white/10 bg-slate-950/25 p-4">
            <div className="grid items-start gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {visibleTasks.map((task) => {
              const project = projects.find((item) => item.id === task.projectId);
              if (!project) return null;
              const assignees = getTaskAssigneeIds(task)
                .map((id) => users.find((user) => user.id === id))
                .filter(Boolean);
              const overdue = isTaskOverdue(task, today);
              const mayEdit = canEditTask(currentRole, currentUser.id, project, task);
              const mayDelete = canDeleteTask(currentRole, currentUser.id, project);

              const loadedTask = expandedTaskDetails[task.id];
              const subtasks = loadedTask?.subtasks || task.subtasks || [];
              const subtaskCount = Math.max(task.subtaskCount || 0, subtasks.length);
              const completedSubtasks = subtasks.filter((subtask) =>
                subtask.completed || subtask.status === 'Done'
              ).length;
              const isExpanded = expandedTaskId === task.id;
              const isExpanding = expandingTaskId === task.id;

              return (
                <article
                  key={task.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => void loadTaskDetailFromApi(task.id).then(setViewingTask).catch(() => setViewingTask(task))}
                  onKeyDown={(event) => {
                    if (event.target !== event.currentTarget) return;
                    if (event.key === 'Enter' || event.key === ' ') void loadTaskDetailFromApi(task.id).then(setViewingTask).catch(() => setViewingTask(task));
                  }}
                  className="group relative flex min-h-[340px] flex-col rounded-xl border border-white/10 bg-slate-950/55 p-5 text-left shadow-lg shadow-black/15 transition hover:-translate-y-0.5 hover:border-cyan-400/35 hover:bg-slate-950/75 focus:outline-none focus:ring-2 focus:ring-cyan-400/30"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 pr-12">
                      <p className="truncate text-[11px] font-bold uppercase tracking-[0.12em] text-cyan-300">
                        {getProjectName(project)}
                      </p>
                    </div>
                    {(mayEdit || mayDelete) && (
                      <div
                        data-task-actions
                        className="absolute right-4 top-4 z-10"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <button
                          type="button"
                          onClick={() =>
                            setOpenMenuTaskId((current) => current === task.id ? null : task.id)
                          }
                        className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 transition hover:bg-white/10 hover:text-white"
                          aria-label="Task actions"
                        >
                          <MoreHorizontal size={18} />
                        </button>
                        {openMenuTaskId === task.id && (
                          <div className="absolute right-0 top-8 z-20 w-32 overflow-hidden rounded-lg border border-white/10 bg-slate-950 py-1 shadow-xl">
                            {mayEdit && (
                              <button
                                type="button"
                                onClick={() => {
                                  openEditForm(task);
                                  setOpenMenuTaskId(null);
                                }}
                                className="block w-full px-3 py-2 text-left text-xs text-slate-200 transition hover:bg-white/10"
                              >
                                Edit
                              </button>
                            )}
                            {mayDelete && (
                              <button
                                type="button"
                                onClick={() => {
                                  setTaskPendingDeletion(task);
                                  setDeleteError(null);
                                  setOpenMenuTaskId(null);
                                }}
                                className="block w-full px-3 py-2 text-left text-xs text-rose-300 transition hover:bg-rose-500/10"
                              >
                                Delete
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <h3 title={task.title} className="mt-4 break-words pr-10 text-xl font-bold leading-7 text-white">
                    {task.title}
                  </h3>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <TaskBadge value={task.priority} kind="priority" />
                    {subtaskCount > 0 && (
                      <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-xs font-semibold text-slate-300">
                        {subtaskCount} Subtask{subtaskCount === 1 ? '' : 's'}
                      </span>
                    )}
                  </div>
                  <p className="mt-3 line-clamp-2 min-h-[40px] text-sm leading-5 text-slate-400">
                    {task.description}
                  </p>

                  <div className="mt-4">
                    <TaskBadge value={task.status} kind="status" />

                  </div>

                  <div className="mt-auto border-t border-white/10 pt-4">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="font-semibold text-slate-300">Due {formatDate(task.dueDate)}</span>
                      {overdue && (
                        <span className="rounded-full border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 font-medium text-rose-300">
                          Overdue
                        </span>
                      )}
                    </div>
                    <div className="mt-4 flex min-w-0 items-center gap-2">
                      <UsersRound size={14} className="shrink-0 text-slate-500" />
                      <span className="truncate text-xs font-semibold text-slate-300">
                        {assignees.map((user) => user?.name).join(', ') || 'Unassigned'}
                      </span>
                    </div>
                    {subtaskCount > 0 && (
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          void toggleTaskExpansion(task);
                        }}
                        className="mt-4 flex w-full items-center justify-between rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs font-semibold text-slate-300 transition hover:border-cyan-400/30 hover:bg-cyan-500/[0.06] hover:text-cyan-200"
                        aria-expanded={isExpanded}
                      >
                        <span className="inline-flex items-center gap-2">
                          {isExpanding
                            ? <LoaderCircle size={14} className="animate-spin text-cyan-400" />
                            : <Layers size={14} className="text-cyan-400" />}
                          {isExpanded ? 'Hide subtasks' : 'View subtasks'}
                        </span>
                        <ChevronDown
                          size={14}
                          className={`transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                        />
                      </button>
                    )}
                  </div>

                  {isExpanded && subtaskCount > 0 && (
                    <div
                      className="mt-4 border-t border-white/10 pt-4"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                          Subtasks ({completedSubtasks}/{subtaskCount} complete)
                        </p>
                      </div>

                      {isExpanding ? (
                        <div className="flex items-center justify-center gap-2 rounded-xl border border-white/5 bg-slate-950/30 px-3 py-6 text-xs text-slate-400">
                          <LoaderCircle size={15} className="animate-spin text-cyan-400" />
                          Loading subtask details...
                        </div>
                      ) : expandedTaskError?.taskId === task.id ? (
                        <div className="rounded-xl border border-rose-500/20 bg-rose-500/[0.06] px-3 py-3 text-xs text-rose-300">
                          {expandedTaskError.message}
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {subtasks.length === 0 && (
                            <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.02] px-3 py-5 text-center text-xs text-slate-500">
                              No subtask details are available.
                            </div>
                          )}
                          {subtasks.map((subtask, index) => {
                            const subtaskStatus = subtask.status || (subtask.completed ? 'Done' : 'Todo');
                            const subtaskPriority = subtask.priority || task.priority;
                            const subtaskOverdue = Boolean(
                              subtask.dueDate
                              && subtaskStatus !== 'Done'
                              && subtask.dueDate < today
                            );
                            const subtaskAssignees = (subtask.assigneeIds || [])
                              .map((id) => users.find((user) => user.id === id)?.name)
                              .filter((name): name is string => Boolean(name));

                            return (
                              <div key={subtask.id} className="rounded-xl border border-white/10 bg-slate-950/45 p-3.5">
                                <div className="flex flex-wrap items-start justify-between gap-2">
                                  <div className="min-w-0">
                                    <p className="text-[9px] font-bold uppercase tracking-[0.13em] text-slate-500">
                                      Subtask {index + 1}
                                    </p>
                                    <h4 className="mt-1 break-words text-sm font-bold leading-5 text-slate-100">
                                      {subtask.title}
                                    </h4>
                                  </div>
                                  <div className="flex flex-wrap gap-1.5">
                                    <TaskBadge value={subtaskPriority} kind="priority" />
                                    <TaskBadge value={subtaskStatus} kind="status" />
                                  </div>
                                </div>

                                <p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-slate-400">
                                  {subtask.description || 'No description provided.'}
                                </p>

                                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                                  <DetailBox label="Assigned to" value={subtaskAssignees.join(', ') || 'Unassigned'} compact />
                                  <DetailBox label="Start date" value={formatOptionalDate(subtask.startDate)} compact />
                                  <DetailBox
                                    label="Due date"
                                    value={`${formatOptionalDate(subtask.dueDate)}${subtaskOverdue ? ' · Overdue' : ''}`}
                                    overdue={subtaskOverdue}
                                    compact
                                  />
                                  <DetailBox label="Status" value={getTaskStatusLabel(subtaskStatus)} compact />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </div>
        )}
      </div>
      }
      {viewingTask && (
        <TaskDetailsModal
          task={viewingTask}
          project={projects.find((item) => item.id === viewingTask.projectId)}
          users={users}
          onClose={() => setViewingTask(null)}
        />
      )}
      {taskPendingDeletion && (
        <DeleteTaskModal
          task={taskPendingDeletion}
          isDeleting={isDeleting}
          error={deleteError}
          onCancel={() => !isDeleting && setTaskPendingDeletion(null)}
          onConfirm={() => void handleDelete()}
        />
      )}
    </section>
  );
};

const Field: React.FC<{
  label: string;
  error?: string;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}> = ({ label, error, hint, className = '', children }) => (
  <label className={`block space-y-1.5 ${className}`}>
    <span className="text-xs font-semibold text-slate-300">{label}</span>
    {children}
    {error && <span className="block text-[11px] text-rose-400">{error}</span>}
    {!error && hint && <span className="block text-[11px] leading-4 text-slate-500">{hint}</span>}
  </label>
);

const FilterSelect: React.FC<{
  value: string;
  onChange: (value: string) => void;
  label: string;
  children: React.ReactNode;
}> = ({ value, onChange, label, children }) => (
  <label className="relative">
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className={`${inputClass} appearance-none pr-8 text-xs`}
    >
      <option value="">{label}</option>
      {children}
    </select>
    <ChevronDown
      size={13}
      className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-500"
    />
  </label>
);

const TaskBadge: React.FC<{
  value: TaskStatus | TaskPriority;
  kind: 'status' | 'priority';
}> = ({ value, kind }) => {
  const statusColors: Record<TaskStatus, string> = {
    Todo: 'border-cyan-500/30 bg-cyan-500/15 text-cyan-300',
    'In Progress': 'border-amber-500/30 bg-amber-500/15 text-amber-300',
    Review: 'border-violet-500/30 bg-violet-500/15 text-violet-300',
    Done: 'border-emerald-500/30 bg-emerald-500/15 text-emerald-300',
    Blocked: 'border-rose-500/30 bg-rose-500/15 text-rose-300'
  };
  const priorityColors: Record<TaskPriority, string> = {
    Low: 'border-slate-500/30 bg-slate-500/15 text-slate-300',
    Medium: 'border-cyan-500/30 bg-cyan-500/10 text-cyan-300',
    High: 'border-amber-500/30 bg-amber-500/15 text-amber-300',
    Urgent: 'border-fuchsia-500/30 bg-fuchsia-500/15 text-fuchsia-300',
  };
  const classes = kind === 'status'
    ? statusColors[value as TaskStatus]
    : priorityColors[value as TaskPriority];
  const label = kind === 'status'
    ? getTaskStatusLabel(value as TaskStatus)
    : getTaskPriorityValue(value as TaskPriority);

  return (
    <span
      data-task-badge
      data-task-badge-kind={kind}
      data-task-badge-value={value}
      className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${classes}`}
    >
      {label}
    </span>
  );
};

const StateMessage: React.FC<{
  icon: React.ReactNode;
  title: string;
  description: string;
}> = ({ icon, title, description }) => (
  <div className="flex min-h-52 flex-col items-center justify-center px-6 text-center">
    {icon}
    <h3 className="mt-3 font-semibold text-slate-200">{title}</h3>
    <p className="mt-1 text-xs text-slate-500">{description}</p>
  </div>
);

const DeleteTaskModal: React.FC<{
  task: Task;
  isDeleting: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}> = ({ task, isDeleting, error, onCancel, onConfirm }) => (
  <div
    role="dialog"
    aria-modal="true"
    aria-labelledby="delete-task-title"
    className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
    onKeyDown={(event) => {
      if (event.key === 'Escape' && !isDeleting) onCancel();
    }}
    onMouseDown={(event) => {
      if (event.target === event.currentTarget && !isDeleting) onCancel();
    }}
  >
    <div className="glass-panel-glow w-full max-w-md p-5">
      <p className="text-xs font-bold uppercase tracking-[0.16em] text-rose-300">Permanent action</p>
      <h2 id="delete-task-title" className="mt-2 text-lg font-bold text-white">Delete this task?</h2>
      <p className="mt-2 text-sm leading-6 text-slate-400">
        <span className="font-semibold text-slate-200">{task.title}</span> will be permanently removed. This cannot be undone.
      </p>
      {error && <p role="alert" className="mt-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{error}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" autoFocus onClick={onCancel} disabled={isDeleting} className="rounded-lg border border-white/10 px-4 py-2 text-sm text-slate-300 disabled:opacity-50">Cancel</button>
        <button type="button" onClick={onConfirm} disabled={isDeleting} className="inline-flex items-center gap-2 rounded-lg bg-rose-500 px-4 py-2 text-sm font-bold text-white transition hover:bg-rose-400 disabled:opacity-50">
          {isDeleting && <LoaderCircle size={14} className="animate-spin" />}{isDeleting ? 'Deleting…' : 'Delete task'}
        </button>
      </div>
    </div>
  </div>
);

const TaskDetailsModal: React.FC<{
  task: Task;
  project?: Project;
  users: User[];
  onClose: () => void;
}> = ({ task, project, users, onClose }) => {
  const teamLead = project
    ? users.find((user) => user.id === project.teamLeadId)
    : undefined;
  const taskAssignees = getTaskAssigneeIds(task)
    .map((id) => users.find((user) => user.id === id)?.name)
    .filter((name): name is string => Boolean(name));
  const taskOverdue = isTaskOverdue(task, today);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="task-details-title"
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 p-3 pt-[5vh] backdrop-blur-sm sm:items-center sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="glass-panel flex max-h-[86vh] w-full max-w-[680px] flex-col overflow-hidden rounded-2xl border border-white/10 shadow-2xl sm:max-h-[80vh]">
        <header className="flex shrink-0 items-center justify-between border-b border-white/10 bg-slate-950/25 px-5 py-3.5 sm:px-6">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-400">Task overview</p>
            <div className="mt-0.5 flex min-w-0 items-center gap-2">
              <h2 id="task-details-title" className="text-base font-bold text-white">Details</h2>
              <span className="rounded-md border border-white/10 bg-white/5 px-2 py-0.5 font-mono text-[10px] text-slate-400">
                {task.taskNumber}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-slate-400 transition hover:bg-white/[0.07] hover:text-white"
            aria-label="Close task details"
          >
            <X size={18} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5 sm:px-6">
          <div className="space-y-7">
            <section aria-labelledby="project-context-heading">
              <SectionHeading id="project-context-heading" eyebrow="Project" title={project ? getProjectName(project) : 'Unknown project'} />
              {project?.description && (
                <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">{project.description}</p>
              )}
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <DetailBox label="Status" value={project?.status || 'Unknown'} />
                <DetailBox label="Start date" value={formatOptionalDate(project?.startDate)} />
                <DetailBox label="Due date" value={formatOptionalDate(project?.targetDate)} />
                <DetailBox label="Team lead" value={teamLead?.name || 'Not assigned'} />
              </div>
            </section>

            <section aria-labelledby="task-information-heading" className="border-t border-white/10 pt-6">
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-400">Task</p>
              <h3 id="task-information-heading" className="mt-1.5 break-words text-xl font-bold leading-7 text-white sm:text-2xl">
                {task.title}
              </h3>

              <div className="mt-3">
                <span className="mr-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Priority</span>
                <TaskBadge value={task.priority} kind="priority" />
              </div>

              <div className="mt-5">
                <h4 className="text-xs font-semibold text-slate-300">Description</h4>
                <p className="mt-1.5 whitespace-pre-wrap text-sm leading-6 text-slate-400">{task.description}</p>
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <DetailBox label="Status" value={getTaskStatusLabel(task.status)} />
                <DetailBox label="Assigned to" value={taskAssignees.join(', ') || 'Unassigned'} />
                <DetailBox label="Start date" value={formatOptionalDate(getTaskStartDate(task))} />
                <DetailBox
                  label="Due date"
                  value={`${formatOptionalDate(task.dueDate)}${taskOverdue ? ' · Overdue' : ''}`}
                  overdue={taskOverdue}
                />
              </div>
            </section>

            <section aria-labelledby="subtasks-heading" className="border-t border-white/10 pt-6">
              <div className="flex items-end justify-between gap-3">
                <SectionHeading
                  id="subtasks-heading"
                  eyebrow="Breakdown"
                  title={`Subtasks (${task.subtasks.length})`}
                />
                {task.subtasks.length > 0 && (
                  <span className="text-xs font-medium text-slate-500">
                    {task.subtasks.filter((subtask) => subtask.completed || subtask.status === 'Done').length} complete
                  </span>
                )}
              </div>

              {task.subtasks.length === 0 ? (
                <div className="mt-4 rounded-xl border border-dashed border-white/10 bg-white/[0.02] px-4 py-6 text-center">
                  <p className="text-sm font-medium text-slate-300">No subtasks yet</p>
                  <p className="mt-1 text-xs text-slate-500">This task has not been broken into smaller work items.</p>
                </div>
              ) : (
                <div className="mt-4 space-y-3">
                  {task.subtasks.map((subtask, index) => {
                    const subtaskStatus = subtask.status || (subtask.completed ? 'Done' : 'Todo');
                    const subtaskPriority = subtask.priority || task.priority;
                    const subtaskOverdue = Boolean(
                      subtask.dueDate
                      && subtaskStatus !== 'Done'
                      && subtask.dueDate < today
                    );
                    const subtaskAssignees = (subtask.assigneeIds || [])
                      .map((id) => users.find((user) => user.id === id)?.name)
                      .filter((name): name is string => Boolean(name));

                    return (
                      <article key={subtask.id} className="rounded-2xl border border-white/10 bg-slate-950/30 p-4 sm:p-5">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">Subtask {index + 1}</p>
                            <h4 className="mt-1 break-words text-base font-bold leading-6 text-white">{subtask.title}</h4>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <TaskBadge value={subtaskStatus} kind="status" />
                            <TaskBadge value={subtaskPriority} kind="priority" />
                          </div>
                        </div>

                        <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-400">
                          {subtask.description?.trim() || 'No description provided.'}
                        </p>

                        <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
                          <DetailBox label="Assigned to" value={subtaskAssignees.join(', ') || 'Unassigned'} compact />
                          <DetailBox label="Status" value={getTaskStatusLabel(subtaskStatus)} compact />
                          <DetailBox label="Start date" value={formatOptionalDate(subtask.startDate)} compact />
                          <DetailBox
                            label="Due date"
                            value={`${formatOptionalDate(subtask.dueDate)}${subtaskOverdue ? ' · Overdue' : ''}`}
                            compact
                            overdue={subtaskOverdue}
                          />
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        </div>
      </div>
    </div>
  );
};

const SectionHeading: React.FC<{ id: string; eyebrow: string; title: string }> = ({ id, eyebrow, title }) => (
  <div>
    <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-400">{eyebrow}</p>
    <h3 id={id} className="mt-1 break-words text-lg font-bold leading-6 text-white">{title}</h3>
  </div>
);

const DetailBox: React.FC<{
  label: string;
  value: string;
  compact?: boolean;
  overdue?: boolean;
}> = ({ label, value, compact = false, overdue = false }) => (
  <div className={`rounded-xl border ${overdue ? 'border-rose-500/25 bg-rose-500/[0.06]' : 'border-white/10 bg-white/[0.025]'} ${compact ? 'px-3 py-2.5' : 'p-3.5'}`}>
    <span className="block text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">{label}</span>
    <span className={`mt-1 block break-words text-xs font-semibold leading-5 ${overdue ? 'text-rose-300' : 'text-slate-200'}`}>{value}</span>
  </div>
);
