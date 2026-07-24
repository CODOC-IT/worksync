import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  FolderKanban,
  Pencil,
  Plus,
  X,
  XCircle
} from 'lucide-react';
import { useApp } from '../../store/AppContext';
import { StatusBadge } from '../../components/common/StatusBadge';
import { Project, SystemApproval, Task } from '../../types';

type StatusFilter = 'Pending' | 'Approved' | 'Rejected' | 'All';
type TypeFilter = 'All' | SystemApproval['type'];

const TYPE_META: Record<SystemApproval['type'], { label: string; icon: React.ReactNode }> = {
  Project_Creation: { label: 'Project Creation', icon: <FolderKanban size={13} /> },
  Task_Creation: { label: 'Task Creation', icon: <Plus size={13} /> },
  Controlled_Edit: { label: 'Controlled Edit', icon: <Pencil size={13} /> }
};

// The approval a request targets: a Project id directly for Project_Creation, or the
// project owning the task for Task_Creation / Controlled_Edit (whose targetId is a taskId).
const getApprovalProject = (
  approval: SystemApproval,
  projects: Project[],
  tasks: Task[]
): Project | undefined => {
  if (approval.type === 'Project_Creation') {
    return projects.find((project) => project.id === approval.targetId);
  }
  const task = tasks.find((item) => item.id === approval.targetId);
  return task ? projects.find((project) => project.id === task.projectId) : undefined;
};

// Admin can decide anything. A Team Lead can only decide requests tied to a project they
// lead, and never their own project-creation proposals (those route to Admin by design —
// see AppContext.createProject).
const canDecide = (
  role: 'Admin' | 'Team_Lead',
  userId: string,
  approval: SystemApproval,
  project: Project | undefined
): boolean => {
  if (role === 'Admin') return true;
  if (approval.type === 'Project_Creation') return false;
  return Boolean(project && project.teamLeadId === userId);
};

