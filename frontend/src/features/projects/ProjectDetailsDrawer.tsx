import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  X,
  Calendar,
  Flame,
  Users,
  UserRound,
  Target,
  Paperclip,
  StickyNote,
  CheckCircle2,
  Circle,
  Download
} from 'lucide-react';
import { Project, ProjectFile, ProjectStatus, TaskPriority, User } from '../../types';
import { fetchProjectFileBlob } from './projectRepository';

interface ProjectDetailsDrawerProps {
  project: Project | null;
  users: User[];
  onClose: () => void;
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
  <p className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
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

export const ProjectDetailsDrawer: React.FC<ProjectDetailsDrawerProps> = ({ project, users, onClose }) => {
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

  const [pendingFileId, setPendingFileId] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

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
            className="ml-auto flex h-full w-full max-w-md flex-col border-l border-white/10 bg-slate-950 shadow-2xl sm:max-w-lg"
          >
            {/* Header */}
            <div className="flex items-start justify-between gap-3 border-b border-white/10 bg-slate-900/60 p-5">
              <div className="min-w-0">
                <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  {project.code}
                </span>
                <h2 className="mt-1 truncate text-xl font-semibold leading-snug tracking-tight text-white">
                  {project.title}
                </h2>
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
            <div className="flex-1 space-y-6 overflow-y-auto p-5 text-sm">
              {/* Status + priority */}
              <div className="flex flex-wrap items-center gap-3">
                <span
                  className={`flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide ${statusColor(project.status)}`}
                >
                  {project.status}
                  <span className={`h-1.5 w-1.5 rounded-full ${statusColor(project.status).replace('text-', 'bg-')}`} />
                </span>
                {project.priority && (
                  <span
                    className={`flex items-center gap-1.5 text-[11px] font-medium ${priorityColor(project.priority)}`}
                  >
                    <Flame size={12} />
                    {project.priority} Priority
                  </span>
                )}
              </div>

              {/* Full description */}
              <div>
                <SectionLabel>Description</SectionLabel>
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-300">{project.description}</p>
              </div>

              {/* Start / deadline */}
              <div className="grid grid-cols-2 gap-4">
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

              {/* Team lead */}
              <Field label="Team Lead">
                <span className="flex items-center gap-1.5">
                  <UserRound size={13} className="text-slate-500" />
                  {teamLead?.name || 'Unassigned'}
                </span>
              </Field>

              {/* Members */}
              <div>
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
                        <span className="flex items-center gap-1.5 text-slate-200">
                          {m.name}
                          {project?.pendingRemovalMemberIds?.includes(m.id) && (
                            <span
                              className="text-[9px] font-semibold uppercase tracking-wide text-amber-400 border border-amber-500/40 rounded px-1 py-0.5"
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

              {/* Milestones */}
              <div>
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
              <div>
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
              <div>
                <SectionLabel icon={<StickyNote size={12} />}>Creation Reason / Notes</SectionLabel>
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-300">
                  {project.creationReason || 'No notes provided.'}
                </p>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
