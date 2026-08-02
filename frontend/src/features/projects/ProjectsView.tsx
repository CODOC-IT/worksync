import React, { useEffect, useState } from 'react';
import { useApp } from '../../store/AppContext';
import { ProjectCard } from './ProjectCard';
import { ProjectDetailsDrawer } from './ProjectDetailsDrawer';
import { Project, ProjectStatus, TaskPriority, Milestone, ProjectFile } from '../../types';
import { todayDateKey } from '../calendar/calendarRules';
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
  AlertCircle,
  ArchiveRestore
} from 'lucide-react';

type StatusFilter = 'All' | ProjectStatus;
// A project's own lead is also always one of its members (see project.mapper.ts's memberIds,
// which includes the TeamLead role), so "Led" and "Assigned" can both match the same project --
// this mirrors that overlap rather than treating the three categories as mutually exclusive.
type CategoryFilter = 'All' | 'Led' | 'Assigned' | 'Unassigned';

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
  const {
    projects, tasks, users, currentRole, currentUser,
    createProject, updateProject, deleteProject, permanentlyDeleteProject, restoreProject, refreshProjectDetails
  } = useApp();

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('All');
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('All');

  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<'create' | 'edit'>('create');
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [form, setForm] = useState<ProjectFormState>(EMPTY_FORM);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [formNotice, setFormNotice] = useState('');

  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);
  // Only shown/required for Team Lead — Admin's direct archive/permanent-delete keeps its old
  // auto-generated reason, matching the unchanged backend behavior for that role.
  const [deleteReason, setDeleteReason] = useState('');
  const [deleteReasonError, setDeleteReasonError] = useState('');

  // Restore confirmation -- mirrors the delete-confirmation state above. Only shown/required for
  // Team Lead; Admin's direct restore stays a single confirm click, matching the unchanged
  // backend behavior for that role.
  const [restoreTargetId, setRestoreTargetId] = useState<string | null>(null);
  const [restoreSubmitting, setRestoreSubmitting] = useState(false);
  const [restoreReason, setRestoreReason] = useState('');
  const [restoreReasonError, setRestoreReasonError] = useState('');

  // "Admin Approval Required" confirmation step for a Team Lead's edit -- shown after the edit
  // form itself validates, before the PROJECT_EDIT approval request is actually sent (mirrors the
  // Archive/Permanent Delete confirmation dialog below). Admin edits skip this entirely and save
  // immediately, exactly as before.
  const [editApprovalOpen, setEditApprovalOpen] = useState(false);
  const [editApprovalData, setEditApprovalData] = useState<Partial<Project> | null>(null);
  const [editApprovalReason, setEditApprovalReason] = useState('');
  const [editApprovalReasonError, setEditApprovalReasonError] = useState('');
  const [editApprovalSubmitting, setEditApprovalSubmitting] = useState(false);
  const [fileError, setFileError] = useState('');
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);

  // The list-loaded `projects` array never carries milestones (see refreshProjectDetails's own
  // comment) -- fetch the real detail whenever the Details popup opens so it reflects backend
  // data instead of an always-empty milestones array.
  useEffect(() => {
    if (selectedProjectId) {
      void refreshProjectDetails(selectedProjectId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProjectId]);

  // Admins must never be selectable as a project's Team Lead or Member, even if upstream
  // user data is ever wrong/inconsistent about role — scoped to this form's two selectors only.
  const nonAdminUsers = users.filter((u) => u.role !== 'Admin');
  // Team Lead dropdown: active Team_Lead or Team_Member users only -- Admin (already excluded via
  // nonAdminUsers) and HR must not appear.
  const teamLeads = nonAdminUsers.filter(
    (u) => (u.role === 'Team_Lead' || u.role === 'Team_Member') && u.status !== 'inactive'
  );
  // Member checklist: same active-account rule as the Team Lead dropdown above -- a deactivated
  // Team_Member must not be checkable here either.
  const assignableMembers = nonAdminUsers.filter((u) => u.role === 'Team_Member' && u.status !== 'inactive');
  // Local-safe "today" -- new Date().toISOString() reports UTC, which reads a full calendar day
  // behind local time for ~5 hours after midnight in Pakistan (UTC+5) and any other
  // positive-offset timezone. See calendarRules.ts's todayDateKey.
  const todayStr = todayDateKey();

  const canCreate = currentRole === 'Team_Member' || currentRole === 'Team_Lead' || currentRole === 'Admin';
  // Matches the backend's per-project lead check (project.service.ts's isProjectLead /
  // resolveTeamLeadUserId) -- Team Lead is not a separate account role; a Team_Member becomes a
  // project's lead only via this project-specific assignment. Every permission decision below
  // must go through this (or an explicit currentRole === 'Admin' check), never a bare
  // currentRole !== 'Admin' -- that's true for a normal Team_Member too.
  const isProjectLead = (project: Project) => project.teamLeadId === currentUser.id;
  const canManage = (project: Project) =>
    currentRole === 'Admin' || (currentRole !== 'HR' && isProjectLead(project));

  // Every role sees every project now (matches the backend's listProjectsForUser) -- Team Lead
  // isn't a separate account role, so hiding "unassigned" projects from every Team_Member made
  // them invisible to whoever wasn't already on that specific project, including its own would-be
  // lead before they'd been assigned. The categoryFilter below distinguishes a user's own
  // led/assigned/unassigned projects instead of hiding any of them.
  const visibleProjects = projects;

  const filteredProjects = visibleProjects.filter((p) => {
    const q = searchQuery.trim().toLowerCase();
    const matchesSearch = !q || p.title.toLowerCase().includes(q) || p.code.toLowerCase().includes(q);
    const matchesStatus = statusFilter === 'All' || p.status === statusFilter;
    const matchesCategory =
      categoryFilter === 'All' ||
      (categoryFilter === 'Led' && p.teamLeadId === currentUser.id) ||
      (categoryFilter === 'Assigned' && p.memberIds.includes(currentUser.id)) ||
      (categoryFilter === 'Unassigned' && !p.memberIds.includes(currentUser.id));
    return matchesSearch && matchesStatus && matchesCategory;
  });

  const openCreateForm = () => {
    setFormMode('create');
    setEditingProjectId(null);
    setForm({
      ...EMPTY_FORM,
      // A member creating a project becomes its project-scoped lead once it is approved.
      teamLeadId: currentRole !== 'Admin' ? currentUser.id : ''
    });
    setFormErrors({});
    setFileError('');
    setFormOpen(true);
  };

  const openEditForm = async (project: Project) => {
    setFormMode('edit');
    setEditingProjectId(project.id);
    setFormErrors({});
    setFileError('');
    // `project` here is whatever ProjectCard was rendering, i.e. the list-cached snapshot that
    // never carries milestones (see refreshProjectDetails's comment). Fetch the real detail first
    // so the edit form opens with the project's actual current milestones, not an empty list.
    const fresh = await refreshProjectDetails(project.id);
    const source = fresh || project;
    setForm({
      title: source.title,
      description: source.description,
      startDate: source.startDate,
      targetDate: source.targetDate,
      priority: source.priority || 'Medium',
      teamLeadId: source.teamLeadId,
      memberIds: source.memberIds,
      status: source.status === 'Pending Approval' ? 'Active' : source.status,
      creationReason: source.creationReason || '',
      milestones: source.milestones,
      files: source.files
    });
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

  // Reads real content as a base64 data URL (same convention already used for Project Chat
  // attachments -- see fileStorage.ts / discussion.repository.ts's upsertStoredFile), instead of
  // only recording the file's name/size with a fake `url: '#'` placeholder. The backend persists
  // these bytes for real and rejects anything with no readable content.
  const handleFileSelect = async (fileList: FileList | null) => {
    if (!fileList) return;
    const rejected: string[] = [];
    const candidates: File[] = [];

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
      candidates.push(file);
    });

    setFileError(rejected.length > 0 ? `Rejected: ${rejected.join(', ')}` : '');
    if (candidates.length === 0) return;

    const accepted: ProjectFile[] = await Promise.all(
      candidates.map(
        (file) =>
          new Promise<ProjectFile>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () =>
              resolve({
                id: `f-${Date.now()}-${file.name}`,
                name: file.name,
                size: file.size,
                mimeType: file.type || 'application/octet-stream',
                uploadedBy: currentUser.id,
                uploadedAt: todayStr,
                dataUrl: reader.result as string
              });
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(file);
          })
      )
    );

    setForm((prev) => ({ ...prev, files: [...prev.files, ...accepted] }));
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
    } else if (data.targetDate < todayStr) {
      errors.targetDate = "Deadline cannot be before today's date.";
    } else if (data.startDate && data.targetDate < data.startDate) {
      errors.targetDate = 'Deadline cannot be before the start date.';
    }

    if (data.startDate && data.targetDate) {
      const violations = data.milestones
        .filter((m) => m.dueDate)
        .map((m) => {
          const label = m.title || 'Untitled';
          if (m.dueDate < data.startDate) {
            return `"${label}" is before the project start date (${data.startDate})`;
          }
          if (m.dueDate > data.targetDate) {
            return `"${label}" is after the project end date (${data.targetDate})`;
          }
          return null;
        })
        .filter((message): message is string => Boolean(message));
      if (violations.length > 0) {
        errors.milestones = `Milestone dates must fall within the project's start/end dates: ${violations.join('; ')}.`;
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

    // A Team Lead's edit doesn't apply immediately -- it becomes a PROJECT_EDIT approval
    // request. Instead of saving straight away, hand off to the "Admin Approval Required"
    // dialog below, which collects the required reason and sends the request; the edit form
    // stays open underneath in case they cancel and want to adjust anything. Explicitly checked
    // against isProjectLead here (not just "not Admin") so this logic is correct on its own,
    // rather than depending on the Edit button already having been hidden from a normal member by
    // canManage elsewhere -- a normal Team_Member is a non-admin too, and must get neither a
    // direct save nor an approval request.
    if (formMode === 'edit' && editingProjectId) {
      const editingProject = projects.find((p) => p.id === editingProjectId);
      if (currentRole !== 'Admin') {
        if (!editingProject || !isProjectLead(editingProject)) {
          setFormNotice('You do not have permission to edit this project.');
          return;
        }
        setEditApprovalData({ ...data, status: form.status });
        setEditApprovalReason('');
        setEditApprovalReasonError('');
        setEditApprovalOpen(true);
        return;
      }
    }

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

  const closeEditApproval = () => {
    if (editApprovalSubmitting) return;
    setEditApprovalOpen(false);
    setEditApprovalData(null);
    setEditApprovalReason('');
    setEditApprovalReasonError('');
  };

  // Sends the PROJECT_EDIT approval request created by the dialog below. The project itself is
  // never touched here -- backend/src/projects/project.controller.ts routes this Team Lead call
  // to projectApproval.service.ts's createApprovalRequest instead of project.service.ts's
  // updateProject, so nothing changes until an Admin approves it.
  const sendEditApprovalRequest = async () => {
    if (!editingProjectId || !editApprovalData || editApprovalSubmitting) return;
    if (!editApprovalReason.trim()) {
      setEditApprovalReasonError('A reason is required so the Admin can review your edit request.');
      return;
    }
    setEditApprovalReasonError('');
    setEditApprovalSubmitting(true);
    try {
      const result = await updateProject(editingProjectId, editApprovalData, editApprovalReason.trim());
      setNotice({ type: result.success ? 'success' : 'error', message: result.message });
      if (result.success) {
        setEditApprovalOpen(false);
        setEditApprovalData(null);
        setEditApprovalReason('');
        setEditApprovalReasonError('');
        closeForm();
      }
    } finally {
      setEditApprovalSubmitting(false);
    }
  };

  const openRestoreConfirm = (projectId: string) => {
    setRestoreTargetId(projectId);
    setRestoreReason('');
    setRestoreReasonError('');
  };

  const closeRestoreConfirm = () => {
    if (restoreSubmitting) return;
    setRestoreTargetId(null);
    setRestoreReason('');
    setRestoreReasonError('');
  };

  const confirmRestore = async () => {
    if (!restoreTargetId || restoreSubmitting) return;
    // A Team Lead's restore doesn't apply immediately -- it becomes a PROJECT_RESTORE approval
    // request, and the backend requires a non-empty reason to create one. Admin's restore stays a
    // single confirm click, unchanged. Explicitly checked against isProjectLead here (not just
    // "not Admin") so this logic is correct on its own, rather than depending on the Restore
    // button already having been hidden from a normal member by canManage elsewhere -- a normal
    // Team_Member is a non-admin too, and must get no action here at all.
    if (currentRole !== 'Admin') {
      const target = projects.find((p) => p.id === restoreTargetId);
      if (!target || !isProjectLead(target)) {
        setRestoreReasonError('You do not have permission to perform this action.');
        return;
      }
      if (!restoreReason.trim()) {
        setRestoreReasonError('A reason is required so the Admin can review your request.');
        return;
      }
    }
    setRestoreReasonError('');
    setRestoreSubmitting(true);
    try {
      const result = await restoreProject(restoreTargetId, restoreReason.trim() || undefined);
      setNotice({ type: result.success ? 'success' : 'error', message: result.message });
      if (result.success) closeRestoreConfirm();
    } finally {
      setRestoreSubmitting(false);
    }
  };

  const editingProject = editingProjectId ? projects.find((p) => p.id === editingProjectId) || null : null;
  // Mirrors the backend gate in project.service.ts's updateProject: Completed requires at least
  // one task and every task Done. Only checked for the transition INTO Completed -- a project
  // already Completed keeps showing/selecting that status normally even if a task was added or
  // reopened afterward, matching how the backend only gates the transition, not a no-op resave.
  const editingProjectTasks = editingProjectId ? tasks.filter((t) => t.projectId === editingProjectId) : [];
  const editingProjectCanComplete =
    editingProject?.status === 'Completed' ||
    (editingProjectTasks.length > 0 && editingProjectTasks.every((t) => t.status === 'Done'));
  const restoreTarget = projects.find((p) => p.id === restoreTargetId) || null;
  const deleteTarget = projects.find((p) => p.id === deleteTargetId) || null;
  const relatedTasks = deleteTarget ? tasks.filter((t) => t.projectId === deleteTarget.id) : [];
  const selectedProject = projects.find((p) => p.id === selectedProjectId) || null;

  const openDeleteConfirm = (projectId: string) => {
    setDeleteTargetId(projectId);
    setDeleteReason('');
    setDeleteReasonError('');
  };

  const closeDeleteConfirm = () => {
    setDeleteTargetId(null);
    setDeleteReason('');
    setDeleteReasonError('');
  };

  const confirmDelete = async () => {
    if (!deleteTargetId || deleteSubmitting) return;
    // A Team Lead's delete/permanent-delete doesn't apply immediately -- it becomes a
    // PROJECT_ARCHIVE/PROJECT_PERMANENT_DELETE approval request, and the backend requires a
    // non-empty reason to create one. Admin keeps the previous auto-generated reason. Explicitly
    // checked against isProjectLead here (not just "not Admin") so this logic is correct on its
    // own, rather than depending on the Delete/Archive button already having been hidden from a
    // normal member by canManage elsewhere -- a normal Team_Member is a non-admin too, and must
    // get no action here at all.
    if (currentRole !== 'Admin') {
      const target = projects.find((p) => p.id === deleteTargetId);
      if (!target || !isProjectLead(target)) {
        setDeleteReasonError('You do not have permission to perform this action.');
        return;
      }
      if (!deleteReason.trim()) {
        setDeleteReasonError('A reason is required so the Admin can review your request.');
        return;
      }
    }
    setDeleteReasonError('');
    setDeleteSubmitting(true);
    try {
      // Two-step delete: an already-Archived project's delete button means "permanently delete"
      // instead of "archive" -- everything else about the button/modal is unchanged.
      const result =
        deleteTarget?.status === 'Archived'
          ? await permanentlyDeleteProject(deleteTargetId, deleteReason.trim() || undefined)
          : await deleteProject(deleteTargetId, deleteReason.trim() || undefined);
      setNotice({ type: result.success ? 'success' : 'error', message: result.message });
      if (result.success) closeDeleteConfirm();
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
        {/* Meaningful only for accounts that can actually be a project's lead/member -- Admin/HR
            are never assignable to a project (see nonAdminUsers above), so "Led"/"Assigned" would
            always be empty and "Unassigned" would always equal "All" for them. "Led by Me" is
            shown only for currentRole === 'Team_Lead' -- Team Lead is still not a separate
            account entity (isProjectLead above stays the same per-project
            teamLeadId === currentUser.id check for both roles; a Team_Member remains eligible to
            be assigned as a project's lead, see PROJECT_LEAD_ELIGIBLE_ROLES on the backend), this
            only limits which role sees the extra option in the dropdown itself. */}
        {(currentRole === 'Team_Lead' || currentRole === 'Team_Member') && (
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value as CategoryFilter)}
            className="px-3 py-2 rounded-xl bg-slate-900/50 border border-white/10 text-sm text-slate-200 focus:outline-none"
          >
            <option value="All">All Projects</option>
            {currentRole === 'Team_Lead' && <option value="Led">Led by Me</option>}
            <option value="Assigned">Assigned to Me</option>
            <option value="Unassigned">Not Assigned</option>
          </select>
        )}
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
              currentUserId={currentUser.id}
              currentRole={currentRole}
              onEdit={() => openEditForm(project)}
              onDelete={() => openDeleteConfirm(project.id)}
              onRestore={() => openRestoreConfirm(project.id)}
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
                    min={todayStr}
                    // The original creation start date is fixed once a project exists -- only
                    // Deadline/other fields remain editable, matching Team Lead's own
                    // create-only-editable pattern just below.
                    disabled={formMode === 'edit'}
                    className="w-full px-3 py-2 rounded-lg bg-black/40 border border-white/10 text-slate-100 focus:outline-none focus:border-cyan-500/50 disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                  {formErrors.startDate && <p className="text-rose-400 mt-1">{formErrors.startDate}</p>}
                </div>
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Deadline</label>
                  <input
                    type="date"
                    value={form.targetDate}
                    onChange={(e) => setForm((prev) => ({ ...prev, targetDate: e.target.value }))}
                    min={form.startDate || todayStr}
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
                  // A project's lead can edit their own project but must not reassign its Team
                  // Lead; only Admins are allowed to change this field once a project exists.
                  disabled={
                    formMode === 'edit' &&
                    currentRole !== 'Admin' &&
                    (!editingProject || isProjectLead(editingProject))
                  }
                  className="w-full px-3 py-2 rounded-lg bg-black/40 border border-white/10 text-slate-100 focus:outline-none focus:border-cyan-500/50 disabled:opacity-50 disabled:cursor-not-allowed"
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
                    <option value="Completed" disabled={!editingProjectCanComplete}>
                      Completed
                    </option>
                  </select>
                  {!editingProjectCanComplete && (
                    <p className="text-slate-500 mt-1">
                      {editingProjectTasks.length === 0
                        ? 'Add at least one task before this project can be marked Completed.'
                        : 'Every task must be completed before this project can be marked Completed.'}
                    </p>
                  )}
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
                        min={form.startDate || undefined}
                        max={form.targetDate || undefined}
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
                  onChange={(e) => void handleFileSelect(e.target.files)}
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
                          {f.name} <span className="text-slate-500">({formatBytes(f.size)})</span>
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

              {/* Creation reason / notes -- a plain project-level note, independent of the
                  PROJECT_EDIT approval request's own required reason (captured in the "Admin
                  Approval Required" dialog below for a Team Lead's edit). */}
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

              {/* No project exists yet at creation time, so there's no per-project lead to check
                  against -- this must match project.service.ts's own condition for who gets
                  PendingActivation (`actorRole === 'Admin' ? 'Active' : 'PendingActivation'`),
                  i.e. anyone who isn't Admin, not just accounts literally role 'Team_Lead'. */}
              {formMode === 'create' && currentRole !== 'Admin' && (
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

      {/* Admin Approval Required (Team Lead edit) */}
      {editApprovalOpen && editApprovalData && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/70 backdrop-blur-md">
          <div className="w-full max-w-md glass-panel-glow border border-amber-500/40 shadow-2xl p-5 space-y-4">
            <div className="flex items-center gap-2 text-amber-400">
              <AlertTriangle size={18} />
              <h2 className="text-sm font-bold text-white">Admin Approval Required</h2>
            </div>

            <p className="text-xs text-slate-400">
              Editing "{form.title || 'this project'}" requires Admin approval. Your changes will not be applied
              to the project until an Admin reviews and approves this request.
            </p>

            <div>
              <label className="block text-xs text-slate-300 font-semibold mb-1">
                Reason <span className="text-slate-500 font-normal">(required for Admin approval)</span>
              </label>
              <textarea
                value={editApprovalReason}
                onChange={(e) => {
                  setEditApprovalReason(e.target.value);
                  if (e.target.value.trim()) setEditApprovalReasonError('');
                }}
                rows={3}
                autoFocus
                className="w-full px-3 py-2 rounded-lg bg-black/40 border border-white/10 text-xs text-slate-100 focus:outline-none focus:border-cyan-500/50"
                placeholder="Why are these changes needed? Any context for the Admin?"
              />
              {editApprovalReasonError && <p className="text-rose-400 text-xs mt-1">{editApprovalReasonError}</p>}
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/10">
              <button
                onClick={closeEditApproval}
                disabled={editApprovalSubmitting}
                className="px-4 py-2 rounded-xl text-xs text-slate-300 hover:text-white hover:bg-white/5 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={sendEditApprovalRequest}
                disabled={editApprovalSubmitting}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {editApprovalSubmitting ? 'Sending...' : 'Send Request'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Restore Confirmation (inline) */}
      {restoreTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md">
          <div className="w-full max-w-md glass-panel-glow border border-emerald-500/40 shadow-2xl p-5 space-y-4">
            <div className="flex items-center gap-2 text-emerald-400">
              <ArchiveRestore size={18} />
              <h2 className="text-sm font-bold text-white">
                {currentRole === 'Admin'
                  ? `Restore "${restoreTarget.title}"?`
                  : `Request restoration of "${restoreTarget.title}"?`}
              </h2>
            </div>

            <p className="text-xs text-slate-400">
              {currentRole === 'Admin'
                ? 'This project and its related tasks will be restored from Archives and become Active again.'
                : 'Restoring this project requires Admin approval. This will submit a request; the project stays archived unless an Admin approves it.'}
            </p>

            {currentRole !== 'Admin' && isProjectLead(restoreTarget) && (
              <div>
                <label className="block text-xs text-slate-300 font-semibold mb-1">
                  Reason <span className="text-slate-500 font-normal">(required for Admin approval)</span>
                </label>
                <textarea
                  value={restoreReason}
                  onChange={(e) => {
                    setRestoreReason(e.target.value);
                    if (e.target.value.trim()) setRestoreReasonError('');
                  }}
                  rows={2}
                  className="w-full px-3 py-2 rounded-lg bg-black/40 border border-white/10 text-xs text-slate-100 focus:outline-none focus:border-cyan-500/50"
                  placeholder="Why is this needed? Any context for the Admin?"
                />
                {restoreReasonError && <p className="text-rose-400 text-xs mt-1">{restoreReasonError}</p>}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/10">
              <button
                onClick={closeRestoreConfirm}
                disabled={restoreSubmitting}
                className="px-4 py-2 rounded-xl text-xs text-slate-300 hover:text-white hover:bg-white/5 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={confirmRestore}
                disabled={restoreSubmitting}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {restoreSubmitting
                  ? 'Working...'
                  : currentRole === 'Admin' ? 'Restore Project' : 'Send Request'}
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
                {deleteTarget.status === 'Archived'
                  ? currentRole === 'Admin'
                    ? `Permanently delete "${deleteTarget.title}"?`
                    : `Request permanent deletion of "${deleteTarget.title}"?`
                  : currentRole === 'Admin'
                    ? `Delete "${deleteTarget.title}"?`
                    : `Request deletion of "${deleteTarget.title}"?`}
              </h2>
            </div>

            {deleteTarget.status === 'Archived' ? (
              currentRole === 'Admin' ? (
                <p className="text-xs text-slate-400">
                  This project and all of its related tasks and subtasks will be permanently deleted. This action
                  cannot be undone. Are you sure you want to continue?
                </p>
              ) : (
                <p className="text-xs text-slate-400">
                  Permanently deleting this project requires Admin approval. This will submit a request to delete
                  it and its related tasks and subtasks; everything stays unchanged unless an Admin approves it.
                </p>
              )
            ) : currentRole === 'Admin' ? (
              relatedTasks.length > 0 ? (
                <div className="space-y-2 text-xs">
                  <p className="text-amber-300 font-semibold">
                    This project has {relatedTasks.length} task{relatedTasks.length !== 1 ? 's' : ''} linked to it.
                    The project and linked tasks are archived. They become read-only. They appear under Archived
                    Tasks until the project is restored.
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
                <p className="text-xs text-slate-400">
                  The project will be archived and can be restored later from the Archived projects view.
                </p>
              )
            ) : (
              <p className="text-xs text-slate-400">
                Archiving this project requires Admin approval. This will submit a request; the project stays
                unchanged unless an Admin approves it.
              </p>
            )}

            {currentRole !== 'Admin' && isProjectLead(deleteTarget) && (
              <div>
                <label className="block text-xs text-slate-300 font-semibold mb-1">
                  Reason <span className="text-slate-500 font-normal">(required for Admin approval)</span>
                </label>
                <textarea
                  value={deleteReason}
                  onChange={(e) => setDeleteReason(e.target.value)}
                  rows={2}
                  className="w-full px-3 py-2 rounded-lg bg-black/40 border border-white/10 text-xs text-slate-100 focus:outline-none focus:border-cyan-500/50"
                  placeholder="Why is this needed? Any context for the Admin?"
                />
                {deleteReasonError && <p className="text-rose-400 text-xs mt-1">{deleteReasonError}</p>}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/10">
              <button
                onClick={closeDeleteConfirm}
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
                  ? currentRole === 'Admin' ? 'Working...' : 'Sending...'
                  : deleteTarget.status === 'Archived'
                    ? currentRole === 'Admin'
                      ? 'Yes, Permanently Delete'
                      : 'Send Request'
                    : currentRole === 'Admin'
                      ? 'Delete Project'
                      : 'Send Request'}
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
