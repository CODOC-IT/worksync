import React, { useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, FolderKanban, CheckSquare } from 'lucide-react';
import { Project, Task } from '../../types';
import { StatusBadge } from '../../components/common/StatusBadge';
import { CalendarEntry, entryOrigin, entryToneClasses, parseDateKey } from './calendarRules';

const OriginIcon: React.FC<{ entry: CalendarEntry }> = ({ entry }) => {
  const origin = entryOrigin(entry);
  if (origin === 'project') return <FolderKanban size={12} className="shrink-0 text-cyan-400" />;
  if (origin === 'task') return <CheckSquare size={12} className="shrink-0 text-purple-400" />;
  return null;
};

interface DayEntriesDrawerProps {
  dateKey: string | null;
  entries: CalendarEntry[];
  projects: Project[];
  tasks: Task[];
  expandedEntryId: string | null;
  onToggleEntry: (id: string) => void;
  onClose: () => void;
}

export const DayEntriesDrawer: React.FC<DayEntriesDrawerProps> = ({
  dateKey,
  entries,
  projects,
  tasks,
  expandedEntryId,
  onToggleEntry,
  onClose
}) => {
  useEffect(() => {
    if (!dateKey) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [dateKey, onClose]);

  const dateLabel = dateKey
    ? parseDateKey(dateKey).toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric'
      })
    : '';

  return (
    <AnimatePresence>
      {dateKey && (
        <motion.div
          key="day-entries-overlay"
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
            key="day-entries-panel"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', stiffness: 320, damping: 34 }}
            className="ml-auto flex h-full w-full max-w-md flex-col border-l border-white/10 bg-slate-950 shadow-2xl sm:max-w-lg"
          >
            {/* Header */}
            <div className="flex items-start justify-between gap-3 border-b border-white/10 bg-slate-900/60 p-5">
              <div className="min-w-0">
                <h3 className="truncate text-lg font-semibold leading-snug tracking-tight text-white">{dateLabel}</h3>
                <p className="mt-0.5 text-[11px] text-slate-400">
                  {entries.length} item{entries.length !== 1 ? 's' : ''}
                </p>
              </div>
              <button
                onClick={onClose}
                className="shrink-0 rounded-lg p-2 text-slate-400 hover:bg-white/10 hover:text-white"
                aria-label="Close day details"
              >
                <X size={18} />
              </button>
            </div>

            {/* Scrollable body */}
            <div className="flex-1 space-y-2 overflow-y-auto p-5">
              {entries.length === 0 && (
                <p className="py-6 text-center text-xs text-slate-500">No events scheduled for this day.</p>
              )}

              {entries.map((entry) => {
                const tone = entryToneClasses(entry.kind);
                const isExpanded = expandedEntryId === entry.id;
                const project = entry.projectId ? projects.find((p) => p.id === entry.projectId) : undefined;
                const task = entry.taskId ? tasks.find((t) => t.id === entry.taskId) : undefined;

                return (
                  <div key={entry.id} className="overflow-hidden rounded-lg border border-white/10 bg-black/30">
                    <button
                      type="button"
                      onClick={() => onToggleEntry(entry.id)}
                      className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <span
                          data-calendar-entry-kind={entry.kind}
                          className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold ${tone.badgeClass}`}
                        >
                          {entry.kind}
                        </span>
                        <OriginIcon entry={entry} />
                        <span className="truncate text-xs font-semibold text-slate-200">{entry.title}</span>
                      </div>
                      {entry.time && <span className="shrink-0 font-mono text-[10px] text-slate-400">{entry.time}</span>}
                    </button>

                    {isExpanded && (
                      <div className="space-y-2 border-t border-white/5 px-3 pb-3 pt-2">
                        {project && (
                          <div className="flex items-center justify-between gap-2 text-[11px]">
                            <span className="flex min-w-0 items-center gap-1.5 truncate text-slate-400">
                              <FolderKanban size={12} className="shrink-0 text-cyan-400" />
                              <span className="shrink-0 font-mono text-cyan-400">{project.code}</span>
                              <span className="truncate">{project.title}</span>
                            </span>
                            <StatusBadge status={project.status} size="sm" />
                          </div>
                        )}
                        {task && (
                          <div className="flex items-center justify-between gap-2 text-[11px]">
                            <span className="flex min-w-0 items-center gap-1.5 truncate text-slate-400">
                              <CheckSquare size={12} className="shrink-0 text-purple-400" />
                              <span className="shrink-0 font-mono text-purple-400">{task.taskNumber}</span>
                              <span className="truncate">{task.title}</span>
                            </span>
                            <StatusBadge status={task.status} size="sm" />
                          </div>
                        )}
                        {!project && !task && (
                          <p className="text-[11px] text-slate-500">No linked project or task.</p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
