import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  X,
  Calendar,
  Flag,
  Users,
  UserRound,
  Target,
  Paperclip,
  StickyNote,
  CheckCircle2,
  Circle,
  Download,
  ClipboardList,
  ArrowRight
} from 'lucide-react';
import { Project, ProjectFile, ProjectStatus, Task, TaskPriority, User } from '../../types';
import { fetchProjectFileBlob } from './projectRepository';
import { canManageProjectTeams } from './projectActionRules';
import { useApp } from '../../store/AppContext';

interface ProjectDetailsDrawerProps {
  project: Project | null;
  users: User[];
  tasks: Task[];
  onClose: () => void;
  onViewTasks: (projectId: string) => void;
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

const priorityStyle = (priority?: TaskPriority): string => {
  switch (priority) {
    case 'Urgent': return 'bg-rose-400/15 text-rose-200 ring-1 ring-inset ring-rose-300/20';
    case 'High': return 'bg-orange-400/15 text-orange-200 ring-1 ring-inset ring-orange-300/20';
    case 'Low': return 'bg-slate-400/15 text-slate-300 ring-1 ring-inset ring-slate-300/15';
    default: return 'bg-amber-400/15 text-amber-200 ring-1 ring-inset ring-amber-300/20';
  }
};

const statusPillStyle = (status: ProjectStatus): string => {
  switch (status) {
    case 'Pending Approval': return 'bg-amber-400/15 text-amber-200 ring-1 ring-inset ring-amber-300/20';
    case 'Active': return 'bg-emerald-400/15 text-emerald-200 ring-1 ring-inset ring-emerald-300/20';
    case 'Completed': return 'bg-cyan-400/15 text-cyan-200 ring-1 ring-inset ring-cyan-300/20';
    case 'Archived': return 'bg-slate-400/15 text-slate-300 ring-1 ring-inset ring-slate-300/15';
    default: return 'bg-amber-400/15 text-amber-200 ring-1 ring-inset ring-amber-300/20';
  }
};

const formatFullDate = (iso: string): string => {
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

// project.files[].size is raw bytes (matches the backend's ProjectFileDTO) -- mirrors
// ProjectsView.tsx's own formatBytes for the same display convention.
const formatBytes = (bytes: number): string => {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const SectionLabel: React.FC<{ icon?: React.ReactNode; children: React.ReactNode }> = ({ icon, children }) => (
  <p className="mb-3 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-300">
    {icon}
    {children}
  </p>
);

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div>
    <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">{label}</p>
    <div className="text-sm text-slate-200">{children}</div>
  </div>
);

export const ProjectDetailsDrawer: React.FC<ProjectDetailsDrawerProps> = ({ project, users, tasks, onClose, onViewTasks }) => {
  const { currentRole, moveProjectMember, replaceProjectTeamLead } = useApp();
  // Moving a member between teams / replacing a team's lead are Admin-only actions -- the backend
  // rejects anyone else (project.service.ts's assertCanManageMembers), so the controls are simply
  // never rendered for a Team Lead or a plain member, matching how the rest of this app hides
  // actions a role can't perform rather than showing them disabled.
  const isAdmin = canManageProjectTeams(currentRole);

  useEffect(() => {
    if (!project) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [project, onClose]);

  const teamLead = project ? users.find((u) => u.id === project.teamLeadId) : undefined;
  const members = project ? project.memberIds.map((id) => users.find((u) => u.id === id)).filter(Boolean) as User[] : [];
  const projectTasks = project ? tasks.filter((task) => task.projectId === project.id) : [];

  const [pendingFileId, setPendingFileId] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  // Admin team-management controls (move member / replace Team Lead). Reset whenever the drawer
  // is pointed at a different project so stale in-progress state from a previous project's teams
  // can't leak into this one.
  const [movingMemberId, setMovingMemberId] = useState<string | null>(null);
  const [teamActionError, setTeamActionError] = useState<string | null>(null);
  const [replacingLeadTeamId, setReplacingLeadTeamId] = useState<string | null>(null);
  const [replacementLeadId, setReplacementLeadId] = useState('');
  const [replaceLeadSubmitting, setReplaceLeadSubmitting] = useState(false);

  useEffect(() => {
    setMovingMemberId(null);
    setTeamActionError(null);
    setReplacingLeadTeamId(null);
    setReplacementLeadId('');
    setReplaceLeadSubmitting(false);
  }, [project?.id]);

  const handleMoveMember = async (memberId: string, toTeamId: string) => {
    if (!project || !toTeamId) return;
    setMovingMemberId(memberId);
    setTeamActionError(null);
    const result = await moveProjectMember(project.id, memberId, toTeamId);
    if (!result.success) setTeamActionError(result.message);
    setMovingMemberId(null);
  };

  const openReplaceLead = (teamId: string) => {
    setReplacingLeadTeamId(teamId);
    setReplacementLeadId('');
    setTeamActionError(null);
  };

  const closeReplaceLead = () => {
    if (replaceLeadSubmitting) return;
    setReplacingLeadTeamId(null);
    setReplacementLeadId('');
  };

  const confirmReplaceLead = async () => {
    if (!project || !replacingLeadTeamId || !replacementLeadId) return;
    setReplaceLeadSubmitting(true);
    setTeamActionError(null);
    const result = await replaceProjectTeamLead(project.id, replacingLeadTeamId, replacementLeadId);
    setReplaceLeadSubmitting(false);
    if (!result.success) {
      setTeamActionError(result.message);
      return;
    }
    setReplacingLeadTeamId(null);
    setReplacementLeadId('');
  };

  // How long to keep the object URL alive after opening it in a new tab. Unlike the download flow
  // (where the browser starts consuming the blob synchronously on anchor.click(), so it's safe to
  // revoke on the next tick), a new tab has to navigate to and fetch the blob URL first -- revoking
  // immediately would race that and can blank out the tab before it finishes loading. Revoking
  // eagerly on click/download is inline with the anchor-click pattern; this timer is the equivalent
  // "done being used" signal for the open-in-new-tab path.
  const OPEN_OBJECT_URL_REVOKE_DELAY_MS = 30000;

  // Opens the attachment in a new tab (browser renders supported types like PDF/images inline;
  // anything else falls back to its own download-or-view default) using an authenticated blob
  // fetch, since a plain <a href> can't carry the Bearer token the backend route requires.
  const handleOpenFile = async (file: ProjectFile) => {
    if (!project) return;
    setFileError(null);
    setPendingFileId(file.id);
    try {
      const { objectUrl, revoke } = await fetchProjectFileBlob(project.id, file.id, 'open');
      window.open(objectUrl, '_blank', 'noopener,noreferrer');
      window.setTimeout(revoke, OPEN_OBJECT_URL_REVOKE_DELAY_MS);
    } catch (error) {
      setFileError((error as Error).message || 'Could not open attachment.');
    } finally {
      setPendingFileId(null);
    }
  };

  const handleDownloadFile = async (file: ProjectFile) => {
    if (!project) return;
    setFileError(null);
    setPendingFileId(file.id);
    try {
      const { objectUrl, revoke } = await fetchProjectFileBlob(project.id, file.id, 'download');
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = file.name;
      anchor.style.display = 'none';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(revoke, 0);
    } catch (error) {
      setFileError((error as Error).message || 'Could not download attachment.');
    } finally {
      setPendingFileId(null);
    }
  };

  return (
    <AnimatePresence>
      {project && (
        <motion.div
          key="drawer-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-md"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
        >
          <motion.div
            key="drawer-panel"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', stiffness: 320, damping: 34 }}
            className="ml-auto flex h-full w-full max-w-md flex-col overflow-hidden border-l border-white/10 bg-slate-950 shadow-2xl sm:max-w-lg"
          >
            {/* Header */}
            <div className="flex items-start justify-between gap-3 border-b border-white/10 bg-slate-900/60 p-5">
              <div className="min-w-0">
                <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  {project.code}
                </span>
                <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2">
                  <h2 className="min-w-0 break-words text-xl font-semibold leading-snug tracking-tight text-white [overflow-wrap:anywhere]">
                    {project.title}
                  </h2>
                  <span className={`inline-flex max-w-full items-center gap-1.5 break-words rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide [overflow-wrap:anywhere] ${statusPillStyle(project.status)}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${statusColor(project.status).replace('text-', 'bg-')}`} />
                    {project.status}
                  </span>
                </div>
              </div>
              <button
                onClick={onClose}
                className="shrink-0 rounded-lg p-2 text-slate-400 hover:bg-white/10 hover:text-white"
                aria-label="Close project details"
              >
                <X size={18} />
              </button>
            </div>

            {/* Scrollable body */}
            <div className="flex-1 space-y-5 overflow-x-hidden overflow-y-auto p-5 text-sm">
              {project.priority && (
                <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${priorityStyle(project.priority)}`}>
                  <Flag size={12} /> {project.priority} Priority
                </span>
              )}

              {/* Full description */}
              <div className="rounded-xl border border-white/10 bg-slate-900/35 p-4">
                <SectionLabel>Description</SectionLabel>
                <p className="break-words whitespace-pre-wrap text-sm leading-relaxed text-slate-300 [overflow-wrap:anywhere]">{project.description}</p>
              </div>

              {/* Start / deadline */}
              <div className="grid grid-cols-1 gap-3 rounded-xl border border-white/10 bg-slate-900/35 p-4 sm:grid-cols-2">
                <Field label="Start Date">
                  <span className="flex items-center gap-1.5">
                    <Calendar size={13} className="text-slate-500" />
                    {formatFullDate(project.startDate)}
                  </span>
                </Field>
                <Field label="Deadline">
                  <span className="flex items-center gap-1.5">
                    <Calendar size={13} className="text-slate-500" />
                    {formatFullDate(project.targetDate)}
                  </span>
                </Field>
              </div>

              {/* Team lead -- only for a project with no team structure of its own (created before
                  the multi-team architecture existed). A project with teams shows its per-team
                  leads in the "Teams" section below instead; there is no single overall "Project
                  Lead" to show once teams exist (req. 6). */}
              {project.teams.length === 0 && (
                <div className="rounded-xl border border-white/10 bg-slate-900/35 p-4">
                  <SectionLabel icon={<UserRound size={13} className="text-cyan-300" />}>Team Lead</SectionLabel>
                  <p className="text-sm font-medium text-slate-200">{teamLead?.name || 'Unassigned'}</p>
                  {teamLead?.title && <p className="mt-1 text-xs text-slate-500">{teamLead.title}</p>}
                </div>
              )}

              {/* Members */}
              <div className="rounded-xl border border-white/10 bg-slate-900/35 p-4">
                <SectionLabel icon={<Users size={12} />}>
                  Members <span className="normal-case text-slate-600">({members.length})</span>
                </SectionLabel>
                {members.length > 0 ? (
                  <div className="flex flex-col gap-1.5">
                    {members.map((m) => (
                      <div
                        key={m.id}
                        className="flex items-center justify-between rounded-lg border border-white/10 bg-black/30 px-3 py-2"
                      >
                        <span className="flex min-w-0 items-center gap-1.5 break-words text-slate-200 [overflow-wrap:anywhere]">
                          {m.name}
                          {project?.pendingRemovalMemberIds?.includes(m.id) && (
                            <span
                              className="inline-flex shrink-0 items-center justify-center rounded-full bg-amber-400/15 px-2 py-1 text-center text-[9px] font-bold uppercase tracking-wide text-amber-200 ring-1 ring-inset ring-amber-300/20"
                              title="Still has active tasks/subtasks -- kept in the project until that work is resolved."
                            >
                              Pending Removal
                            </span>
                          )}
                        </span>
                        <span className="text-[11px] text-slate-500">{m.title}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-slate-500">No members assigned.</p>
                )}
              </div>

              {/* Teams (multi-team architecture) */}
              {project.teams.length > 0 && (
                <div className="rounded-xl border border-white/10 bg-slate-900/35 p-4">
                  <SectionLabel icon={<Users size={12} />}>
                    Teams <span className="normal-case text-slate-600">({project.teams.length})</span>
                  </SectionLabel>
                  <div className="flex flex-col gap-2">
                    {project.teams.map((team) => {
                      const lead = users.find((u) => u.id === team.leadId);
                      // Replacement candidates: any other active project member, per the backend's
                      // own rule (project.service.ts's replaceTeamLead) -- not limited to this
                      // team, and not the team's current lead (replacing a lead with themselves is
                      // rejected server-side anyway, so it's left out of the picker entirely).
                      const replacementCandidates = project.memberIds
                        .filter((id) => id !== team.leadId)
                        .map((id) => users.find((u) => u.id === id))
                        .filter((u): u is User => Boolean(u));
                      const otherTeams = project.teams.filter((t) => t.id !== team.id);

                      return (
                        <div key={team.id} className="rounded-lg border border-white/10 bg-black/30 p-3">
                          <p className="text-sm font-semibold text-slate-100">{team.name}</p>
                          <p className="mt-0.5 text-xs text-slate-500">{team.description}</p>

                          <div className="mt-1.5 flex items-center justify-between gap-2">
                            <p className="text-xs text-slate-300">
                              <span className="text-cyan-300">Lead:</span> {lead?.name || 'Unassigned'}
                            </p>
                            {isAdmin && replacingLeadTeamId !== team.id && (
                              <button
                                type="button"
                                onClick={() => openReplaceLead(team.id)}
                                className="shrink-0 text-[11px] font-semibold text-cyan-300 hover:text-cyan-200"
                              >
                                Replace
                              </button>
                            )}
                          </div>

                          {isAdmin && replacingLeadTeamId === team.id && (
                            <div className="mt-2 flex items-center gap-1.5">
                              <select
                                value={replacementLeadId}
                                onChange={(e) => setReplacementLeadId(e.target.value)}
                                aria-label={`Select a replacement Team Lead for ${team.name}`}
                                disabled={replaceLeadSubmitting}
                                className="min-w-0 flex-1 rounded-md border border-white/10 bg-black/40 px-2 py-1 text-[11px] text-slate-200 focus:outline-none focus:border-cyan-500/50 disabled:opacity-60"
                              >
                                <option value="">Select replacement...</option>
                                {replacementCandidates.map((candidate) => (
                                  <option key={candidate.id} value={candidate.id}>{candidate.name}</option>
                                ))}
                              </select>
                              <button
                                type="button"
                                onClick={confirmReplaceLead}
                                disabled={!replacementLeadId || replaceLeadSubmitting}
                                className="shrink-0 rounded-md bg-cyan-500/20 px-2 py-1 text-[11px] font-semibold text-cyan-200 hover:bg-cyan-500/30 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {replaceLeadSubmitting ? 'Saving...' : 'Confirm'}
                              </button>
                              <button
                                type="button"
                                onClick={closeReplaceLead}
                                disabled={replaceLeadSubmitting}
                                className="shrink-0 rounded-md p-1 text-slate-400 hover:bg-white/10 hover:text-white disabled:opacity-50"
                                aria-label="Cancel replacing the Team Lead"
                              >
                                <X size={12} />
                              </button>
                            </div>
                          )}

                          <div className="mt-1.5 flex flex-col gap-1">
                            <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Members</span>
                            {team.memberIds.map((id) => {
                              const member = users.find((u) => u.id === id);
                              return (
                                <div key={id} className="flex items-center justify-between gap-2 text-xs text-slate-300">
                                  <span className="min-w-0 truncate">{member?.name || id}</span>
                                  {isAdmin && otherTeams.length > 0 && (
                                    <select
                                      value=""
                                      onChange={(e) => void handleMoveMember(id, e.target.value)}
                                      aria-label={`Move ${member?.name || id} to another team`}
                                      disabled={movingMemberId === id}
                                      className="shrink-0 rounded-md border border-white/10 bg-black/40 px-1.5 py-0.5 text-[10px] text-slate-300 focus:outline-none focus:border-cyan-500/50 disabled:opacity-60"
                                    >
                                      <option value="">
                                        {movingMemberId === id ? 'Moving...' : 'Move to...'}
                                      </option>
                                      {otherTeams.map((target) => (
                                        <option key={target.id} value={target.id}>{target.name}</option>
                                      ))}
                                    </select>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {teamActionError && (
                    <p className="mt-2 text-xs text-rose-400">{teamActionError}</p>
                  )}
                </div>
              )}

              {/* Milestones */}
              <div className="rounded-xl border border-white/10 bg-slate-900/35 p-4">
                <SectionLabel icon={<Target size={12} />}>
                  Milestones <span className="normal-case text-slate-600">({project.milestones.length})</span>
                </SectionLabel>
                {project.milestones.length > 0 ? (
                  <div className="flex flex-col gap-1.5">
                    {project.milestones.map((m) => (
                      <div
                        key={m.id}
                        className="flex items-center justify-between rounded-lg border border-white/10 bg-black/30 px-3 py-2"
                      >
                        <span className="flex items-center gap-2 text-slate-200">
                          {m.completed ? (
                            <CheckCircle2 size={14} className="shrink-0 text-emerald-400" />
                          ) : (
                            <Circle size={14} className="shrink-0 text-slate-500" />
                          )}
                          {m.title || 'Untitled milestone'}
                        </span>
                        <span className="shrink-0 pl-2 text-[11px] text-slate-500">
                          {m.dueDate ? formatFullDate(m.dueDate) : '—'}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-slate-500">No milestones added.</p>
                )}
              </div>

              {/* Files */}
              <div className="rounded-xl border border-white/10 bg-slate-900/35 p-4">
                <SectionLabel icon={<Paperclip size={12} />}>
                  Files <span className="normal-case text-slate-600">({project.files.length})</span>
                </SectionLabel>
                {project.files.length > 0 ? (
                  <div className="flex flex-col gap-1.5">
                    {project.files.map((f) => {
                      const uploader = users.find((u) => u.id === f.uploadedBy);
                      const isPending = pendingFileId === f.id;
                      return (
                        <div
                          key={f.id}
                          className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-black/30 px-3 py-2"
                        >
                          <button
                            type="button"
                            onClick={() => handleOpenFile(f)}
                            disabled={isPending}
                            title={`Open ${f.name}`}
                            className="min-w-0 truncate text-left text-slate-200 hover:text-cyan-300 hover:underline disabled:cursor-wait disabled:opacity-60"
                          >
                            {f.name}
                          </button>
                          <span className="flex shrink-0 items-center gap-2 pl-2 text-[11px] text-slate-500">
                            {formatBytes(f.size)} · {uploader?.name || 'Unknown'}
                            <button
                              type="button"
                              onClick={() => handleDownloadFile(f)}
                              disabled={isPending}
                              aria-label={`Download ${f.name}`}
                              title="Download"
                              className="rounded p-1 text-slate-400 hover:bg-white/10 hover:text-white disabled:cursor-wait disabled:opacity-60"
                            >
                              <Download size={13} />
                            </button>
                          </span>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-slate-500">No files attached.</p>
                )}
                {fileError && <p className="mt-1.5 text-xs text-rose-400">{fileError}</p>}
              </div>

              {/* Notes */}
              <div className="rounded-xl border border-white/10 bg-slate-900/35 p-4">
                <SectionLabel icon={<StickyNote size={12} />}>Creation Reason / Notes</SectionLabel>
                <p className="break-words whitespace-pre-wrap text-sm leading-relaxed text-slate-300 [overflow-wrap:anywhere]">
                  {project.creationReason || 'No notes provided.'}
                </p>
              </div>

              {/* Project tasks */}
              <div className="rounded-xl border border-white/10 bg-slate-900/35 p-4">
                <div className="flex items-start justify-between gap-3">
                  <SectionLabel icon={<ClipboardList size={12} />}>
                    Tasks <span className="normal-case text-slate-500">({projectTasks.length})</span>
                  </SectionLabel>
                  <button
                    type="button"
                    onClick={() => onViewTasks(project.id)}
                    className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-cyan-400/25 bg-cyan-400/10 px-2.5 py-1.5 text-[11px] font-semibold text-cyan-200 hover:bg-cyan-400/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70"
                  >
                    Show task details <ArrowRight size={12} />
                  </button>
                </div>
                {projectTasks.length > 0 ? (
                  <ol className="mt-1 space-y-2">
                    {projectTasks.map((task, index) => (
                      <li key={task.id} className="flex gap-2 text-sm text-slate-300">
                        <span className="w-5 shrink-0 text-right font-mono text-xs text-slate-500">{index + 1}.</span>
                        <span>{task.title}</span>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="text-xs text-slate-500">No tasks have been created for this project.</p>
                )}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