export const ApprovalsInboxView: React.FC = () => {
  const {
    currentRole,
    currentUser,
    projects,
    tasks,
    users,
    systemApprovals,
    approveApprovalItem,
    rejectApprovalItem
  } = useApp();

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('Pending');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('All');
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const isPrivilegedRole = currentRole === 'Admin' || currentRole === 'Team_Lead';

  const visibleApprovals = useMemo(() => {
    if (!isPrivilegedRole) return [];
    return systemApprovals.filter((approval) => {
      const project = getApprovalProject(approval, projects, tasks);
      const isDecidable = canDecide(currentRole as 'Admin' | 'Team_Lead', currentUser.id, approval, project);
      // Team Leads also see their own submitted requests (read-only) so they can track status.
      const isOwnRequest = approval.requestedBy === currentUser.id;
      return isDecidable || isOwnRequest;
    });
  }, [systemApprovals, projects, tasks, currentRole, currentUser.id, isPrivilegedRole]);

  const filteredApprovals = visibleApprovals.filter((approval) => {
    const matchesStatus = statusFilter === 'All' || approval.status === statusFilter;
    const matchesType = typeFilter === 'All' || approval.type === typeFilter;
    return matchesStatus && matchesType;
  });

  const pendingCount = visibleApprovals.filter((approval) => approval.status === 'Pending').length;

  const handleApprove = (approval: SystemApproval) => {
    approveApprovalItem(approval.id);
    setNotice({ type: 'success', message: `Approved "${approval.targetTitle}".` });
  };

  const handleReject = (approval: SystemApproval) => {
    if (!window.confirm(`Reject "${approval.targetTitle}"? This cannot be undone.`)) return;
    rejectApprovalItem(approval.id);
    setNotice({ type: 'success', message: `Rejected "${approval.targetTitle}".` });
  };

  if (!isPrivilegedRole) {
    return (
      <section className="mx-auto max-w-3xl">
        <div className="glass-panel flex min-h-52 flex-col items-center justify-center px-6 text-center">
          <AlertTriangle className="text-slate-500" size={26} />
          <h3 className="mt-3 font-semibold text-slate-200">Approvals Inbox is restricted</h3>
          <p className="mt-1 text-xs text-slate-500">
            Only Admin and Team Lead accounts can review pending approval requests.
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
          <h1 className="text-2xl font-bold text-white">Approvals Inbox</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-400">
            {currentRole === 'Admin'
              ? 'Review project creation, task creation and controlled edit requests across every project.'
              : 'Review requests for the projects you lead. Project creation proposals route to Admin.'}
          </p>
        </div>
        {pendingCount > 0 && (
          <span className="inline-flex shrink-0 items-center gap-2 self-start rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-300">
            <Clock size={13} />
            {pendingCount} pending decision{pendingCount !== 1 ? 's' : ''}
          </span>
        )}
      </header>

      {notice && (
        <div
          role="status"
          className="flex items-center justify-between rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300"
        >
          <span className="flex items-center gap-2">
            <Check size={16} />
            {notice.message}
          </span>
          <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss message">
            <X size={16} />
          </button>
        </div>
      )}

      <div className="glass-panel flex flex-wrap items-center gap-2 p-4">
        {(['Pending', 'Approved', 'Rejected', 'All'] as StatusFilter[]).map((status) => (
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
        {(['All', 'Project_Creation', 'Task_Creation', 'Controlled_Edit'] as TypeFilter[]).map((type) => (
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
            {type === 'All' ? 'All types' : TYPE_META[type].label}
          </button>
        ))}
      </div>

      {filteredApprovals.length === 0 ? (
        <div className="glass-panel flex min-h-52 flex-col items-center justify-center px-6 text-center">
          <CheckCircle2 className="text-slate-500" size={26} />
          <h3 className="mt-3 font-semibold text-slate-200">Nothing here</h3>
          <p className="mt-1 text-xs text-slate-500">No requests match the current filters.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredApprovals.map((approval) => {
            const project = getApprovalProject(approval, projects, tasks);
            const requester = users.find((user) => user.id === approval.requestedBy);
            const decidable = canDecide(currentRole as 'Admin' | 'Team_Lead', currentUser.id, approval, project) && approval.status === 'Pending';

            return (
              <div key={approval.id} className="glass-panel space-y-3 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-500/30 bg-violet-500/10 px-2.5 py-1 text-[10px] font-semibold text-violet-300">
                        {TYPE_META[approval.type].icon}
                        {TYPE_META[approval.type].label}
                      </span>
                      <StatusBadge status={approval.status} size="sm" />
                    </div>
                    <h3 className="truncate font-semibold text-slate-100">{approval.targetTitle}</h3>
                    <p className="text-xs text-slate-400">
                      Requested by {requester?.name || 'Unknown'} ({approval.requestedRole.replace('_', ' ')})
                      {project ? ` · ${project.title}` : ''} · {approval.createdAt}
                    </p>
                  </div>
                </div>

                <p className="text-xs leading-5 text-slate-300">{approval.details}</p>

                {approval.proposedDiff && (
                  <div className="rounded-lg border border-white/10 bg-slate-950/40 p-3 text-xs text-slate-300">
                    <span className="block text-[10px] uppercase tracking-wider text-slate-500">
                      Proposed change &mdash; {approval.proposedDiff.field}
                    </span>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <span className="rounded-md bg-white/5 px-2 py-1 line-through decoration-rose-400/60">
                        {approval.proposedDiff.oldValue}
                      </span>
                      <span className="text-slate-500">&rarr;</span>
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
                      onClick={() => handleReject(approval)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-xs font-semibold text-rose-300 transition hover:bg-rose-500/20"
                    >
                      <XCircle size={14} />
                      Reject
                    </button>
                    <button
                      type="button"
                      onClick={() => handleApprove(approval)}
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
    </section>
  );
};
