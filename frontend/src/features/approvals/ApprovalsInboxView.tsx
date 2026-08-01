import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  ArchiveRestore,
  Check,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Coffee,
  FolderKanban,
  LogOut,
  Pencil,
  Plus,
  Trash2,
  Shield,
  User as UserIcon,
  X,
  XCircle
} from 'lucide-react';
import { useApp } from '../../store/AppContext';
import { StatusBadge } from '../../components/common/StatusBadge';
import { AccountChangeRequest, Project, ProjectApprovalRequest, ProjectApprovalRequestType, SystemApproval, Task } from '../../types';

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

// Project Management Approval Workflow (Team Lead -> Admin) -- rendered as its own section
// below, separate from the legacy SystemApproval cards. See AppContext's projectApprovalRequests
// / approveProjectApprovalRequest / rejectProjectApprovalRequest, backed by
// backend/src/projects/projectApproval.*.
const PROJECT_REQUEST_TYPE_META: Record<ProjectApprovalRequestType, { label: string; icon: React.ReactNode }> = {
  PROJECT_EDIT: { label: 'Project Edit', icon: <Pencil size={13} /> },
  PROJECT_ARCHIVE: { label: 'Project Archive', icon: <Archive size={13} /> },
  PROJECT_RESTORE: { label: 'Project Restore', icon: <ArchiveRestore size={13} /> },
  PROJECT_PERMANENT_DELETE: { label: 'Permanent Delete', icon: <Trash2 size={13} /> }
};

type StatusFilter = 'Pending' | 'Approved' | 'Rejected' | 'All';
type TypeFilter = 'All' | SystemApproval['type'];

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

