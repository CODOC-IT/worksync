import React, { useState } from 'react';
import { useApp } from '../../store/AppContext';
import { ProjectCard } from './ProjectCard';
import { ProjectDetailsDrawer } from './ProjectDetailsDrawer';
import { Project, ProjectStatus, TaskPriority, Milestone, ProjectFile } from '../../types';
import {
  FolderKanban,
  Plus,
  Search,
  X,
  AlertTriangle,
  CheckCircle2,
  Target,
  Paperclip,
  StickyNote,
  Check,
  AlertCircle
} from 'lucide-react';

type StatusFilter = 'All' | ProjectStatus;

interface ProjectFormState {
  title: string;
  description: string;
  startDate: string;
  targetDate: string;
  priority: TaskPriority;
  teamLeadId: string;
  memberIds: string[];
  status: ProjectStatus;
  creationReason: string;
  milestones: Milestone[];
  files: ProjectFile[];
}

const EMPTY_FORM: ProjectFormState = {
  title: '',
  description: '',
  startDate: '',
  targetDate: '',
  priority: 'Medium',
  teamLeadId: '',
  memberIds: [],
  status: 'Active',
  creationReason: '',
  milestones: [],
  files: []
};

const ALLOWED_FILE_EXTENSIONS = ['pdf', 'doc', 'docx', 'xlsx', 'json', 'fig', 'png', 'jpg', 'jpeg', 'zip'];
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

