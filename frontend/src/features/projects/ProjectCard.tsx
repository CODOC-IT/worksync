import React from 'react';
import { Users, UserRound, Calendar, Flame, Pencil, Trash2, ArchiveRestore } from 'lucide-react';
import { Project, ProjectStatus, TaskPriority, User, UserRole } from '../../types';
import type { ProjectCardAction } from './projectActionRules';

interface ProjectCardProps {
  project: Project;
  teamLead?: User;
  isOverdue: boolean;
  actions: ProjectCardAction[];
  // Whose relationship to `project` the Led/Assigned/Unassigned badge below reflects. Team Lead
  // isn't a separate account role -- a Team_Member becomes a project's lead only via
  // project.teamLeadId -- so the badge is computed from that id comparison, never from role.
  currentUserId: string;
  currentRole: UserRole;
  onEdit: () => void;
  onDelete: () => void;
  onRestore?: () => void;
  onClick?: () => void;
}

// "Led" takes priority over "Assigned" per spec -- a project's lead is always also one of its
// members (project.mapper.ts's memberIds includes the TeamLead role), so checking lead first and
// returning immediately is what keeps the two labels mutually exclusive on a single card.
const membershipBadge = (
  project: Project,
  currentUserId: string
): { label: string; className: string } => {
  if (project.teamLeadId === currentUserId) {
    return { label: 'Led Project', className: 'border-violet-500/30 bg-violet-500/10 text-violet-300' };
  }
  if (project.memberIds.includes(currentUserId)) {
    return { label: 'Assigned', className: 'border-cyan-500/30 bg-cyan-500/10 text-cyan-300' };
  }
  return { label: 'Unassigned', className: 'border-slate-500/30 bg-slate-500/10 text-slate-400' };
};

const statusColor = (status: ProjectStatus): string => {
  switch (status) {
    case 'Active':
      return 'text-emerald-400';
    case 'Completed':
      return 'text-cyan-400';
    case 'Pending Approval':
    case 'On Hold':
      return 'text-amber-400';
    case 'Archived':
      return 'text-slate-500';
    default:
      return 'text-slate-400';
  }
};

const priorityColor = (priority?: TaskPriority): string => {
  switch (priority) {
    case 'Urgent':
      return 'text-rose-400';
    case 'High':
      return 'text-fuchsia-400';
    case 'Low':
      return 'text-slate-400';
    default:
      return 'text-amber-400';
  }
};

const formatShortDate = (iso: string): string => {
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

export const ProjectCard: React.FC<ProjectCardProps> = ({
  project,
  teamLead,
  isOverdue,
  actions,
  currentUserId,
  currentRole,
  onEdit,
  onDelete,
  onRestore,
  onClick
}) => {
  // Meaningless for Admin/HR -- neither can ever be a project's lead or member (see
  // ProjectsView.tsx's nonAdminUsers/assignableMembers), so every card would just read
  // "Unassigned" for them. Shown only for the two roles that can actually have this relationship.
  const membership =
    currentRole === 'Team_Lead' || currentRole === 'Team_Member'
      ? membershipBadge(project, currentUserId)
      : null;

  return (
    <div
      onClick={onClick}
      className="group flex cursor-pointer flex-col gap-5 rounded-2xl border border-white/10 bg-slate-900/40 p-6 transition-all duration-200 hover:-translate-y-0.5 hover:border-white/20 hover:bg-slate-900/60"
    >
      {/* Top: code + status, actions reveal on hover */}
      <div className="flex items-center justify-between gap-3">
        <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-slate-500">
          {project.code}
        </span>
        <div className="flex items-center gap-3">
          <span className={`flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide ${statusColor(project.status)}`}>
            {project.status}
            <span className={`h-1.5 w-1.5 rounded-full ${statusColor(project.status).replace('text-', 'bg-')}`} />
          </span>
          {actions.length > 0 && (
            <div className="flex items-center gap-0.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
              {actions.includes('restore') && onRestore && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onRestore();
                  }}
                  className="rounded-lg p-1 text-slate-500 hover:bg-emerald-500/10 hover:text-emerald-400"
                  title="Restore project"
                >
                  <ArchiveRestore size={12} />
                </button>
              )}
              {actions.includes('edit') && <button
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit();
                }}
                className="rounded-lg p-1 text-slate-500 hover:bg-white/10 hover:text-cyan-300"
                title="Edit project"
              >
                <Pencil size={12} />
              </button>}
              {(actions.includes('archive') || actions.includes('permanent-delete')) && <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete();
                }}
                className="rounded-lg p-1 text-slate-500 hover:bg-rose-500/10 hover:text-rose-400"
                title="Delete project"
              >
                <Trash2 size={12} />
              </button>}
            </div>
          )}
        </div>
      </div>

      {/* Main: title is the focal point */}
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-xl font-semibold leading-snug tracking-tight text-white">{project.title}</h3>
          {membership && (
            <span
              className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${membership.className}`}
            >
              {membership.label}
            </span>
          )}
        </div>
        <p className="text-sm leading-relaxed text-slate-400 line-clamp-2">{project.description}</p>
      </div>

      {/* Meta: a single wrapped strip of facts, not a stacked field list */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-white/5 pt-4 text-xs text-slate-400">
        <span className="flex items-center gap-1.5">
          <Users size={13} className="text-slate-500" />
          {project.memberIds.length} member{project.memberIds.length !== 1 ? 's' : ''}
        </span>

        <span className={`flex items-center gap-1.5 ${isOverdue ? 'font-medium text-rose-400' : ''}`}>
          <Calendar size={13} className={isOverdue ? 'text-rose-400' : 'text-slate-500'} />
          {formatShortDate(project.targetDate)}
        </span>

        {project.priority && (
          <span className={`flex items-center gap-1.5 font-medium ${priorityColor(project.priority)}`}>
            <Flame size={13} />
            {project.priority} Priority
          </span>
        )}

        <span className="flex items-center gap-1.5">
          <UserRound size={13} className="text-slate-500" />
          {teamLead?.name || 'Unassigned'}
        </span>
      </div>
    </div>
  );
};