export const ApprovalsInboxView: React.FC = () => {
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
    approveAccountChangeRequest,
    rejectAccountChangeRequest
  } = useApp();

  const [statusFilter, setStatusFilter] =
    useState<StatusFilter>('Pending');

  const [typeFilter, setTypeFilter] =
    useState<TypeFilter>('All');

  const [notice, setNotice] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);
  const [reviewingAccountRequestId, setReviewingAccountRequestId] = useState<string | null>(null);
  const [rejectingAccountRequest, setRejectingAccountRequest] = useState<AccountChangeRequest | null>(null);
  const [accountRejectionReason, setAccountRejectionReason] = useState('');
  const [accountRejectionError, setAccountRejectionError] = useState('');

  const isSystemApprovalRole =
    currentRole === 'Admin' || currentRole === 'Team_Lead';

  const isHR = currentRole === 'HR';

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

  const filteredApprovals = visibleApprovals.filter(
    (approval) => {
      const matchesStatus =
        statusFilter === 'All' ||
        approval.status === statusFilter;

      const matchesType =
        typeFilter === 'All' ||
        approval.type === typeFilter;

      return matchesStatus && matchesType;
    }
  );

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

  const filteredHRRequests = reviewableHRRequests.filter(
    (request) =>
      statusFilter === 'All' ||
      request.status === statusFilter
  );

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
    (request) => statusFilter === 'All' || request.status === statusFilter
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

  const filteredAccountChangeRequests = reviewableAccountChangeRequests.filter(
    (request) => statusFilter === 'All' || request.status === statusFilter
  );

  const pendingAccountChangeCount = reviewableAccountChangeRequests.filter(
    (request) => request.status === 'Pending'
  ).length;

  const handleApprove = async (
    approval: SystemApproval
  ) => {
    const result = await approveApprovalItem(approval.id);

    setNotice({
      type: result.success ? 'success' : 'error',
      message: result.message
    });
  };

  const handleReject = async (
    approval: SystemApproval
  ) => {
    const confirmed = window.confirm(
      `Reject "${approval.targetTitle}"? This cannot be undone.`
    );

    if (!confirmed) {
      return;
    }

    const result = await rejectApprovalItem(approval.id);

    setNotice({
      type: result.success ? 'success' : 'error',
      message: result.message
    });
  };

  const handleHRApprove = async (requestId: string) => {
    const approvalNote = window.prompt(
      'Enter an optional approval note:'
    );

    const result = await approveHRRequest(
      requestId,
      approvalNote?.trim() || undefined
    );

    setNotice({
      type: result.success ? 'success' : 'error',
      message: result.message
    });
  };

  const handleHRReject = async (requestId: string) => {
    const rejectionReason = window.prompt(
      'Enter a reason for rejecting this request:'
    );

    if (!rejectionReason?.trim()) {
      setNotice({
        type: 'error',
        message: 'A rejection reason is required.'
      });

      return;
    }

    const result = await rejectHRRequest(
      requestId,
      rejectionReason.trim()
    );

    setNotice({
      type: result.success ? 'success' : 'error',
      message: result.message
    });
  };

  const handleProjectRequestApprove = async (request: ProjectApprovalRequest) => {
    const approvalNote = window.prompt('Enter an optional approval note:');
    const result = await approveProjectApprovalRequest(request.id, approvalNote?.trim() || undefined);
    setNotice({ type: result.success ? 'success' : 'error', message: result.message });
  };

  const handleProjectRequestReject = async (request: ProjectApprovalRequest) => {
    const rejectionReason = window.prompt(`Reason for rejecting this ${PROJECT_REQUEST_TYPE_META[request.requestType].label} request:`);
    if (!rejectionReason?.trim()) {
      setNotice({ type: 'error', message: 'A rejection reason is required.' });
      return;
    }
    const result = await rejectProjectApprovalRequest(request.id, rejectionReason.trim());
    setNotice({ type: result.success ? 'success' : 'error', message: result.message });
  };

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

  const renderStatusFilters = () => (
    <div className="glass-panel flex flex-wrap items-center gap-2 p-4">
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
  );

  if (isHR) {
    return (
      <section className="mx-auto max-w-[1200px] space-y-5">
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
              Review Team Member leave requests before they are forwarded
              to Admin for final approval.
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

        {renderStatusFilters()}

        {filteredHRRequests.length === 0 ? (
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
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-500/30 bg-violet-500/10 px-2.5 py-1 text-[10px] font-semibold text-violet-300">
                          {request.type ===
                          'Break_Exception' ? (
                            <Coffee size={13} />
                          ) : request.type ===
                            'Leave' ? (
                            <LogOut size={13} />
                          ) : (
                            <Clock size={13} />
                          )}

                          {request.type.replace('_', ' ')}
                        </span>

                        <StatusBadge
                          status={request.status}
                          size="sm"
                        />
                      </div>

                      <h3 className="font-semibold text-slate-100">
                        {employee?.name || (request as any).userName || 'Unknown Employee'}
                      </h3>

                      <p className="text-xs text-slate-400">
                        Request date: {request.date} · Submitted:{' '}
                        {request.submittedAt}
                      </p>
                    </div>
                  </div>

                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                      Reason
                    </p>

                    <p className="mt-1 text-xs leading-5 text-slate-300">
                      {request.reason}
                    </p>
                  </div>

                  {request.type === 'Correction' && (
                    <div className="grid gap-3 rounded-lg border border-white/10 bg-slate-950/40 p-3 text-xs sm:grid-cols-2">
                      <div>
                        <span className="block text-[10px] uppercase tracking-wider text-slate-500">
                          Requested check-in
                        </span>

                        <span className="mt-1 block text-slate-200">
                          {request.details.requestedCheckIn ||
                            'Not provided'}
                        </span>
                      </div>

                      <div>
                        <span className="block text-[10px] uppercase tracking-wider text-slate-500">
                          Requested check-out
                        </span>

                        <span className="mt-1 block text-slate-200">
                          {request.details.requestedCheckOut ||
                            'Not provided'}
                        </span>
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
                          Leave days
                        </span>

                        <span className="mt-1 block text-slate-200">
                          {request.details.leaveDays ??
                            'Not provided'}
                        </span>
                      </div>
                    </div>
                  )}

                  {request.type === 'Break_Exception' && (
                    <div className="rounded-lg border border-white/10 bg-slate-950/40 p-3 text-xs">
                      <span className="block text-[10px] uppercase tracking-wider text-slate-500">
                        Extra break minutes
                      </span>

                      <span className="mt-1 block text-slate-200">
                        {request.details.extraBreakMinutes ??
                          'Not provided'}
                      </span>
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
            <h2 className="flex items-center gap-2 text-sm font-bold text-white">
              <UserIcon size={16} className="text-cyan-400" />
              Account Change Requests
            </h2>
            {filteredAccountChangeRequests.map((request) => {
              const employee = users.find((user) => user.id === request.userId);
              return (
                <div key={request.id} className="glass-panel space-y-4 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-500/30 bg-violet-500/10 px-2.5 py-1 text-[10px] font-semibold text-violet-300">
                          <UserIcon size={13} />
                          Account Change
                        </span>
                        <StatusBadge status={request.status} size="sm" />
                      </div>
                      <h3 className="font-semibold text-slate-100">
                        {employee?.name || request.userName || 'Unknown Employee'}
                      </h3>
                      <p className="text-xs text-slate-400">
                        {request.requesterRole ? request.requesterRole.replace('_', ' ') : 'Unknown Role'} · Submitted: {request.submittedAt}
                      </p>
                    </div>
                  </div>

                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Reason</p>
                    <p className="mt-1 text-xs leading-5 text-slate-300">{request.reason}</p>
                  </div>

                  {getAccountRequestedChanges(request).length > 0 && (
                    <div className="rounded-lg border border-white/10 bg-slate-950/40 p-3 text-xs">
                      <span className="block text-[10px] uppercase tracking-wider text-slate-500 mb-2">Requested Change</span>
                      <div className="space-y-1">
                        {getAccountRequestedChanges(request).map(({ field, value }) => (
                          <div key={field} className="flex items-baseline gap-2">
                            <span className="text-slate-500 w-24 shrink-0">{ACCOUNT_FIELD_LABELS[field] || field}:</span>
                            <span className={field === 'password' ? 'text-amber-400' : 'text-emerald-300'}>
                              {field === 'password' ? 'Password change requested' : value}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {renderAccountActions(request)}
                </div>
              );
            })}
          </div>
        )}
        {renderAccountRejectModal()}
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
    <section className="mx-auto max-w-[1200px] space-y-5">
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

      <div className="glass-panel flex flex-wrap items-center gap-2 p-4">
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

        <span className="mx-1 h-4 w-px bg-white/10" />

        {(
          [
            'All',
            'Project_Creation',
            'Project_Deletion'
          ] as TypeFilter[]
        ).map((type) => (
          <button
            key={type}
            type="button"
            onClick={() => setTypeFilter(type)}
            className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
              typeFilter === type
                ? 'border-violet-400/50 bg-violet-500/15 text-violet-300'
                : 'border-white/10 text-slate-300 hover:bg-white/5'
            }`}
          >
            {type === 'All'
              ? 'All types'
              : TYPE_META[type].label}
          </button>
        ))}
      </div>

      {filteredProjectApprovalRequests.length > 0 && (
        <div className="space-y-3">
          <h2 className="flex items-center gap-2 text-sm font-bold text-white">
            <FolderKanban size={16} className="text-cyan-400" />
            Project Management Requests
          </h2>
          {filteredProjectApprovalRequests.map((request) => (
            <div key={request.id} className="glass-panel space-y-3 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-500/30 bg-violet-500/10 px-2.5 py-1 text-[10px] font-semibold text-violet-300">
                      {PROJECT_REQUEST_TYPE_META[request.requestType].icon}
                      {PROJECT_REQUEST_TYPE_META[request.requestType].label}
                    </span>
                    <StatusBadge status={request.status} size="sm" />
                  </div>
                  <h3 className="truncate font-semibold text-slate-100">{request.projectTitle}</h3>
                  <p className="text-xs text-slate-400">
                    Requested by {request.requestedByName} · {new Date(request.createdAt).toLocaleString()}
                  </p>
                </div>
              </div>

              <div>
                <span className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500">Reason</span>
                <p className="mt-1 text-xs leading-5 text-slate-300">{request.reason}</p>
              </div>

              {request.requestType === 'PROJECT_EDIT' && request.requestedChanges && (
                <div className="rounded-lg border border-white/10 bg-slate-950/40 p-3 text-xs text-slate-300">
                  <span className="block text-[10px] uppercase tracking-wider text-slate-500">Requested changes</span>
                  <div className="mt-1 space-y-1">
                    {Object.entries(request.requestedChanges)
                      .filter(([, value]) => value !== undefined)
                      .map(([field, value]) => (
                        <div key={field} className="flex items-center gap-2">
                          <span className="text-slate-500">{field}:</span>
                          <span className="text-emerald-300">{String(value)}</span>
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
          ))}
        </div>
      )}

      {currentRole === 'Admin' && filteredHRRequests.length > 0 && (
        <div className="space-y-3">
          <h2 className="flex items-center gap-2 text-sm font-bold text-white">
            <Clock size={16} className="text-cyan-400" />
            Attendance and Leave Requests
          </h2>
          {filteredHRRequests.map((request) => {
            const employee = users.find((user) => user.id === request.userId);
            return (
              <div key={request.id} className="glass-panel space-y-4 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2.5 py-1 text-[10px] font-semibold text-cyan-300">
                        {request.type === 'Leave' ? 'Leave Request' : 'Attendance Edit'}
                      </span>
                      <StatusBadge status={request.status} size="sm" />
                    </div>
                    <h3 className="mt-2 font-semibold text-white">
                      {employee?.name || request.userName || 'Unknown Employee'}
                    </h3>
                    <p className="mt-1 text-xs text-slate-400">
                      Attendance date: {request.date} · Requested by {request.userName || employee?.name || 'Unknown'} · {request.submittedAt}
                    </p>
                  </div>
                </div>

                {request.type === 'Correction' ? (
                  <div className="grid gap-3 rounded-lg border border-white/10 bg-slate-950/40 p-3 text-xs sm:grid-cols-2">
                    <div>
                      <span className="block text-[10px] uppercase tracking-wider text-slate-500">Current values</span>
                      <p className="mt-1 text-slate-300">Check-in: {request.details.currentCheckIn === '' ? 'Not recorded' : request.details.currentCheckIn}</p>
                      <p className="text-slate-300">Check-out: {request.details.currentCheckOut === '' ? 'Not recorded' : request.details.currentCheckOut}</p>
                    </div>
                    <div>
                      <span className="block text-[10px] uppercase tracking-wider text-slate-500">Requested values</span>
                      <p className="mt-1 text-emerald-300">Check-in: {request.details.requestedCheckIn === '' ? 'Not recorded' : request.details.requestedCheckIn}</p>
                      <p className="text-emerald-300">Check-out: {request.details.requestedCheckOut === '' ? 'Not recorded' : request.details.requestedCheckOut}</p>
                    </div>
                  </div>
                ) : (
                  <div className="grid gap-3 rounded-lg border border-white/10 bg-slate-950/40 p-3 text-xs sm:grid-cols-3">
                    <div><span className="block text-[10px] uppercase text-slate-500">Employee</span><span className="mt-1 block text-slate-200">{employee?.name || request.userName || 'Unknown'}</span></div>
                    <div><span className="block text-[10px] uppercase text-slate-500">Leave type</span><span className="mt-1 block text-slate-200">{request.details.leaveType || 'Not provided'}</span></div>
                    <div><span className="block text-[10px] uppercase text-slate-500">Date</span><span className="mt-1 block text-slate-200">{request.date}</span></div>
                  </div>
                )}

                <div>
                  <span className="block text-[10px] uppercase tracking-wider text-slate-500">Reason</span>
                  <p className="mt-1 text-xs text-slate-300">{request.reason}</p>
                </div>

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
          <h2 className="flex items-center gap-2 text-sm font-bold text-white">
            <Shield size={16} className="text-cyan-400" />
            Account Change Requests
          </h2>
          {filteredAccountChangeRequests.map((request) => {
            const employee = users.find((user) => user.id === request.userId);
            return (
              <div key={request.id} className="glass-panel space-y-4 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-500/30 bg-violet-500/10 px-2.5 py-1 text-[10px] font-semibold text-violet-300">
                        <UserIcon size={13} />
                        Account Change
                      </span>
                      <StatusBadge status={request.status} size="sm" />
                    </div>
                    <h3 className="font-semibold text-slate-100">
                      {employee?.name || request.userName || 'Unknown Employee'}
                    </h3>
                    <p className="text-xs text-slate-400">
                      {request.requesterRole ? request.requesterRole.replace('_', ' ') : 'Unknown Role'} · Submitted: {request.submittedAt}
                    </p>
                  </div>
                </div>

                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Reason</p>
                  <p className="mt-1 text-xs leading-5 text-slate-300">{request.reason}</p>
                </div>

                {getAccountRequestedChanges(request).length > 0 && (
                  <div className="rounded-lg border border-white/10 bg-slate-950/40 p-3 text-xs">
                    <span className="block text-[10px] uppercase tracking-wider text-slate-500 mb-2">Requested Change</span>
                    <div className="space-y-1">
                      {getAccountRequestedChanges(request).map(({ field, value }) => (
                        <div key={field} className="flex items-baseline gap-2">
                          <span className="text-slate-500 w-24 shrink-0">{ACCOUNT_FIELD_LABELS[field] || field}:</span>
                          <span className={field === 'password' ? 'text-amber-400' : 'text-emerald-300'}>
                            {field === 'password' ? 'Password change requested' : value}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {renderAccountActions(request)}
              </div>
            );
          })}
        </div>
      )}

      {filteredApprovals.length === 0 &&
      filteredProjectApprovalRequests.length === 0 &&
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
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-500/30 bg-violet-500/10 px-2.5 py-1 text-[10px] font-semibold text-violet-300">
                        {TYPE_META[approval.type].icon}
                        {TYPE_META[approval.type].label}
                      </span>

                      <StatusBadge
                        status={approval.status}
                        size="sm"
                      />
                    </div>

                    <h3 className="truncate font-semibold text-slate-100">
                      {approval.targetTitle}
                    </h3>

                    <p className="text-xs text-slate-400">
                      Requested by{' '}
                      {requester?.name || 'Unknown'} (
                      {approval.requestedRole.replace(
                        '_',
                        ' '
                      )}
                      )
                      {project
                        ? ` · ${project.title}`
                        : ''}{' '}
                      · {approval.createdAt}
                    </p>
                  </div>
                </div>

                <p className="text-xs leading-5 text-slate-300">
                  {approval.details}
                </p>

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
    </section>
  );
};
