import React, { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowDownAZ,
  Check,
  ChevronDown,
  ClipboardList,
  Filter,
  LoaderCircle,
  MoreHorizontal,
  Plus,
  Search,
  UserRound,
  UsersRound,
  X
} from 'lucide-react';
import { useApp } from '../../store/AppContext';
import { Task, TaskPriority, TaskStatus } from '../../types';
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
  validateTaskInput
} from './taskRules';

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
  const [openMenuTaskId, setOpenMenuTaskId] = useState<string | null>(null);
  const [form, setForm] = useState<TaskFormInput>(emptyForm);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [search, setSearch] = useState('');
  const [projectFilter, setProjectFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [assigneeFilter, setAssigneeFilter] = useState('');
  const [myTasksOnly, setMyTasksOnly] = useState(false);
  const [dueDateDirection, setDueDateDirection] = useState<'asc' | 'desc'>('asc');

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setIsLoading(false));
    return () => window.cancelAnimationFrame(frame);
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

  const resetForm = () => {
    setForm(emptyForm());
    setEditingTaskId(null);
    setFieldErrors({});
    setIsFormOpen(false);
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
    setNotice(null);
    setIsFormOpen(true);
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
      setNotice({ type: 'error', message: 'Review the highlighted fields.' });
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
        setNotice({ type: 'error', message: result.message });
        return;
      }

      resetForm();
      setNotice({ type: 'success', message: result.message });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (task: Task) => {
    if (!window.confirm(`Delete "${task.title}"? This action cannot be undone.`)) return;
    const result = await deleteTask(task.id);
    setNotice({ type: result.success ? 'success' : 'error', message: result.message });
    if (viewingTask?.id === task.id) setViewingTask(null);
    setOpenMenuTaskId(null);
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

  const memberStatusOnly = editingTaskId !== null && currentRole === 'Team_Member';
  const hasActiveFilters = Boolean(
    search || projectFilter || statusFilter || priorityFilter || assigneeFilter || myTasksOnly
  );

  return (
    <section className="mx-auto max-w-[1500px] space-y-5">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Tasks</h1>
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

      {isFormOpen && (
        <form onSubmit={handleSubmit} className="glass-panel-glow overflow-hidden">
          <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
            <div>
              <h2 className="font-bold text-white">
                {editingTaskId ? 'Edit task' : 'Create task'}
              </h2>
              <p className="mt-0.5 text-xs text-slate-400">
                {memberStatusOnly
                  ? 'Update progress for your assigned work.'
                  : 'Add the work details, schedule, and assignees.'}
              </p>
            </div>
            <button
              type="button"
              onClick={resetForm}
              className="rounded-lg p-2 text-slate-400 transition hover:bg-white/10 hover:text-white"
              aria-label="Close form"
            >
              <X size={18} />
            </button>
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

            <Field label="Start date *" error={fieldErrors.startDate}>
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

            <Field label="Due date *" error={fieldErrors.dueDate}>
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

          <div className="flex justify-end gap-2 border-t border-white/10 bg-black/10 px-5 py-4">
            <button
              type="button"
              onClick={resetForm}
              className="rounded-lg border border-white/10 px-4 py-2 text-sm text-slate-300 transition hover:bg-white/5"
            >
              View Tasks
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
        </form>
      )}

      <div className="glass-panel overflow-hidden">
        <div className="border-b border-white/10 p-4">
          <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="flex items-center gap-2 font-bold text-white">
                <ClipboardList size={17} className="text-cyan-400" />
                Task list
                <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] text-slate-400">
                  {filteredTasks.length}
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
        ) : tasks.length === 0 ? (
          <StateMessage
            icon={<ClipboardList className="text-slate-500" size={26} />}
            title="No tasks yet"
            description="Create the first task for an active project."
          />
        ) : filteredTasks.length === 0 ? (
          <StateMessage
            icon={<Filter className="text-slate-500" size={24} />}
            title="No matching tasks"
            description="Try changing or clearing the current filters."
          />
        ) : (
          <div className="grid gap-4 p-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {filteredTasks.map((task) => {
              const project = projects.find((item) => item.id === task.projectId);
              if (!project) return null;
              const assignees = getTaskAssigneeIds(task)
                .map((id) => users.find((user) => user.id === id))
                .filter(Boolean);
              const overdue = isTaskOverdue(task, today);
              const mayEdit = canEditTask(currentRole, currentUser.id, project, task);
              const mayDelete = canDeleteTask(currentRole, currentUser.id, project);

              return (
                <article
                  key={task.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setViewingTask(task)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') setViewingTask(task);
                  }}
                  className="group relative flex min-h-[250px] flex-col rounded-xl border border-white/10 bg-slate-950/55 p-4 text-left shadow-lg shadow-black/15 transition hover:-translate-y-0.5 hover:border-cyan-400/35 hover:bg-slate-950/75 focus:outline-none focus:ring-2 focus:ring-cyan-400/30"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-[11px] font-bold uppercase tracking-[0.12em] text-cyan-300">
                        {getProjectName(project)}
                      </p>
                      <p className="mt-1 font-mono text-[10px] text-slate-500">{task.taskNumber}</p>
                    </div>
                    {(mayEdit || mayDelete) && (
                      <div className="relative" onClick={(event) => event.stopPropagation()}>
                        <button
                          type="button"
                          onClick={() =>
                            setOpenMenuTaskId((current) => current === task.id ? null : task.id)
                          }
                          className="rounded-lg p-1.5 text-slate-400 transition hover:bg-white/10 hover:text-white"
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
                                onClick={() => void handleDelete(task)}
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

                  <h3 className="mt-4 line-clamp-2 text-lg font-bold leading-6 text-white">
                    {task.title}
                  </h3>
                  <p className="mt-2 line-clamp-3 min-h-[60px] text-sm leading-5 text-slate-400">
                    {task.description}
                  </p>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <TaskBadge value={task.status} kind="status" />
                    <TaskBadge value={task.priority} kind="priority" />
                    {overdue && (
                      <span className="rounded-full border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 text-xs font-medium text-rose-300">
                        Overdue
                      </span>
                    )}
                  </div>

                  <div className="mt-auto border-t border-white/10 pt-4">
                    <div className="grid grid-cols-2 gap-3 text-xs">
                      <Detail label="Starts" value={formatDate(getTaskStartDate(task))} compact />
                      <Detail label="Due" value={formatDate(task.dueDate)} compact />
                    </div>
                    <div className="mt-4 flex min-w-0 items-center gap-2">
                      <UsersRound size={14} className="shrink-0 text-slate-500" />
                      <span className="truncate text-xs font-semibold text-slate-300">
                        {assignees.map((user) => user?.name).join(', ') || 'Unassigned'}
                      </span>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
      {viewingTask && (
        <TaskDetailsModal
          task={viewingTask}
          projectName={
            (() => {
              const project = projects.find((item) => item.id === viewingTask.projectId);
              return project ? getProjectName(project) : 'Unknown project';
            })()
          }
          assigneeNames={getTaskAssigneeIds(viewingTask)
            .map((id) => users.find((user) => user.id === id)?.name)
            .filter((name): name is string => Boolean(name))}
          onClose={() => setViewingTask(null)}
        />
      )}
    </section>
  );
};

const Field: React.FC<{
  label: string;
  error?: string;
  className?: string;
  children: React.ReactNode;
}> = ({ label, error, className = '', children }) => (
  <label className={`block space-y-1.5 ${className}`}>
    <span className="text-xs font-semibold text-slate-300">{label}</span>
    {children}
    {error && <span className="block text-[11px] text-rose-400">{error}</span>}
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
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${classes}`}>
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

const TaskDetailsModal: React.FC<{
  task: Task;
  projectName: string;
  assigneeNames: string[];
  onClose: () => void;
}> = ({ task, projectName, assigneeNames, onClose }) => (
  <div
    className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
    onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}
  >
    <div className="glass-panel-glow w-full max-w-2xl overflow-hidden">
      <div className="flex items-start justify-between border-b border-white/10 px-5 py-4">
        <div className="min-w-0">
          <span className="font-mono text-[10px] uppercase tracking-wider text-cyan-400">
            {task.taskNumber}
          </span>
          <h2 className="mt-1 text-lg font-bold text-white">{task.title}</h2>
          <p className="mt-1 text-xs text-slate-400">{projectName}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-2 text-slate-400 hover:bg-white/10 hover:text-white"
          aria-label="Close task details"
        >
          <X size={18} />
        </button>
      </div>
      <div className="space-y-5 p-5">
        <div className="flex flex-wrap gap-2">
          <TaskBadge value={task.status} kind="status" />
          <TaskBadge value={task.priority} kind="priority" />
          {isTaskOverdue(task, today) && (
            <span className="rounded-full border border-rose-500/30 bg-rose-500/10 px-2.5 py-1 text-xs font-semibold text-rose-300">
              Overdue
            </span>
          )}
        </div>
        <div>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-500">
            Description
          </h3>
          <p className="whitespace-pre-wrap text-sm leading-6 text-slate-300">{task.description}</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Detail label="Start date" value={formatDate(getTaskStartDate(task))} />
          <Detail label="Due date" value={formatDate(task.dueDate)} />
          <Detail label="Assignees" value={assigneeNames.join(', ') || 'Unassigned'} />
        </div>
      </div>
    </div>
  </div>
);

const Detail: React.FC<{ label: string; value: string; compact?: boolean }> = ({
  label,
  value,
  compact = false
}) => (
  <div className={`rounded-xl border border-white/10 bg-slate-950/40 ${compact ? 'p-2' : 'p-3'}`}>
    <span className="block text-[10px] uppercase tracking-wider text-slate-500">{label}</span>
    <span className="mt-1 block text-xs font-semibold text-slate-200">{value}</span>
  </div>
);