const formatBytes = (bytes: number): string => {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export const ProjectsView: React.FC = () => {
  const { projects, tasks, users, currentRole, currentUser, createProject, updateProject, deleteProject } = useApp();

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('All');

  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<'create' | 'edit'>('create');
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [form, setForm] = useState<ProjectFormState>(EMPTY_FORM);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [formNotice, setFormNotice] = useState('');

  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);
  const [fileError, setFileError] = useState('');
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);

  // Admins must never be selectable as a project's Team Lead or Member, even if upstream
  // user data is ever wrong/inconsistent about role — scoped to this form's two selectors only.
  const nonAdminUsers = users.filter((u) => u.role !== 'Admin');
  const teamLeads = nonAdminUsers.filter((u) => u.role === 'Team_Lead' && u.status !== 'inactive');
  const assignableMembers = nonAdminUsers.filter((u) => u.role === 'Team_Member');
  const todayStr = new Date().toISOString().split('T')[0];

  const canCreate = currentRole === 'Team_Lead' || currentRole === 'Admin';
  const canManage = (project: Project) =>
    currentRole === 'Admin' || (currentRole === 'Team_Lead' && project.teamLeadId === currentUser.id);

  // Team members only see projects they've been assigned to; other roles see everything.
  const visibleProjects =
    currentRole === 'Team_Member'
      ? projects.filter((p) => p.memberIds.includes(currentUser.id))
      : projects;

  const filteredProjects = visibleProjects.filter((p) => {
    const q = searchQuery.trim().toLowerCase();
    const matchesSearch = !q || p.title.toLowerCase().includes(q) || p.code.toLowerCase().includes(q);
    const matchesStatus = statusFilter === 'All' || p.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const openCreateForm = () => {
    setFormMode('create');
    setEditingProjectId(null);
    setForm({
      ...EMPTY_FORM,
      // Team Lead creation defaults to themselves as lead, unless they reassign to another eligible lead
      teamLeadId: currentRole === 'Team_Lead' ? currentUser.id : ''
    });
    setFormErrors({});
    setFileError('');
    setFormOpen(true);
  };

  const openEditForm = (project: Project) => {
    setFormMode('edit');
    setEditingProjectId(project.id);
    setForm({
      title: project.title,
      description: project.description,
      startDate: project.startDate,
      targetDate: project.targetDate,
      priority: project.priority || 'Medium',
      teamLeadId: project.teamLeadId,
      memberIds: project.memberIds,
      status: project.status === 'Pending Approval' ? 'Active' : project.status,
      creationReason: project.creationReason || '',
      milestones: project.milestones,
      files: project.files
    });
    setFormErrors({});
    setFileError('');
    setFormOpen(true);
  };

  const closeForm = () => {
    setFormOpen(false);
    setEditingProjectId(null);
    setFormNotice('');
  };

  const toggleMember = (userId: string) => {
    setForm((prev) => ({
      ...prev,
      memberIds: prev.memberIds.includes(userId)
        ? prev.memberIds.filter((id) => id !== userId)
        : [...prev.memberIds, userId]
    }));
  };

  const addMilestone = () => {
    setForm((prev) => ({
      ...prev,
      milestones: [
        ...prev.milestones,
        { id: `m-${Date.now()}-${prev.milestones.length}`, title: '', dueDate: prev.startDate || '', completed: false }
      ]
    }));
  };

  const updateMilestone = (id: string, field: 'title' | 'dueDate', value: string) => {
    setForm((prev) => ({
      ...prev,
      milestones: prev.milestones.map((m) => (m.id === id ? { ...m, [field]: value } : m))
    }));
  };

  const removeMilestone = (id: string) => {
    setForm((prev) => ({ ...prev, milestones: prev.milestones.filter((m) => m.id !== id) }));
  };

  const handleFileSelect = (fileList: FileList | null) => {
    if (!fileList) return;
    const rejected: string[] = [];
    const accepted: ProjectFile[] = [];

    Array.from(fileList).forEach((file) => {
      const ext = file.name.split('.').pop()?.toLowerCase() || '';
      if (!ALLOWED_FILE_EXTENSIONS.includes(ext)) {
        rejected.push(`${file.name} (type .${ext} not allowed)`);
        return;
      }
      if (file.size > MAX_FILE_SIZE_BYTES) {
        rejected.push(`${file.name} (exceeds 10 MB limit)`);
        return;
      }
      accepted.push({
        id: `f-${Date.now()}-${file.name}`,
        name: file.name,
        size: formatBytes(file.size),
        type: ext.toUpperCase(),
        uploadedBy: currentUser.id,
        uploadedAt: todayStr,
        url: '#'
      });
    });

    setFileError(rejected.length > 0 ? `Rejected: ${rejected.join(', ')}` : '');
    if (accepted.length > 0) {
      setForm((prev) => ({ ...prev, files: [...prev.files, ...accepted] }));
    }
  };

  const removeFile = (id: string) => {
    setForm((prev) => ({ ...prev, files: prev.files.filter((f) => f.id !== id) }));
  };

  const validate = (data: ProjectFormState): Record<string, string> => {
    const errors: Record<string, string> = {};

    if (!data.title.trim()) {
      errors.title = 'Project name is required.';
    } else {
      const duplicateActive = projects.some(
        (p) =>
          p.id !== editingProjectId &&
          p.status === 'Active' &&
          p.title.trim().toLowerCase() === data.title.trim().toLowerCase()
      );
      if (duplicateActive) errors.title = 'An active project with this name already exists.';
    }

    if (!data.description.trim()) {
      errors.description = 'Description is required.';
    } else if (data.description.trim().length < 20) {
      errors.description = 'Description should clearly state purpose, scope, and expected outcome (min 20 characters).';
    }

    if (!data.teamLeadId) errors.teamLeadId = 'A Team Lead must be assigned.';
    if (data.memberIds.length === 0) errors.memberIds = 'At least one project member is required before activation.';
    if (!data.startDate) {
      errors.startDate = 'Start date is required.';
    } else if (formMode === 'create' && data.startDate < todayStr) {
      errors.startDate = "Start date cannot be before today's date.";
    }

    if (!data.targetDate) {
      errors.targetDate = 'Deadline is required.';
    } else if (formMode === 'create' && data.targetDate < todayStr) {
      errors.targetDate = "Deadline cannot be before today's date.";
    } else if (data.startDate && data.targetDate < data.startDate) {
      errors.targetDate = 'Deadline cannot be before the start date.';
    }

    if (data.startDate && data.targetDate) {
      const outOfRange = data.milestones.filter(
        (m) => m.dueDate && (m.dueDate < data.startDate || m.dueDate > data.targetDate)
      );
      if (outOfRange.length > 0) {
        errors.milestones = `Milestone date(s) must fall within the project's start/end dates: ${outOfRange
          .map((m) => m.title || 'Untitled')
          .join(', ')}.`;
      }
    }

    return errors;
  };

  const handleSubmit = async () => {
    if (formSubmitting) return;
    const errors = validate(form);
    setFormErrors(errors);
    if (Object.keys(errors).length > 0) return;

    const data: Partial<Project> = {
      title: form.title.trim(),
      description: form.description.trim(),
      startDate: form.startDate,
      targetDate: form.targetDate,
      priority: form.priority,
      teamLeadId: form.teamLeadId,
      memberIds: form.memberIds,
      milestones: form.milestones,
      files: form.files,
      creationReason: form.creationReason.trim() || undefined
    };

    setFormSubmitting(true);
    setFormNotice('');
    try {
      // Real backend call -- the form only closes once the server confirms the change. On
      // failure the modal stays open with the real error so the user can retry (no fake success).
      const result =
        formMode === 'create'
          ? await createProject(data)
          : editingProjectId
            ? await updateProject(editingProjectId, { ...data, status: form.status })
            : { success: false, message: 'No project selected to update.' };

      if (!result.success) {
        setFormNotice(result.message);
        return;
      }

      setNotice({ type: 'success', message: result.message });
      closeForm();
    } finally {
      setFormSubmitting(false);
    }
  };

  const deleteTarget = projects.find((p) => p.id === deleteTargetId) || null;
  const relatedTasks = deleteTarget ? tasks.filter((t) => t.projectId === deleteTarget.id) : [];
  const selectedProject = projects.find((p) => p.id === selectedProjectId) || null;

  const confirmDelete = async () => {
    if (!deleteTargetId || deleteSubmitting) return;
    setDeleteSubmitting(true);
    try {
      const result = await deleteProject(deleteTargetId);
      setNotice({ type: result.success ? 'success' : 'error', message: result.message });
      if (result.success) setDeleteTargetId(null);
    } finally {
      setDeleteSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-white flex items-center gap-2">
            <FolderKanban className="text-cyan-400" size={24} /> Projects
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">Create, track, and manage every project across the organization.</p>
        </div>
        {canCreate && (
          <button
            onClick={openCreateForm}
            className="px-4 py-2 rounded-xl glass-button-neon font-bold flex items-center gap-1.5 shrink-0"
          >
            <Plus size={16} /> New Project
          </button>
        )}
      </div>

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

      {/* Search + Status Filter */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-900/50 border border-white/10 flex-1">
          <Search size={15} className="text-cyan-400 shrink-0" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by title or code..."
            className="w-full bg-transparent text-sm text-white placeholder-slate-400 focus:outline-none"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          className="px-3 py-2 rounded-xl bg-slate-900/50 border border-white/10 text-sm text-slate-200 focus:outline-none"
        >
          <option value="All">All Statuses</option>
          <option value="Active">Active</option>
          <option value="Pending Approval">Pending Approval</option>
          <option value="Completed">Completed</option>
          <option value="Archived">Archived</option>
        </select>
      </div>

      {/* Project Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {filteredProjects.map((project) => {
          const isOverdue = project.status === 'Active' && project.targetDate < todayStr;
          const teamLead = users.find((u) => u.id === project.teamLeadId);
          const manageable = canManage(project);

          return (
            <ProjectCard
              key={project.id}
              project={project}
              teamLead={teamLead}
              isOverdue={isOverdue}
              manageable={manageable}
              onEdit={() => openEditForm(project)}
              onDelete={() => setDeleteTargetId(project.id)}
              onClick={() => setSelectedProjectId(project.id)}
            />
          );
        })}

        {filteredProjects.length === 0 && (
          <div className="col-span-full text-center text-sm text-slate-400 py-12">
            No projects match your search/filter.
          </div>
        )}
      </div>

      {/* Create / Edit Form (inline) */}
      {formOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-16 p-4 bg-black/70 backdrop-blur-md overflow-y-auto">
          <div className="w-full max-w-xl glass-panel-glow border border-cyan-500/40 shadow-2xl relative">
            <div className="p-4 border-b border-white/10 flex items-center justify-between bg-slate-900/60">
              <h2 className="text-sm font-bold text-white">
                {formMode === 'create' ? 'New Project' : 'Edit Project'}
              </h2>
              <button onClick={closeForm} className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white">
                <X size={16} />
              </button>
            </div>

            <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto text-xs">
              <div>
                <label className="block text-slate-300 font-semibold mb-1">Project Name</label>
                <input
                  type="text"
                  value={form.title}
                  onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg bg-black/40 border border-white/10 text-slate-100 focus:outline-none focus:border-cyan-500/50"
                  placeholder="e.g. Nexus AI Copilot Integration"
                />
                {formErrors.title && <p className="text-rose-400 mt-1">{formErrors.title}</p>}
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">Description</label>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
                  rows={3}
                  className="w-full px-3 py-2 rounded-lg bg-black/40 border border-white/10 text-slate-100 focus:outline-none focus:border-cyan-500/50"
                  placeholder="What is this project about?"
                />
                {formErrors.description && <p className="text-rose-400 mt-1">{formErrors.description}</p>}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Start Date</label>
                  <input
                    type="date"
                    value={form.startDate}
                    onChange={(e) => setForm((prev) => ({ ...prev, startDate: e.target.value }))}
                    min={formMode === 'create' ? todayStr : undefined}
                    className="w-full px-3 py-2 rounded-lg bg-black/40 border border-white/10 text-slate-100 focus:outline-none focus:border-cyan-500/50"
                  />
                  {formErrors.startDate && <p className="text-rose-400 mt-1">{formErrors.startDate}</p>}
                </div>
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Deadline</label>
                  <input
                    type="date"
                    value={form.targetDate}
                    onChange={(e) => setForm((prev) => ({ ...prev, targetDate: e.target.value }))}
                    min={formMode === 'create' ? form.startDate || todayStr : undefined}
                    className="w-full px-3 py-2 rounded-lg bg-black/40 border border-white/10 text-slate-100 focus:outline-none focus:border-cyan-500/50"
                  />
                  {formErrors.targetDate && <p className="text-rose-400 mt-1">{formErrors.targetDate}</p>}
                </div>
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">Priority</label>
                <select
                  value={form.priority}
                  onChange={(e) => setForm((prev) => ({ ...prev, priority: e.target.value as TaskPriority }))}
                  className="w-full px-3 py-2 rounded-lg bg-black/40 border border-white/10 text-slate-100 focus:outline-none focus:border-cyan-500/50"
                >
                  <option value="Low">Low</option>
                  <option value="Medium">Medium</option>
                  <option value="High">High</option>
                  <option value="Urgent">Urgent</option>
                </select>
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">Team Lead</label>
                <select
                  value={form.teamLeadId}
                  onChange={(e) => setForm((prev) => ({ ...prev, teamLeadId: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg bg-black/40 border border-white/10 text-slate-100 focus:outline-none focus:border-cyan-500/50"
                >
                  <option value="">Select a Team Lead...</option>
                  {teamLeads.map((u) => (
                    <option key={u.id} value={u.id}>{u.name}</option>
                  ))}
                </select>
                {formErrors.teamLeadId && <p className="text-rose-400 mt-1">{formErrors.teamLeadId}</p>}
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">Project Members</label>
                <div className="grid grid-cols-2 gap-1.5 max-h-36 overflow-y-auto p-2 rounded-lg bg-black/30 border border-white/10">
                  {assignableMembers.map((u) => (
                    <label key={u.id} className="flex items-center gap-2 text-slate-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={form.memberIds.includes(u.id)}
                        onChange={() => toggleMember(u.id)}
                        className="accent-cyan-500"
                      />
                      {u.name}
                    </label>
                  ))}
                </div>
                {formErrors.memberIds && <p className="text-rose-400 mt-1">{formErrors.memberIds}</p>}
              </div>

              {formMode === 'edit' && (
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Status</label>
                  <select
                    value={form.status}
                    onChange={(e) => setForm((prev) => ({ ...prev, status: e.target.value as ProjectStatus }))}
                    className="w-full px-3 py-2 rounded-lg bg-black/40 border border-white/10 text-slate-100 focus:outline-none focus:border-cyan-500/50"
                  >
                    <option value="Active">Active</option>
                    <option value="Completed">Completed</option>
                    <option value="Archived">Archived</option>
                  </select>
                </div>
              )}

              {/* Milestones */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-slate-300 font-semibold flex items-center gap-1.5">
                    <Target size={12} className="text-cyan-400" /> Milestones{' '}
                    <span className="text-slate-500 font-normal">(optional)</span>
                  </label>
                  <button
                    type="button"
                    onClick={addMilestone}
                    className="text-cyan-400 hover:text-cyan-300 text-[11px] font-semibold flex items-center gap-1"
                  >
                    <Plus size={12} /> Add
                  </button>
                </div>
                <div className="space-y-2">
                  {form.milestones.map((m) => (
                    <div key={m.id} className="flex items-center gap-2">
                      <input
                        type="text"
                        value={m.title}
                        onChange={(e) => updateMilestone(m.id, 'title', e.target.value)}
                        placeholder="Milestone title"
                        className="flex-1 px-2.5 py-1.5 rounded-lg bg-black/40 border border-white/10 text-slate-100 focus:outline-none focus:border-cyan-500/50"
                      />
                      <input
                        type="date"
                        value={m.dueDate}
                        onChange={(e) => updateMilestone(m.id, 'dueDate', e.target.value)}
                        className="px-2.5 py-1.5 rounded-lg bg-black/40 border border-white/10 text-slate-100 focus:outline-none focus:border-cyan-500/50"
                      />
                      <button
                        type="button"
                        onClick={() => removeMilestone(m.id)}
                        className="p-1.5 rounded-lg hover:bg-rose-500/10 text-slate-400 hover:text-rose-400"
                      >
                        <X size={13} />
                      </button>
                    </div>
                  ))}
                </div>
                {formErrors.milestones && <p className="text-rose-400 mt-1">{formErrors.milestones}</p>}
              </div>

              {/* Files */}
              <div>
                <label className="text-slate-300 font-semibold flex items-center gap-1.5 mb-1">
                  <Paperclip size={12} className="text-cyan-400" /> Files{' '}
                  <span className="text-slate-500 font-normal">
                    (optional, max 10 MB, pdf/doc/docx/xlsx/json/fig/png/jpg/zip)
                  </span>
                </label>
                <input
                  type="file"
                  multiple
                  onChange={(e) => handleFileSelect(e.target.files)}
                  className="w-full text-slate-300 file:mr-3 file:px-3 file:py-1.5 file:rounded-lg file:border-0 file:bg-cyan-500/20 file:text-cyan-300 file:text-xs file:font-semibold"
                />
                {fileError && <p className="text-rose-400 mt-1">{fileError}</p>}
                {form.files.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {form.files.map((f) => (
                      <li
                        key={f.id}
                        className="flex items-center justify-between text-slate-300 bg-black/30 border border-white/10 rounded-lg px-2.5 py-1.5"
                      >
                        <span className="truncate">
                          {f.name} <span className="text-slate-500">({f.size})</span>
                        </span>
                        <button
                          type="button"
                          onClick={() => removeFile(f.id)}
                          className="p-1 rounded hover:bg-rose-500/10 text-slate-400 hover:text-rose-400"
                        >
                          <X size={12} />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Creation reason / notes */}
              <div>
                <label className="text-slate-300 font-semibold mb-1 flex items-center gap-1.5">
                  <StickyNote size={12} className="text-cyan-400" /> Creation Reason / Notes{' '}
                  <span className="text-slate-500 font-normal">(recommended for Admin review)</span>
                </label>
                <textarea
                  value={form.creationReason}
                  onChange={(e) => setForm((prev) => ({ ...prev, creationReason: e.target.value }))}
                  rows={2}
                  className="w-full px-3 py-2 rounded-lg bg-black/40 border border-white/10 text-slate-100 focus:outline-none focus:border-cyan-500/50"
                  placeholder="Why is this project being created? Any context for the reviewer?"
                />
              </div>

              {formMode === 'create' && currentRole === 'Team_Lead' && (
                <p className="text-slate-500 flex items-center gap-1.5">
                  <CheckCircle2 size={12} className="text-cyan-400 shrink-0" />
                  This project will be created as Pending Approval until an Admin approves it.
                </p>
              )}

              {formNotice && (
                <div className="flex items-center gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-rose-300">
                  <AlertCircle size={13} className="shrink-0" />
                  {formNotice}
                </div>
              )}
            </div>

            <div className="p-4 border-t border-white/10 flex items-center justify-end gap-2 bg-slate-900/40">
              <button
                onClick={closeForm}
                disabled={formSubmitting}
                className="px-4 py-2 rounded-xl text-xs text-slate-300 hover:text-white hover:bg-white/5 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={formSubmitting}
                className="px-4 py-2 rounded-xl glass-button-neon text-xs font-bold disabled:opacity-60"
              >
                {formSubmitting ? 'Saving...' : formMode === 'create' ? 'Create Project' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation (inline) */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md">
          <div className="w-full max-w-md glass-panel-glow border border-rose-500/40 shadow-2xl p-5 space-y-4">
            <div className="flex items-center gap-2 text-rose-400">
              <AlertTriangle size={18} />
              <h2 className="text-sm font-bold text-white">
                {currentRole === 'Admin' ? `Delete "${deleteTarget.title}"?` : `Request deletion of "${deleteTarget.title}"?`}
              </h2>
            </div>

            {currentRole === 'Admin' ? (
              relatedTasks.length > 0 ? (
                <div className="space-y-2 text-xs">
                  <p className="text-amber-300 font-semibold">
                    This project has {relatedTasks.length} task{relatedTasks.length !== 1 ? 's' : ''} linked to it.
                    The project will be archived (not permanently erased) and its tasks will remain untouched.
                  </p>
                  <ul className="max-h-32 overflow-y-auto space-y-1 pl-1">
                    {relatedTasks.map((t) => (
                      <li key={t.id} className="text-slate-400 flex items-center gap-1.5">
                        <span className="w-1 h-1 rounded-full bg-rose-400 shrink-0" /> {t.taskNumber} — {t.title}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="text-xs text-slate-400">The project will be archived. This cannot be undone from here.</p>
              )
            ) : (
              <p className="text-xs text-slate-400">
                This project will not be deleted immediately. A deletion request will be submitted for Admin approval,
                and the project stays unchanged unless an Admin approves it.
              </p>
            )}

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/10">
              <button
                onClick={() => setDeleteTargetId(null)}
                disabled={deleteSubmitting}
                className="px-4 py-2 rounded-xl text-xs text-slate-300 hover:text-white hover:bg-white/5 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                disabled={deleteSubmitting}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 disabled:opacity-60"
              >
                {deleteSubmitting
                  ? 'Working...'
                  : currentRole === 'Admin'
                    ? 'Delete Project'
                    : 'Request Deletion'}
              </button>
            </div>
          </div>
        </div>
      )}

      <ProjectDetailsDrawer
        project={selectedProject}
        users={users}
        onClose={() => setSelectedProjectId(null)}
      />
    </div>
  );
};
