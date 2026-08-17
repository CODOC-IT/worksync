import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  ArchiveRestore,
  Check,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Eye,
  FolderKanban,
  LogOut,
  Pencil,
  Plus,
  Trash2,
  Search,
  CalendarDays,
  User as UserIcon,
  X,
  XCircle
  ,Settings2
} from 'lucide-react';
import { useApp } from '../../store/AppContext';
import { StatusBadge } from '../../components/common/StatusBadge';
import { AccountChangeRequest, HRRequest, Project, ProjectApprovalRequest, ProjectApprovalRequestType, SystemApproval, Task, User } from '../../types';
import { newestProjectRequestsFirst } from '../projects/projectApprovalRules';
import { formatProjectChangeValue, projectEditChanges } from '../projects/projectApprovalDisplay';
import { TeamBuilder } from '../projects/TeamBuilder';
import { DraftTeam, validateTeamSetup } from '../projects/teamBuilderRules';

// Account Change Requests -- HR/Lead/Member request a single-field change to their own account
// (name, email, username, password). Rendered with friendly labels; requested passwords are never
// displayed -- only "Password change requested".
const ACCOUNT_FIELD_LABELS: Record<string, string> = {
  name: 'Display Name',
  email: 'Email',
  username: 'Username',
  password: 'Password',
};

function getAccountRequestedChanges(request: AccountChangeRequest): { field: string; value?: string }[] {
  const list: { field: string; value?: string }[] = [];
  if (request.passwordChangeRequested) {
    list.push({ field: 'password' });
  }
  for (const [field, value] of Object.entries(request.requestedChanges || {})) {
    if (field === 'password_hash' || field === 'password' || field === 'current_password_verified') continue;
    list.push({ field, value });
  }
  return list;
}

const accountCurrentValue = (user: User | undefined, field: string): string => {
  if (field === 'password') return 'Hidden for security';
  if (!user) return 'Not available';
  if (field === 'name') return user.name || 'Not set';
  if (field === 'email') return user.email || 'Not set';
  if (field === 'username') return user.username || 'Not set';
  return 'Not available';
};

const RequesterMeta: React.FC<{ name: string; id: string; submittedAt: string }> = ({ name, id, submittedAt }) => (
  <div className="min-w-0">
    <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
      <p className="break-words text-base font-semibold text-slate-100">{name}</p>
      <span className="font-mono text-[10px] text-slate-500">{id}</span>
    </div>
    <p className="mt-1 text-xs text-slate-500">Submitted {submittedAt}</p>
  </div>
);

const ReasonBlock: React.FC<{ children: React.ReactNode; label?: string }> = ({ children, label = 'Request reason' }) => (
  <div className="rounded-lg border border-white/5 bg-black/15 p-3">
    <span className="block text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">{label}</span>
    <div className="mt-1.5 break-words whitespace-pre-wrap text-xs leading-5 text-slate-300">{children}</div>
  </div>
);

// Project Management Approval Workflow (Team Lead -> Admin) -- rendered as its own section
// below, separate from the legacy SystemApproval cards. See AppContext's projectApprovalRequests
// / approveProjectApprovalRequest / rejectProjectApprovalRequest, backed by
// backend/src/projects/projectApproval.*.
const PROJECT_REQUEST_TYPE_META: Record<
  ProjectApprovalRequestType,
  { label: string; icon: React.ReactNode; description?: string; className: string }
