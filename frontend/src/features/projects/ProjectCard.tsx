import React from 'react';
import { Users, UserRound, Calendar, Flag, Pencil, Trash2, ArchiveRestore } from 'lucide-react';
import { Project, ProjectStatus, TaskPriority, User } from '../../types';
import type { ProjectCardAction } from './projectActionRules';

interface ProjectCardProps {
  project: Project;
  teamLead?: User;
  isOverdue: boolean;
  actions: ProjectCardAction[];
  onEdit: () => void;
  onDelete: () => void;
  onRestore?: () => void;
  onClick?: () => void;
}

const statusColor = (status: ProjectStatus): string => {
  switch (status) {
    case 'Active': return 'text-emerald-400';
    case 'Completed': return 'text-cyan-400';
    case 'Pending Approval':
    case 'On Hold': return 'text-amber-400';
    case 'Archived': return 'text-slate-500';
    default: return 'text-slate-400';
  }
};

const priorityStyle = (priority?: TaskPriority): string => {
  switch (priority) {
    case 'Urgent': return 'bg-rose-400/15 text-rose-200 ring-1 ring-inset ring-rose-300/20';
    case 'High': return 'bg-orange-400/15 text-orange-200 ring-1 ring-inset ring-orange-300/20';
    case 'Low': return 'bg-slate-400/15 text-slate-300 ring-1 ring-inset ring-slate-300/15';
    default: return 'bg-amber-400/15 text-amber-200 ring-1 ring-inset ring-amber-300/20';
  }
};

const formatShortDate = (iso: string): string => {
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

export const ProjectCard: React.FC<ProjectCardProps> = ({
  project, teamLead, isOverdue, actions, onEdit, onDelete, onRestore, onClick
}) => (
  <div
    onClick={onClick}
    className="group grid min-h-[380px] h-full cursor-pointer grid-rows-[auto_minmax(190px,1fr)_auto] rounded-2xl border border-white/10 bg-slate-900/55 p-7 transition-colors duration-200 hover:border-white/20 hover:bg-slate-900/70 lg:p-8"
  >
    {/* Header zone: action space remains reserved so the status never shifts on hover. */}
    <div className="flex min-h-8 items-start justify-between gap-3">
      <span className="pt-1 font-mono text-[11px] font-semibold uppercase tracking-wider text-slate-500">
        {project.code}
      </span>
      <div className="flex shrink-0 items-center gap-2">
        <span className={`flex items-center gap-1.5 whitespace-nowrap text-[11px] font-semibold uppercase tracking-wide ${statusColor(project.status)}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${statusColor(project.status).replace('text-', 'bg-')}`} />
          {project.status}
        </span>
        {actions.length > 0 && (
          <div className="flex min-w-[52px] items-center justify-end gap-0.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
            {actions.includes('restore') && onRestore && (
              <button type="button" onClick={(event) => { event.stopPropagation(); onRestore(); }} className="rounded-lg p-1.5 text-slate-500 hover:bg-emerald-500/10 hover:text-emerald-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70" title="Restore project" aria-label="Restore project">
                <ArchiveRestore size={14} />
              </button>
            )}
            {actions.includes('edit') && (
              <button type="button" onClick={(event) => { event.stopPropagation(); onEdit(); }} className="rounded-lg p-1.5 text-slate-500 hover:bg-white/10 hover:text-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70" title="Edit project" aria-label={`Edit ${project.title}`}>
                <Pencil size={14} />
              </button>
            )}
            {(actions.includes('archive') || actions.includes('permanent-delete')) && (
              <button type="button" onClick={(event) => { event.stopPropagation(); onDelete(); }} className="rounded-lg p-1.5 text-slate-500 hover:bg-rose-500/10 hover:text-rose-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70" title={project.status === 'Archived' ? 'Permanently delete project' : 'Archive project'} aria-label={project.status === 'Archived' ? `Permanently delete ${project.title}` : `Archive ${project.title}`}>
                <Trash2 size={14} />
              </button>
            )}
          </div>
        )}
      </div>
    </div>

    {/* Main information zone with reserved title and description space. */}
    <div className="pt-5">
      <h3 className="min-h-14 text-xl font-semibold leading-7 tracking-tight text-white line-clamp-2">{project.title}</h3>
      <div className="mt-3 min-h-7">
        {project.priority && (
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${priorityStyle(project.priority)}`}>
            <Flag size={12} /> {project.priority} Priority
          </span>
        )}
      </div>
      <p className="mt-4 min-h-[4.5rem] text-sm leading-6 text-slate-400 line-clamp-3">{project.description}</p>
    </div>

    {/* Details zone stays pinned at the same vertical position across cards. */}
    <div className="min-h-32 border-t border-white/10 pt-5">
      <div className="grid grid-cols-1 gap-4 min-[420px]:grid-cols-2">
        <div className="flex items-start gap-2.5">
          <Users size={15} className="mt-0.5 text-slate-500" />
          <div><p className="text-[11px] text-slate-500">Members</p><p className="mt-0.5 text-sm font-medium text-slate-200">{project.memberIds.length} member{project.memberIds.length !== 1 ? 's' : ''}</p></div>
        </div>
        <div className={`flex items-start gap-2.5 ${isOverdue ? 'text-rose-300' : ''}`}>
          <Calendar size={15} className={`mt-0.5 ${isOverdue ? 'text-rose-400' : 'text-slate-500'}`} />
          <div><p className="text-[11px] text-slate-500">Due date</p><p className="mt-0.5 text-sm font-medium">{formatShortDate(project.targetDate)}</p></div>
        </div>
      </div>
      <div className="mt-5 flex items-start gap-2.5">
        <UserRound size={15} className="mt-0.5 text-slate-500" />
        <div><p className="text-[11px] text-slate-500">Project lead</p><p className="mt-0.5 text-sm font-medium text-slate-200">{teamLead?.name || 'Not assigned'}</p></div>
      </div>
    </div>
  </div>
);
