import React from 'react';
import { Users, UserRound, Calendar, Flame, Pencil, Trash2 } from 'lucide-react';
import { Project, ProjectStatus, TaskPriority, User } from '../../types';

interface ProjectCardProps {
  project: Project;
  teamLead?: User;
  isOverdue: boolean;
  manageable: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onClick?: () => void;
}

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
  manageable,
  onEdit,
  onDelete,
  onClick
}) => {
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
          {manageable && (
            <div className="flex items-center gap-0.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit();
                }}
                className="rounded-lg p-1 text-slate-500 hover:bg-white/10 hover:text-cyan-300"
                title="Edit project"
              >
                <Pencil size={12} />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete();
                }}
                className="rounded-lg p-1 text-slate-500 hover:bg-rose-500/10 hover:text-rose-400"
                title="Delete project"
              >
                <Trash2 size={12} />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Main: title is the focal point */}
      <div className="flex flex-col gap-2">
        <h3 className="text-xl font-semibold leading-snug tracking-tight text-white">{project.title}</h3>
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