> = {
  PROJECT_CREATE: { label: 'Project Creation', icon: <FolderKanban size={13} />, className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' },
  TASK_CREATE: { label: 'Task Creation', icon: <Plus size={13} />, className: 'border-violet-500/30 bg-violet-500/10 text-violet-200' },
  PROJECT_EDIT: { label: 'Project Edit', icon: <Pencil size={13} />, className: 'border-sky-500/30 bg-sky-500/10 text-sky-300' },
  PROJECT_ARCHIVE: { label: 'Archive Project', icon: <Archive size={13} />, className: 'border-amber-500/30 bg-amber-500/10 text-amber-300' },
  PROJECT_RESTORE: { label: 'Restore Project', icon: <ArchiveRestore size={13} />, className: 'border-teal-500/30 bg-teal-500/10 text-teal-300' },
  PROJECT_DELETE: {
    label: 'Project Delete',
    icon: <Trash2 size={13} />,
    description: 'Remove this project from active work while keeping it recoverable.',
    className: 'border-rose-500/30 bg-rose-500/10 text-rose-300'
  },
  PROJECT_PERMANENT_DELETE: { label: 'Permanent Delete', icon: <Trash2 size={13} />, className: 'border-rose-500/40 bg-rose-500/15 text-rose-200' }
};

type StatusFilter = 'Pending' | 'Approved' | 'Rejected' | 'All';
type ApprovalCategory = 'All' | 'Attendance' | 'Projects' | 'Account';
type ReviewTarget =
  | { kind: 'system'; action: 'approve' | 'reject'; item: SystemApproval }
  | { kind: 'hr'; action: 'approve' | 'reject'; item: HRRequest }
  | { kind: 'project'; action: 'approve' | 'reject'; item: ProjectApprovalRequest };

const TYPE_META: Record<
  SystemApproval['type'],
  { label: string; icon: React.ReactNode }
> = {
  Project_Creation: {
    label: 'Project Creation',
    icon: <FolderKanban size={13} />
  },
  Project_Deletion: {
    label: 'Project Deletion',
    icon: <Trash2 size={13} />
  },
  Task_Creation: {
    label: 'Task Creation',
    icon: <Plus size={13} />
  },
  Controlled_Edit: {
    label: 'Controlled Edit',
    icon: <Pencil size={13} />
  }
};

const getApprovalProject = (
  approval: SystemApproval,
  projects: Project[],
  tasks: Task[]
): Project | undefined => {
  if (
    approval.type === 'Project_Creation' ||
    approval.type === 'Project_Deletion'
  ) {
    return projects.find((project) => project.id === approval.targetId);
  }

  if (approval.type === 'Task_Creation' && approval.projectId) {
    return projects.find((project) => project.id === approval.projectId);
  }

  if (approval.type === 'Controlled_Edit' && approval.proposedTaskUpdate && approval.projectId) {
    return projects.find((project) => project.id === approval.projectId);
  }

  const task = tasks.find((item) =>
    item.id === approval.targetId ||
    item.subtasks.some((subtask) => subtask.id === approval.targetId)
  );

  return task
    ? projects.find((project) => project.id === task.projectId)
    : undefined;
};

const canDecide = (
  role: 'Admin' | 'Team_Lead',
  userId: string,
  approval: SystemApproval,
  project: Project | undefined
): boolean => {
  if (approval.requestedBy === userId) {
    return false;
  }

  if (
    approval.type === 'Project_Creation' ||
    approval.type === 'Project_Deletion'
  ) {
    return role === 'Admin';
  }

  if (approval.type === 'Task_Creation') {
    return Boolean(
      role === 'Team_Lead' &&
      project &&
      project.teamLeadId === userId
    );
  }

  if (approval.type === 'Controlled_Edit') {
    if (approval.proposedTaskUpdate) {
      return Boolean(
        role === 'Team_Lead' &&
        project &&
        project.teamLeadId === userId
      );
    }
    return Boolean(
      role === 'Admin' ||
      (role === 'Team_Lead' &&
        project &&
        project.teamLeadId === userId)
    );
  }

  return false;
};

export const ApprovalsInboxView: React.FC<{ onViewProject?: (projectId: string) => void }> = ({ onViewProject }) => {
  const {
    currentRole,
    currentUser,
    projects,
    tasks,
    users,
    systemApprovals,
    hrRequests,
    accountChangeRequests,
    projectApprovalRequests,
    approveApprovalItem,
    rejectApprovalItem,
    approveHRRequest,
    rejectHRRequest,
    approveProjectApprovalRequest,
    rejectProjectApprovalRequest,
    updateApprovalSetup,
    approveAccountChangeRequest,
    rejectAccountChangeRequest
  } = useApp();

  const [statusFilter, setStatusFilter] =
    useState<StatusFilter>('Pending');
  const [categoryFilter, setCategoryFilter] = useState<ApprovalCategory>('All');
  const [requesterSearch, setRequesterSearch] = useState('');
  const [submittedDate, setSubmittedDate] = useState('');


  const [notice, setNotice] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);
  const [reviewingAccountRequestId, setReviewingAccountRequestId] = useState<string | null>(null);
  const [rejectingAccountRequest, setRejectingAccountRequest] = useState<AccountChangeRequest | null>(null);
  const [accountRejectionReason, setAccountRejectionReason] = useState('');
  const [accountRejectionError, setAccountRejectionError] = useState('');
  const [reviewTarget, setReviewTarget] = useState<ReviewTarget | null>(null);
  const [reviewReason, setReviewReason] = useState('');
  const [reviewError, setReviewError] = useState('');
  const [reviewLoading, setReviewLoading] = useState(false);
  const [setupTarget, setSetupTarget] = useState<ProjectApprovalRequest | null>(null);
  const [setupDraft, setSetupDraft] = useState<Record<string, any>>({});
  const [setupLoading, setSetupLoading] = useState(false);
  const [setupTeamsError, setSetupTeamsError] = useState('');

  // Same eligibility filtering as ProjectsView.tsx's create form (Admin/HR and inactive accounts
  // never appear as Team Lead or Member candidates -- req. 1A/5), reused here so Admin's Change
  // Setup team editor can't offer an ineligible pick either.
  const nonAdminUsers = users.filter((u) => u.role !== 'Admin');
  const setupTeamLeads = nonAdminUsers.filter(
    (u) => (u.role === 'Team_Lead' || u.role === 'Team_Member') && u.status !== 'inactive'
  );
  const setupAssignableMembers = nonAdminUsers.filter((u) => u.role === 'Team_Member' && u.status !== 'inactive');

  const isSystemApprovalRole =
    currentRole === 'Admin' || currentRole === 'Team_Lead';

  const isHR = currentRole === 'HR';

  const matchesRequesterAndDate = (requesterId: string | undefined, submittedAt: string | undefined) => {
    const requester = users.find((user) => user.id === requesterId);
    const query = requesterSearch.trim().toLowerCase();
    const matchesRequester = !query || Boolean(requester && (
      requester.name.toLowerCase().includes(query) ||
      requester.username?.toLowerCase().includes(query) ||
      requester.email.toLowerCase().includes(query)
    ));
    return matchesRequester && (!submittedDate || submittedAt?.slice(0, 10) === submittedDate);
  };

  const newestFirst = <T extends { submittedAt?: string; createdAt?: string }>(items: T[]): T[] =>
    [...items].sort((left, right) =>
      new Date(right.submittedAt || right.createdAt || 0).getTime() -
      new Date(left.submittedAt || left.createdAt || 0).getTime()
    );

  const visibleApprovals = useMemo(() => {
    if (!isSystemApprovalRole) {
      return [];
    }

    return systemApprovals.filter((approval) => {
      if (approval.type === 'Task_Creation' || approval.type === 'Controlled_Edit') {
        return false;
      }
      const project = getApprovalProject(
        approval,
        projects,
        tasks
      );

      const isDecidable = canDecide(
        currentRole as 'Admin' | 'Team_Lead',
        currentUser.id,
        approval,
        project
      );

      const isOwnRequest =
        !approval.proposedTaskUpdate &&
        approval.requestedBy === currentUser.id;

      return isDecidable || isOwnRequest;
    });
  }, [
    systemApprovals,
    projects,
    tasks,
    currentRole,
    currentUser.id,
    isSystemApprovalRole
  ]);

  const filteredApprovals = newestFirst(visibleApprovals.filter(
    (approval) => {
      const matchesStatus =
        statusFilter === 'All' ||
        approval.status === statusFilter;

      return matchesStatus &&
        (categoryFilter === 'All' || categoryFilter === 'Projects') &&
        matchesRequesterAndDate(approval.requestedBy, approval.createdAt);
    }
  ));

  const reviewableHRRequests = hrRequests.filter((request) => {
    if (request.userId === currentUser.id) return false;
    if (currentRole === 'HR') {
      return request.approvalStage === 'HR';
    }
    if (currentRole === 'Admin') {
      return request.approvalStage === 'Admin';
    }
    return false;
  });

  const filteredHRRequests = newestFirst(reviewableHRRequests.filter(
    (request) =>
      (categoryFilter === 'All' || categoryFilter === 'Attendance') &&
      (statusFilter === 'All' || request.status === statusFilter) &&
      matchesRequesterAndDate(request.userId, request.submittedAt)
  ));

  const pendingSystemCount = visibleApprovals.filter(
    (approval) => approval.status === 'Pending'
  ).length;

  const pendingHRCount = reviewableHRRequests.filter(
    (request) => request.status === 'Pending'
  ).length;

  // Admin sees every request here (fetched pre-scoped to Pending by AppContext); a Team Lead
  // sees only their own submitted requests (any status), fetched the same way -- so no further
  // client-side visibility filtering is needed here, unlike systemApprovals above.
  const filteredProjectApprovalRequests = projectApprovalRequests.filter(
    (request) =>
      statusFilter === 'All' || request.status === statusFilter
  );
  const orderedProjectApprovalRequests = newestProjectRequestsFirst(
    filteredProjectApprovalRequests.filter((request) =>
      (categoryFilter === 'All' || categoryFilter === 'Projects') && matchesRequesterAndDate(request.requestedByUserId, request.createdAt)
    )
  );
  const pendingProjectApprovalCount = projectApprovalRequests.filter(
    (request) => request.status === 'Pending'
  ).length;

  const reviewableAccountChangeRequests = accountChangeRequests.filter((request) => {
    if (request.userId === currentUser.id) return false;
    if (currentRole === 'Admin') {
      return request.assignedApproverRole === 'Admin';
    }
    if (currentRole === 'HR') {
      return request.assignedApproverRole === 'HR';
    }
    return false;
  });

  const filteredAccountChangeRequests = newestFirst(reviewableAccountChangeRequests.filter(
    (request) => (categoryFilter === 'All' || categoryFilter === 'Account') &&
      (statusFilter === 'All' || request.status === statusFilter) &&
      matchesRequesterAndDate(request.userId, request.submittedAt)
  ));

  const pendingAccountChangeCount = reviewableAccountChangeRequests.filter(
    (request) => request.status === 'Pending'
  ).length;

  const handleApprove = async (
    approval: SystemApproval
  ) => {
    setReviewTarget({ kind: 'system', action: 'approve', item: approval });
    setReviewReason('');
    setReviewError('');
  };

  const handleReject = async (
    approval: SystemApproval
  ) => {
    setReviewTarget({ kind: 'system', action: 'reject', item: approval });
    setReviewReason('');
    setReviewError('');
  };

  const handleHRApprove = async (requestId: string) => {
    const item = hrRequests.find((request) => request.id === requestId);
    if (item) setReviewTarget({ kind: 'hr', action: 'approve', item });
    setReviewReason('');
    setReviewError('');
  };

  const handleHRReject = async (requestId: string) => {
    const item = hrRequests.find((request) => request.id === requestId);
    if (item) setReviewTarget({ kind: 'hr', action: 'reject', item });
    setReviewReason('');
    setReviewError('');
  };

  const handleProjectRequestApprove = async (request: ProjectApprovalRequest) => {
    setReviewTarget({ kind: 'project', action: 'approve', item: request });
    setReviewReason('');
    setReviewError('');
  };

  const handleProjectRequestReject = async (request: ProjectApprovalRequest) => {
    setReviewTarget({ kind: 'project', action: 'reject', item: request });
    setReviewReason('');
    setReviewError('');
  };

  const openSetup = (request: ProjectApprovalRequest) => {
    const project = projects.find((item) => item.id === request.projectId);
    setSetupTarget(request);
    setSetupTeamsError('');
    setSetupDraft(request.requestType === 'PROJECT_CREATE' ? {
      title: project?.title || request.projectTitle,
      description: project?.description || '',
      priority: project?.priority || 'Medium',
      startDate: project?.startDate || '',
      targetDate: project?.targetDate || '',
      // Only a multi-team proposal gets a team editor -- a legacy single-lead proposal has no
      // `teams` to seed, and the modal below leaves it out entirely in that case.
      ...(project && project.teams.length > 0
        ? { teams: project.teams.map((team): DraftTeam => ({
            id: team.id, name: team.name, description: team.description,
            leadId: team.leadId, memberIds: team.memberIds
          })) }
        : {})
    } : { ...(request.requestedChanges || {}) });
  };

  const saveSetup = async () => {
    if (!setupTarget) return;
    if (setupDraft.teams) {
      const teamsError = validateTeamSetup(setupDraft.teams as DraftTeam[]);
      if (teamsError) {
        setSetupTeamsError(teamsError);
        return;
      }
    }
    setSetupTeamsError('');
    setSetupLoading(true);
    const payload = setupDraft.teams
      ? {
          ...setupDraft,
          teams: (setupDraft.teams as DraftTeam[]).map((team) => ({
            name: team.name.trim(),
            description: team.description.trim(),
            leadId: team.leadId,
            memberIds: team.memberIds.filter((id) => id !== team.leadId)
          }))
        }
      : setupDraft;
    const result = await updateApprovalSetup(setupTarget.id, payload);
    setSetupLoading(false);
    setNotice({ type: result.success ? 'success' : 'error', message: result.message });
    if (result.success) setSetupTarget(null);
  };

  const renderSetupModal = () => setupTarget && (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm">
      <div className="glass-panel max-h-[85vh] w-full max-w-2xl overflow-y-auto p-5">
        <div className="flex items-start justify-between gap-3"><div><h2 className="text-lg font-bold text-slate-100">Change Setup</h2><p className="mt-1 text-xs text-slate-400">Save updates now; approval remains a separate decision.</p></div><button type="button" onClick={() => setSetupTarget(null)} className="text-slate-400 hover:text-white"><X size={18}/></button></div>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          {([['title','Title','text'],['priority','Priority','text'],['startDate','Start date','date'],[setupTarget.requestType === 'PROJECT_CREATE' ? 'targetDate' : 'dueDate', setupTarget.requestType === 'PROJECT_CREATE' ? 'Target date' : 'Due date','date']] as const).map(([key,label,type]) => (
            <label key={key} className="text-xs text-slate-300">{label}<input type={type} value={setupDraft[key] || ''} onChange={(event) => setSetupDraft((draft) => ({...draft,[key]:event.target.value}))} className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2 text-slate-100 outline-none focus:border-cyan-400/50"/></label>
          ))}
          <label className="text-xs text-slate-300 sm:col-span-2">Description<textarea rows={5} value={setupDraft.description || ''} onChange={(event) => setSetupDraft((draft) => ({...draft,description:event.target.value}))} className="mt-1 w-full resize-y rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2 text-slate-100 outline-none focus:border-cyan-400/50"/></label>
          {Array.isArray(setupDraft.teams) && (
            <fieldset className="sm:col-span-2">
              <legend className="text-xs text-slate-300">Team setup</legend>
              <div className="mt-2">
                <TeamBuilder
                  teams={setupDraft.teams as DraftTeam[]}
                  onChange={(teams) => setSetupDraft((draft) => ({ ...draft, teams }))}
                  teamLeads={setupTeamLeads}
                  assignableMembers={setupAssignableMembers}
                  error={setupTeamsError}
                />
              </div>
            </fieldset>
          )}
          {setupTarget.requestType === 'TASK_CREATE' && <fieldset className="sm:col-span-2"><legend className="text-xs text-slate-300">Proposed assignees</legend><div className="mt-2 grid max-h-40 gap-2 overflow-y-auto rounded-lg border border-white/10 bg-slate-950/40 p-3 sm:grid-cols-2">{(() => {
            const project = projects.find((item) => item.id === setupTarget.projectId);
            const team = project?.teams.find((item) => item.id === setupDraft.teamId || item.leadId === setupTarget.requestedByUserId);
            return (team?.memberIds || project?.memberIds || []).map((id) => {
              const selected = Array.isArray(setupDraft.assigneeIds) && setupDraft.assigneeIds.includes(id);
              return <label key={id} className="flex items-center gap-2 text-xs text-slate-200"><input type="checkbox" checked={selected} onChange={() => setSetupDraft((draft) => ({...draft,assigneeIds:selected ? (draft.assigneeIds || []).filter((item:string) => item !== id) : [...(draft.assigneeIds || []),id]}))}/><span className="break-words">{users.find((user) => user.id === id)?.name || id}</span></label>;
            });
          })()}</div></fieldset>}
        </div>
        <div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setSetupTarget(null)} className="rounded-lg border border-white/10 px-3 py-2 text-xs text-slate-300">Cancel</button><button type="button" disabled={setupLoading} onClick={saveSetup} className="glass-button-neon rounded-lg px-3 py-2 text-xs font-bold disabled:opacity-50">{setupLoading ? 'Saving…' : 'Save Setup'}</button></div>
      </div>
    </div>
  );

  const confirmReview = async () => {
    if (!reviewTarget) return;
    const reason = reviewReason.trim();
    if (reviewTarget.action === 'reject' && !reason) {
      setReviewError('A rejection reason is required.');
      return;
    }
    setReviewLoading(true);
    try {
      let result: { success: boolean; message: string };
      if (reviewTarget.kind === 'system') {
        result = reviewTarget.action === 'approve'
          ? await approveApprovalItem(reviewTarget.item.id)
          : await rejectApprovalItem(reviewTarget.item.id);
      } else if (reviewTarget.kind === 'hr') {
        result = reviewTarget.action === 'approve'
          ? await approveHRRequest(reviewTarget.item.id, reason || undefined)
          : await rejectHRRequest(reviewTarget.item.id, reason);
      } else {
        result = reviewTarget.action === 'approve'
          ? await approveProjectApprovalRequest(reviewTarget.item.id, reason || undefined)
          : await rejectProjectApprovalRequest(reviewTarget.item.id, reason);
      }
      setNotice({ type: result.success ? 'success' : 'error', message: result.message });
      if (result.success) setReviewTarget(null);
    } catch (error: any) {
      setReviewError(error?.message || 'The approval decision could not be completed.');
    } finally {
      setReviewLoading(false);
    }
  };

  const renderReviewModal = () => reviewTarget && (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm">
      <div role="dialog" aria-modal="true" className="glass-panel w-full max-w-lg space-y-4 p-5">
        <div>
          <h2 className="text-lg font-bold text-white">
            {reviewTarget.action === 'approve' ? 'Approve Request' : 'Reject Request'}
          </h2>
          <p className="mt-1 text-xs text-slate-400">
            {reviewTarget.kind === 'system'
              ? `${TYPE_META[reviewTarget.item.type].label}: ${reviewTarget.item.targetTitle}`
              : reviewTarget.kind === 'project'
                ? `${PROJECT_REQUEST_TYPE_META[reviewTarget.item.requestType].label}: ${reviewTarget.item.projectTitle}`
                : `${reviewTarget.item.type.replace('_', ' ')} for ${reviewTarget.item.date}`}
          </p>
        </div>
        {(reviewTarget.action === 'reject' || reviewTarget.kind !== 'project') && (
        <label className="block text-xs font-semibold text-slate-300">
          Reason {reviewTarget.action === 'reject' ? '(required)' : '(optional)'}
          <textarea value={reviewReason} onChange={(event) => { setReviewReason(event.target.value); setReviewError(''); }} rows={4} disabled={reviewLoading} className="mt-2 w-full rounded-xl border border-white/10 bg-slate-950/70 p-3 text-sm text-white outline-none focus:border-cyan-500/50" />
        </label>
        )}
        {reviewError && <p className="text-xs text-rose-300">{reviewError}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" disabled={reviewLoading} onClick={() => setReviewTarget(null)} className="rounded-lg border border-white/10 px-4 py-2 text-xs font-semibold text-slate-300 disabled:opacity-50">Cancel</button>
          <button type="button" disabled={reviewLoading} onClick={confirmReview} className="glass-button-neon rounded-lg px-4 py-2 text-xs font-bold disabled:opacity-50">
            {reviewLoading ? 'Processing…' : reviewTarget.action === 'approve' ? 'Confirm Approval' : 'Confirm Rejection'}
          </button>
        </div>
      </div>
    </div>
  );

  const handleAccountApprove = async (request: AccountChangeRequest) => {
    setReviewingAccountRequestId(request.id);
    const result = await approveAccountChangeRequest(request.id);
    setNotice({ type: result.success ? 'success' : 'error', message: result.message });
    setReviewingAccountRequestId(null);
  };

  const openAccountRejectModal = (request: AccountChangeRequest) => {
    setRejectingAccountRequest(request);
    setAccountRejectionReason('');
    setAccountRejectionError('');
  };

  const closeAccountRejectModal = () => {
    if (reviewingAccountRequestId) return;
    setRejectingAccountRequest(null);
    setAccountRejectionReason('');
    setAccountRejectionError('');
  };

  const handleAccountReject = async () => {
    if (!rejectingAccountRequest) return;
    const reason = accountRejectionReason.trim();
    if (!reason) {
      setAccountRejectionError('A rejection reason is required.');
      return;
    }
    setReviewingAccountRequestId(rejectingAccountRequest.id);
    const result = await rejectAccountChangeRequest(rejectingAccountRequest.id, reason);
    setNotice({ type: result.success ? 'success' : 'error', message: result.message });
    setReviewingAccountRequestId(null);
    if (result.success) closeAccountRejectModal();
  };

  const renderAccountActions = (request: AccountChangeRequest) => {
    if (request.status !== 'Pending') return null;
    const submitting = reviewingAccountRequestId === request.id;
    return (
      <div className="flex justify-end gap-2 border-t border-white/5 pt-3">
        <button
          type="button"
          disabled={submitting}
          onClick={() => openAccountRejectModal(request)}
          className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-xs font-semibold text-rose-300 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Reject
        </button>
        <button
          type="button"
          disabled={submitting}
          onClick={() => handleAccountApprove(request)}
          className="glass-button-neon rounded-lg px-3 py-1.5 text-xs font-bold disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? 'Submitting…' : 'Approve'}
        </button>
      </div>
    );
  };

  const renderAccountChangeDetails = (request: AccountChangeRequest, employee?: User) => {
    const changes = getAccountRequestedChanges(request);
    if (changes.length === 0) return null;
    return (
      <div className="rounded-lg border border-white/10 bg-slate-950/40 p-3 text-xs">
        <span className="block text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">Requested changes</span>
        <div className="mt-3 space-y-3">
          {changes.map(({ field, value }) => (
            <div key={field} className="grid gap-2 rounded-lg border border-white/5 bg-white/[0.025] p-3 sm:grid-cols-2">
              <p className="min-w-0 break-words"><span className="block text-[10px] uppercase tracking-wide text-slate-500">Current {ACCOUNT_FIELD_LABELS[field] || field}</span><span className="mt-1 block text-slate-300">{accountCurrentValue(employee, field)}</span></p>
              <p className="min-w-0 break-words"><span className="block text-[10px] uppercase tracking-wide text-slate-500">Requested {ACCOUNT_FIELD_LABELS[field] || field}</span><span className={field === 'password' ? 'mt-1 block text-amber-300' : 'mt-1 block text-emerald-300'}>{field === 'password' ? 'Password change requested' : value || 'Not provided'}</span></p>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderAccountRejectModal = () => {
    if (!rejectingAccountRequest) return null;
    const submitting = reviewingAccountRequestId === rejectingAccountRequest.id;
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="account-rejection-title"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) closeAccountRejectModal();
        }}
      >
        <div className="glass-panel w-full max-w-lg space-y-4 p-5">
          <div>
            <h2 id="account-rejection-title" className="text-lg font-bold text-white">
              Reject account change request
            </h2>
            <p className="mt-1 text-xs text-slate-400">
              The requester will receive this reason in their notification.
            </p>
          </div>
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-slate-300">Reason</span>
            <textarea
              required
              autoFocus
              maxLength={1000}
              rows={5}
              value={accountRejectionReason}
              disabled={submitting}
              onChange={(event) => {
                setAccountRejectionReason(event.target.value);
                if (event.target.value.trim()) setAccountRejectionError('');
              }}
              className="w-full resize-y rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-white outline-none focus:border-cyan-400/50 disabled:opacity-60"
              placeholder="Explain why this request is being rejected"
            />
          </label>
          {accountRejectionError && (
            <p className="text-xs text-rose-300" role="alert">{accountRejectionError}</p>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" disabled={submitting} onClick={closeAccountRejectModal} className="rounded-lg border border-white/10 px-3 py-2 text-xs font-semibold text-slate-300 disabled:opacity-50">
              Cancel
            </button>
            <button type="button" disabled={submitting || !accountRejectionReason.trim()} onClick={handleAccountReject} className="rounded-lg border border-rose-500/30 bg-rose-500/15 px-3 py-2 text-xs font-bold text-rose-300 disabled:cursor-not-allowed disabled:opacity-50">
              {submitting ? 'Rejecting…' : 'Reject request'}
            </button>
          </div>
        </div>
      </div>
    );
  };

  const renderNotice = () => {
    if (!notice) {
      return null;
    }

    const noticeClass =
      notice.type === 'success'
        ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
        : 'border-rose-500/30 bg-rose-500/10 text-rose-300';

    return (
      <div
        role="status"
        className={`flex items-center justify-between rounded-xl border px-4 py-3 text-sm ${noticeClass}`}
      >
        <span className="flex items-center gap-2">
          {notice.type === 'success' ? (
            <Check size={16} />
          ) : (
            <AlertTriangle size={16} />
          )}

          {notice.message}
        </span>

        <button
          type="button"
          onClick={() => setNotice(null)}
          aria-label="Dismiss message"
        >
          <X size={16} />
        </button>
      </div>
    );
  };

  const renderInboxFilters = () => (
    <div className="glass-panel space-y-4 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">Status</span>
      {(
        [
          'Pending',
          'Approved',
          'Rejected',
          'All'
        ] as StatusFilter[]
      ).map((status) => (
        <button
          key={status}
          type="button"
          onClick={() => setStatusFilter(status)}
          className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
            statusFilter === status
              ? 'border-cyan-400/50 bg-cyan-500/15 text-cyan-300'
              : 'border-white/10 text-slate-300 hover:bg-white/5'
          }`}
        >
          {status}
        </button>
      ))}
      </div>
      <div data-approval-type-filters className="flex flex-wrap items-center gap-2 border-t border-white/5 pt-3">
        <span className="mr-1 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">Approval type</span>
        {(
          currentRole === 'HR'
            ? ['All', 'Attendance', 'Account']
            : currentRole === 'Admin'
              ? ['All', 'Attendance', 'Projects', 'Account']
              : ['All', 'Projects']
        ).map((category: ApprovalCategory) => (
          <button
            key={category}
            type="button"
            onClick={() => setCategoryFilter(category)}
            className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${categoryFilter === category
              ? 'border-violet-400/50 bg-violet-500/15 text-violet-200'
              : 'border-white/10 text-slate-300 hover:bg-white/5'}`}
          >
            {category === 'All' ? 'All approvals' : category}
          </button>
        ))}
      </div>
      <div className="grid gap-3 border-t border-white/5 pt-3 sm:grid-cols-[minmax(0,1fr)_12rem]">
        <label className="flex min-w-0 items-center gap-2 rounded-lg border border-white/10 bg-slate-950/40 px-3 py-2">
          <Search size={14} className="shrink-0 text-slate-500" />
          <input value={requesterSearch} onChange={(event) => setRequesterSearch(event.target.value)} aria-label="Search by requester username" placeholder="Search requester name, username, or email" className="min-w-0 flex-1 bg-transparent text-xs text-slate-200 outline-none placeholder:text-slate-500" />
        </label>
        <label className="flex items-center gap-2 rounded-lg border border-white/10 bg-slate-950/40 px-3 py-2">
          <CalendarDays size={14} className="shrink-0 text-slate-500" />
          <input type="date" value={submittedDate} onChange={(event) => setSubmittedDate(event.target.value)} aria-label="Filter by submitted date" className="min-w-0 flex-1 bg-transparent text-xs text-slate-200 outline-none" />
        </label>
      </div>
    </div>
  );

  if (isHR) {
    return (
      <section className="mx-auto max-h-[calc(100vh-7rem)] max-w-[1200px] space-y-5 overflow-y-auto pr-1">
        <header className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-cyan-400">
              <ClipboardCheck size={15} />
              HR approvals
            </div>

            <h1 className="text-2xl font-bold text-white">
              HR Approval Inbox
            </h1>

            <p className="mt-1 max-w-2xl text-sm text-slate-400">
              Review and finalize Team Member attendance, leave, and correction requests.
            </p>
          </div>

          {pendingHRCount + pendingAccountChangeCount > 0 && (
            <span className="inline-flex shrink-0 items-center gap-2 self-start rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-300">
              <Clock size={13} />
              {pendingHRCount + pendingAccountChangeCount} pending request
              {pendingHRCount + pendingAccountChangeCount !== 1 ? 's' : ''}
            </span>
          )}
        </header>

        {renderNotice()}

        {renderInboxFilters()}

        {filteredHRRequests.length === 0 && filteredAccountChangeRequests.length === 0 ? (
          <div className="glass-panel flex min-h-52 flex-col items-center justify-center px-6 text-center">
            <CheckCircle2
              className="text-slate-500"
              size={26}
            />

            <h3 className="mt-3 font-semibold text-slate-200">
              Nothing here
            </h3>

            <p className="mt-1 text-xs text-slate-500">
              No HR requests match the current filter.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredHRRequests.map((request) => {
              const employee = users.find(
                (user) => user.id === request.userId
              );

              return (
                <div
                  key={request.id}
                  className="glass-panel space-y-4 p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        {categoryFilter === 'All' && <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-500/30 bg-violet-500/10 px-2.5 py-1 text-[10px] font-semibold text-violet-300">
                          {request.type ===
                          'Leave' ? (
                            <LogOut size={13} />
                          ) : (
                            <Clock size={13} />
                          )}

                          {request.type.replace('_', ' ')}
                        </span>}

                        {statusFilter !== 'Pending' && <StatusBadge
                          status={request.status}
                          size="sm"
                        />}
                      </div>

                      <RequesterMeta
                        name={employee?.name || (request as any).userName || 'Unknown Employee'}
                        id={request.userId}
                        submittedAt={request.submittedAt}
                      />
                      <p className="text-xs text-slate-500">Attendance date: {request.date}</p>
                    </div>
                  </div>

                  <ReasonBlock>{request.reason}</ReasonBlock>

                  {request.type === 'Correction' && (
                    <div className="grid gap-3 rounded-lg border border-white/10 bg-slate-950/40 p-3 text-xs sm:grid-cols-2">
                      <div>
                        <span className="block text-[10px] uppercase tracking-wider text-slate-500">
                          Current time
                        </span>
                        <p className="mt-1 text-slate-300">Clock-in: {request.details.currentCheckIn || 'Not recorded'}</p>
                        <p className="text-slate-300">Clock-out: {request.details.currentCheckOut || 'Not recorded'}</p>
                        <p className="text-slate-300">Breaks: {request.details.currentBreaks?.length ?? 0}</p>
                      </div>

                      <div>
                        <span className="block text-[10px] uppercase tracking-wider text-slate-500">
                          Requested time
                        </span>
                        <p className="mt-1 text-emerald-300">Clock-in: {request.details.requestedCheckIn || 'Not provided'}</p>
                        <p className="text-emerald-300">Clock-out: {request.details.requestedCheckOut || 'Not provided'}</p>
                        <p className="text-emerald-300">Breaks: {request.details.requestedBreaks?.length ?? 0}</p>
                      </div>
                    </div>
                  )}

                  {request.type === 'Leave' && (
                    <div className="grid gap-3 rounded-lg border border-white/10 bg-slate-950/40 p-3 text-xs sm:grid-cols-2">
                      <div>
                        <span className="block text-[10px] uppercase tracking-wider text-slate-500">
                          Leave type
                        </span>

                        <span className="mt-1 block text-slate-200">
                          {request.details.leaveType ||
                            'Not provided'}
                        </span>
                      </div>

                      <div>
                        <span className="block text-[10px] uppercase tracking-wider text-slate-500">
                          Period
                        </span>

                        <span className="mt-1 block text-slate-200">
                          {request.details.leaveType === 'Half Day Leave'
                            ? request.details.leavePeriod || 'Second Half'
                            : 'Full Day'}
                        </span>
                      </div>

                      <div>
                        <span className="block text-[10px] uppercase tracking-wider text-slate-500">
                          Leave days
                        </span>

                        <span className="mt-1 block text-slate-200">
                          {request.details.leaveDays ??
                            'Not provided'}
                        </span>
                      </div>
                    </div>
                  )}

                  {request.decisionReason && (
                    <div className="rounded-lg border border-white/10 bg-white/5 p-3">
                      <span className="block text-[10px] uppercase tracking-wider text-slate-500">
                        Decision note
                      </span>

                      <p className="mt-1 text-xs text-slate-300">
                        {request.decisionReason}
                      </p>
                    </div>
                  )}

                  {request.status === 'Pending' && (
                    <div className="flex justify-end gap-2 border-t border-white/5 pt-3">
                      <button
                        type="button"
                        onClick={() =>
                          handleHRReject(request.id)
                        }
                        className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-xs font-semibold text-rose-300 transition hover:bg-rose-500/20"
                      >
                        <XCircle size={14} />
                        Reject
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          handleHRApprove(request.id)
                        }
                        className="glass-button-neon inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold"
                      >
                        <CheckCircle2 size={14} />
                        Approve
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {currentRole === 'HR' && filteredAccountChangeRequests.length > 0 && (
          <div className="space-y-3">
            {filteredAccountChangeRequests.map((request) => {
              const employee = users.find((user) => user.id === request.userId);
              return (
                <div key={request.id} className="glass-panel space-y-4 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        {categoryFilter === 'All' && <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-500/30 bg-violet-500/10 px-2.5 py-1 text-[10px] font-semibold text-violet-300">
                          <UserIcon size={13} />
                          Account Change
                        </span>}
                        {statusFilter !== 'Pending' && <StatusBadge status={request.status} size="sm" />}
                      </div>
                      <RequesterMeta
                        name={employee?.name || request.userName || 'Unknown Employee'}
                        id={request.userId}
                        submittedAt={request.submittedAt}
                      />
                    </div>
                  </div>

                  <ReasonBlock>{request.reason}</ReasonBlock>

                  {renderAccountChangeDetails(request, employee)}
                  {renderAccountActions(request)}
                </div>
              );
            })}
          </div>
        )}
        {renderAccountRejectModal()}
        {renderReviewModal()}
      </section>
    );
  }

  if (!isSystemApprovalRole) {
    return (
      <section className="mx-auto max-w-3xl">
        <div className="glass-panel flex min-h-52 flex-col items-center justify-center px-6 text-center">
          <AlertTriangle
            className="text-slate-500"
            size={26}
          />

          <h3 className="mt-3 font-semibold text-slate-200">
            Approvals Inbox is restricted
          </h3>

          <p className="mt-1 text-xs text-slate-500">
            Only Admin, Team Lead and HR accounts can access
            approval requests.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="mx-auto h-[calc(100vh-7rem)] max-w-[1200px] space-y-5 overflow-y-auto overscroll-contain pr-1">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-cyan-400">
            <ClipboardCheck size={15} />
            Approvals inbox
          </div>

          <h1 className="text-2xl font-bold text-white">
            Approvals Inbox
          </h1>

          <p className="mt-1 max-w-2xl text-sm text-slate-400">
            {currentRole === 'Admin'
              ? 'Review project management, attendance and leave requests that require Admin approval.'
              : 'Review requests for the projects you lead. Project creation proposals route to Admin.'}
          </p>
        </div>

        {pendingSystemCount + pendingHRCount + pendingProjectApprovalCount + pendingAccountChangeCount > 0 && (
          <span className="inline-flex shrink-0 items-center gap-2 self-start rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-300">
            <Clock size={13} />
            {pendingSystemCount + pendingHRCount + pendingProjectApprovalCount + pendingAccountChangeCount} pending decision
            {pendingSystemCount + pendingHRCount + pendingProjectApprovalCount + pendingAccountChangeCount !== 1 ? 's' : ''}
          </span>
        )}
      </header>

      {renderNotice()}

      {renderInboxFilters()}

      {orderedProjectApprovalRequests.length > 0 && (
        <div className="space-y-3">
          {orderedProjectApprovalRequests.map((request) => {
            const project = projects.find((item) => item.id === request.projectId);
            const requestMeta = PROJECT_REQUEST_TYPE_META[request.requestType];
            return (
            <div key={request.id} className="glass-panel space-y-4 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold ${requestMeta.className}`}>
                      {requestMeta.icon}
                      {requestMeta.label}
                    </span>
                    {statusFilter !== 'Pending' && <StatusBadge status={request.status} size="sm" />}
                  </div>
                  <h3 className="break-words text-lg font-semibold text-slate-100">{request.projectTitle}</h3>
                  {requestMeta.description && (
                    <p className="text-xs text-slate-500">
                      {requestMeta.description}
                    </p>
                  )}
                  <RequesterMeta
                    name={request.requestedByName}
                    id={request.requestedByUserId}
                    submittedAt={new Date(request.createdAt).toLocaleString()}
                  />
                </div>
              </div>

              <ReasonBlock>{request.reason}</ReasonBlock>

              {request.requestType === 'PROJECT_CREATE' && (
                <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/[0.045] p-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <span className="block text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-300/80">Proposed project</span>
                      <p className="mt-1 break-words text-sm font-semibold text-slate-100">{project?.title || request.projectTitle}</p>
                      <p className="mt-2 break-words whitespace-pre-wrap text-xs leading-5 text-slate-300">{project?.description || 'Project description is unavailable.'}</p>
                    </div>
                    {project && onViewProject && (
                      <button
                        type="button"
                        onClick={() => onViewProject(request.projectId)}
                        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-200 transition hover:bg-emerald-500/20"
                      >
                        <Eye size={14} />
                        View project
                      </button>
                    )}
                  </div>
                </div>
              )}

              {request.requestType === 'TASK_CREATE' && (() => {
                const setup = request.requestedChanges || {};
                const assigneeIds = Array.isArray(setup.assigneeIds) ? setup.assigneeIds as string[] : [];
                return <div className="grid gap-3 rounded-lg border border-violet-500/20 bg-violet-500/[0.045] p-3 text-xs sm:grid-cols-2">
                  <div><span className="block text-[10px] uppercase text-slate-500">Task title</span><span className="break-words text-slate-100">{String(setup.title || 'Not provided')}</span></div>
                  <div><span className="block text-[10px] uppercase text-slate-500">Project</span><span className="text-slate-100">{request.projectTitle}</span></div>
                  <div><span className="block text-[10px] uppercase text-slate-500">Priority / due date</span><span className="text-slate-100">{String(setup.priority || 'Not provided')} · {String(setup.dueDate || 'Not provided')}</span></div>
                  <div><span className="block text-[10px] uppercase text-slate-500">Proposed assignees</span><span className="break-words text-slate-100">{assigneeIds.map((id) => users.find((user) => user.id === id)?.name || id).join(', ') || 'None'}</span></div>
                  <div className="sm:col-span-2"><span className="block text-[10px] uppercase text-slate-500">Description</span><span className="whitespace-pre-wrap break-words text-slate-100">{String(setup.description || 'Not provided')}</span></div>
                </div>;
              })()}

              {request.requestType === 'PROJECT_EDIT' && projectEditChanges(request).length > 0 && (
                <div className="rounded-lg border border-white/10 bg-slate-950/40 p-3 text-xs text-slate-300">
                  <span className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500">Changes Requested</span>
                  <div className="mt-3 space-y-3">
                    {projectEditChanges(request).map((change) => (
                      <div key={change.fieldKey} className="min-w-0 rounded-lg border border-white/5 bg-white/[0.025] p-3">
                        <p className="font-semibold text-slate-100">{change.fieldLabel}</p>
                        {change.fieldKey === 'memberIds' ? (
                          <div className="mt-2 grid gap-2 sm:grid-cols-2">
                            <p className="break-words"><span className="block text-[10px] uppercase text-slate-500">Removed</span><span className="text-rose-300">{formatProjectChangeValue(change.fieldKey, change.removed)}</span></p>
                            <p className="break-words"><span className="block text-[10px] uppercase text-slate-500">Added</span><span className="text-emerald-300">{formatProjectChangeValue(change.fieldKey, change.added)}</span></p>
                          </div>
                        ) : (
                          <div className="mt-2 grid gap-2 sm:grid-cols-2">
                            <p className="min-w-0 whitespace-pre-wrap break-words"><span className="block text-[10px] uppercase text-slate-500">Before</span><span className="text-slate-300">{formatProjectChangeValue(change.fieldKey, change.oldDisplayValue)}</span></p>
                            <p className="min-w-0 whitespace-pre-wrap break-words"><span className="block text-[10px] uppercase text-cyan-500">After</span><span className="text-cyan-100">{formatProjectChangeValue(change.fieldKey, change.newDisplayValue)}</span></p>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {request.decisionReason && (
                <div className="rounded-lg border border-white/10 bg-white/5 p-3">
                  <span className="block text-[10px] uppercase tracking-wider text-slate-500">Decision note</span>
                  <p className="mt-1 text-xs text-slate-300">{request.decisionReason}</p>
                </div>
              )}

              {currentRole === 'Admin' && request.status === 'Pending' && (
                <div className="flex justify-end gap-2 border-t border-white/5 pt-3">
                  <button
                    type="button"
                    onClick={() => handleProjectRequestReject(request)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-xs font-semibold text-rose-300 transition hover:bg-rose-500/20"
                  >
                    <XCircle size={14} />
                    Reject
                  </button>
                  {(request.requestType === 'PROJECT_CREATE' || request.requestType === 'TASK_CREATE') && <button type="button" onClick={() => openSetup(request)} className="inline-flex items-center gap-1.5 rounded-lg border border-violet-500/30 bg-violet-500/10 px-3 py-1.5 text-xs font-semibold text-violet-200 transition hover:bg-violet-500/20 hover:text-white"><Settings2 size={14}/>Change Setup</button>}
                  <button
                    type="button"
                    onClick={() => handleProjectRequestApprove(request)}
                    className="glass-button-neon inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold"
                  >
                    <CheckCircle2 size={14} />
                    Approve
                  </button>
                </div>
              )}
            </div>
            );
          })}
        </div>
      )}

      {currentRole === 'Admin' && filteredHRRequests.length > 0 && (
        <div className="space-y-3">
          {filteredHRRequests.map((request) => {
            const employee = users.find((user) => user.id === request.userId);
            return (
              <div key={request.id} className="glass-panel space-y-4 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      {categoryFilter === 'All' && <span className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2.5 py-1 text-[10px] font-semibold text-cyan-300">
                        {request.type === 'Leave' ? 'Leave Request' : 'Attendance Edit'}
                      </span>}
                      {statusFilter !== 'Pending' && <StatusBadge status={request.status} size="sm" />}
                    </div>
                    <div className="mt-2">
                      <RequesterMeta
                        name={employee?.name || request.userName || 'Unknown Employee'}
                        id={request.userId}
                        submittedAt={request.submittedAt}
                      />
                    </div>
                    <p className="mt-1 text-xs text-slate-500">Attendance date: {request.date}</p>
                  </div>
                </div>

                {request.type === 'Correction' ? (
                  <div className="grid gap-3 rounded-lg border border-white/10 bg-slate-950/40 p-3 text-xs sm:grid-cols-2">
                    <div>
                      <span className="block text-[10px] uppercase tracking-wider text-slate-500">Current values</span>
                      <p className="mt-1 text-slate-300">Check-in: {request.details.currentCheckIn === '' ? 'Not recorded' : request.details.currentCheckIn}</p>
                      <p className="text-slate-300">Check-out: {request.details.currentCheckOut === '' ? 'Not recorded' : request.details.currentCheckOut}</p>
                      <p className="text-slate-300">Breaks: {request.details.currentBreaks?.length ?? 0}</p>
                    </div>
                    <div>
                      <span className="block text-[10px] uppercase tracking-wider text-slate-500">Requested values</span>
                      <p className="mt-1 text-emerald-300">Check-in: {request.details.requestedCheckIn === '' ? 'Not recorded' : request.details.requestedCheckIn}</p>
                      <p className="text-emerald-300">Check-out: {request.details.requestedCheckOut === '' ? 'Not recorded' : request.details.requestedCheckOut}</p>
                      <p className="text-emerald-300">Breaks: {request.details.requestedBreaks?.length ?? 0}</p>
                    </div>
                  </div>
                ) : (
                  <div className="grid gap-3 rounded-lg border border-white/10 bg-slate-950/40 p-3 text-xs sm:grid-cols-3">
                    <div><span className="block text-[10px] uppercase text-slate-500">Employee</span><span className="mt-1 block text-slate-200">{employee?.name || request.userName || 'Unknown'}</span></div>
                    <div><span className="block text-[10px] uppercase text-slate-500">Leave type</span><span className="mt-1 block text-slate-200">{request.details.leaveType || 'Not provided'}</span></div>
                    <div><span className="block text-[10px] uppercase text-slate-500">Date</span><span className="mt-1 block text-slate-200">{request.date}</span></div>
                  </div>
                )}

                <ReasonBlock>{request.reason}</ReasonBlock>

                {request.status === 'Pending' && (
                  <div className="flex justify-end gap-2 border-t border-white/5 pt-3">
                    <button type="button" onClick={() => handleHRReject(request.id)} className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-xs font-semibold text-rose-300">
                      Reject
                    </button>
                    <button type="button" onClick={() => handleHRApprove(request.id)} className="glass-button-neon rounded-lg px-3 py-1.5 text-xs font-bold">
                      Approve
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {currentRole === 'Admin' && filteredAccountChangeRequests.length > 0 && (
        <div className="space-y-3">
          {filteredAccountChangeRequests.map((request) => {
            const employee = users.find((user) => user.id === request.userId);
            return (
              <div key={request.id} className="glass-panel space-y-4 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {categoryFilter === 'All' && <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-500/30 bg-violet-500/10 px-2.5 py-1 text-[10px] font-semibold text-violet-300">
                        <UserIcon size={13} />
                        Account Change
                      </span>}
                      {statusFilter !== 'Pending' && <StatusBadge status={request.status} size="sm" />}
                    </div>
                    <RequesterMeta
                      name={employee?.name || request.userName || 'Unknown Employee'}
                      id={request.userId}
                      submittedAt={request.submittedAt}
                    />
                  </div>
                </div>

                <ReasonBlock>{request.reason}</ReasonBlock>

                {renderAccountChangeDetails(request, employee)}
                {renderAccountActions(request)}
              </div>
            );
          })}
        </div>
      )}

      {filteredApprovals.length === 0 &&
      orderedProjectApprovalRequests.length === 0 &&
      filteredAccountChangeRequests.length === 0 &&
      !(currentRole === 'Admin' && filteredHRRequests.length > 0) ? (
        <div className="glass-panel flex min-h-52 flex-col items-center justify-center px-6 text-center">
          <CheckCircle2
            className="text-slate-500"
            size={26}
          />

          <h3 className="mt-3 font-semibold text-slate-200">
            Nothing here
          </h3>

          <p className="mt-1 text-xs text-slate-500">
            No requests match the current filters.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredApprovals.map((approval) => {
            const project = getApprovalProject(
              approval,
              projects,
              tasks
            );

            const requester = users.find(
              (user) =>
                user.id === approval.requestedBy
            );

            const decidable =
              canDecide(
                currentRole as 'Admin' | 'Team_Lead',
                currentUser.id,
                approval,
                project
              ) && approval.status === 'Pending';

            return (
              <div
                key={approval.id}
                className="glass-panel space-y-3 p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {categoryFilter === 'All' && <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-500/30 bg-violet-500/10 px-2.5 py-1 text-[10px] font-semibold text-violet-300">
                        {TYPE_META[approval.type].icon}
                        {TYPE_META[approval.type].label}
                      </span>}

                      {statusFilter !== 'Pending' && <StatusBadge
                        status={approval.status}
                        size="sm"
                      />}
                    </div>

                    <h3 className="break-words font-semibold text-slate-100">
                      {approval.targetTitle}
                    </h3>

                    <RequesterMeta
                      name={requester?.name || 'Unknown'}
                      id={approval.requestedBy}
                      submittedAt={approval.createdAt}
                    />
                    {project && <p className="break-words text-xs text-slate-500">Project: {project.title}</p>}
                  </div>
                </div>

                <ReasonBlock label="Request details">{approval.details}</ReasonBlock>

                {approval.proposedTaskUpdate && approval.previousTaskSnapshot && (
                  <div className="overflow-hidden rounded-lg border border-white/10 bg-slate-950/40 text-xs">
                    {([
                      ['Title', 'title'],
                      ['Description', 'description'],
                      ['Priority', 'priority'],
                      ['Start date', 'startDate'],
                      ['Due date', 'dueDate']
                    ] as const).map(([label, field]) => {
                      const currentValue = approval.previousTaskSnapshot![field];
                      const proposedValue = approval.proposedTaskUpdate![field];
                      const changed = currentValue !== proposedValue;
                      const displayValue = (value: string) => value === '' ? '(empty)' : value;
                      return (
                        <div key={field} className="grid gap-2 border-b border-white/5 p-3 last:border-b-0 sm:grid-cols-[7rem_1fr_1fr]">
                          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                            {label}
                          </span>
                          <div>
                            <span className="mb-1 block text-[10px] text-slate-500">Current</span>
                            <span className={changed ? 'text-slate-300' : 'text-slate-400'}>
                              {displayValue(currentValue)}
                            </span>
                          </div>
                          <div>
                            <span className="mb-1 block text-[10px] text-slate-500">Proposed</span>
                            <span className={changed ? 'text-emerald-300' : 'text-slate-400'}>
                              {displayValue(proposedValue)}
                              {!changed && <span className="ml-2 text-[10px] text-slate-600">(unchanged)</span>}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {!approval.proposedTaskUpdate && approval.proposedDiff && (
                  <div className="rounded-lg border border-white/10 bg-slate-950/40 p-3 text-xs text-slate-300">
                    <span className="block text-[10px] uppercase tracking-wider text-slate-500">
                      Proposed change —{' '}
                      {approval.proposedDiff.field}
                    </span>

                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <span className="rounded-md bg-white/5 px-2 py-1 line-through decoration-rose-400/60">
                        {approval.proposedDiff.oldValue}
                      </span>

                      <span className="text-slate-500">
                        →
                      </span>

                      <span className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-emerald-300">
                        {approval.proposedDiff.newValue}
                      </span>
                    </div>
                  </div>
                )}

                {decidable && (
                  <div className="flex justify-end gap-2 border-t border-white/5 pt-3">
                    <button
                      type="button"
                      onClick={() =>
                        handleReject(approval)
                      }
                      className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-xs font-semibold text-rose-300 transition hover:bg-rose-500/20"
                    >
                      <XCircle size={14} />
                      Reject
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        handleApprove(approval)
                      }
                      className="glass-button-neon inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold"
                    >
                      <CheckCircle2 size={14} />
                      Approve
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {renderAccountRejectModal()}
      {renderReviewModal()}
      {renderSetupModal()}
    </section>
  );
};
