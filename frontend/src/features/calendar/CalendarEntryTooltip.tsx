import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { FolderKanban, CheckSquare, Calendar, User, Clock, Target, FileText } from 'lucide-react';
import { CalendarEntry, entryToneClasses } from './calendarRules';
import { Project, Task, User as UserType } from '../../types';
import { StatusBadge } from '../../components/common/StatusBadge';

interface CalendarEntryTooltipProps {
  entry: CalendarEntry;
  projects: Project[];
  tasks: Task[];
  users: UserType[];
  children: React.ReactNode;
}

export const CalendarEntryTooltip: React.FC<CalendarEntryTooltipProps> = ({
  entry,
  projects,
  tasks,
  users,
  children
}) => {
  const [show, setShow] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const showTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLDivElement>(null);

  const handleMouseEnter = (e: React.MouseEvent) => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    // Small delay to avoid flickering when passing over entries
    showTimer.current = setTimeout(() => {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      setPosition({
        x: rect.left + rect.width / 2,
        y: rect.top - 8
      });
      setShow(true);
    }, 300);
  };

  const handleMouseLeave = () => {
    if (showTimer.current) clearTimeout(showTimer.current);
    hideTimer.current = setTimeout(() => {
      setShow(false);
    }, 150);
  };

  // Keep tooltip open when hovering on the tooltip itself
  const handleTooltipEnter = () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
  };

  const handleTooltipLeave = () => {
    hideTimer.current = setTimeout(() => {
      setShow(false);
    }, 150);
  };

  useEffect(() => {
    return () => {
      if (showTimer.current) clearTimeout(showTimer.current);
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, []);

  const project = entry.projectId ? projects.find((p) => p.id === entry.projectId) : undefined;
  const task = entry.taskId ? tasks.find((t) => t.id === entry.taskId) : undefined;
  const assignee = task?.assigneeId ? users.find((u) => u.id === task.assigneeId) : undefined;
  const tone = entryToneClasses(entry.kind);

  return (
    <>
      <div
        ref={triggerRef}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        className="contents"
      >
        {children}
      </div>

      <AnimatePresence>
        {show && (
          <motion.div
            ref={tooltipRef}
            initial={{ opacity: 0, y: 4, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.97 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            onMouseEnter={handleTooltipEnter}
            onMouseLeave={handleTooltipLeave}
            style={{
              position: 'fixed',
              left: position.x,
              top: position.y,
              transform: 'translate(-50%, -100%)',
              zIndex: 9999,
              pointerEvents: 'auto'
            }}
            data-calendar-tooltip
            className="w-72"
          >
            <div className="rounded-2xl border border-white/10 bg-slate-900/95 p-3.5">
              {/* Header */}
              <div className="flex items-center gap-2 mb-2.5">
                <span data-calendar-entry-kind={entry.kind} className={`shrink-0 px-2 py-0.5 rounded-full border text-[10px] font-bold ${tone.badgeClass}`}>
                  {entry.kind}
                </span>
                {entry.time && (
                  <span className="text-[10px] font-mono text-slate-400 flex items-center gap-1">
                    <Clock size={10} />
                    {entry.time}
                  </span>
                )}
              </div>

              {/* Title */}
              <h4 className="text-sm font-bold text-white mb-2 leading-snug">{entry.title}</h4>

              {/* Project Info */}
              {project && (
                <div className="space-y-1.5 text-[11px]">
                  <div className="flex items-center gap-1.5 text-cyan-400">
                    <FolderKanban size={12} className="shrink-0" />
                    <span className="font-mono font-semibold">{project.code}</span>
                    <span className="text-slate-300 truncate">{project.title}</span>
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <StatusBadge status={project.status} size="sm" />
                    {project.priority && (
                      <StatusBadge status={project.priority} size="sm" />
                    )}
                  </div>

                  {project.targetDate && (
                    <div className="flex items-center gap-1.5 text-slate-400">
                      <Target size={11} />
                      <span>Target: {project.targetDate}</span>
                    </div>
                  )}

                  {project.description && (
                    <div className="flex items-start gap-1.5 text-slate-400 mt-1">
                      <FileText size={11} className="shrink-0 mt-0.5" />
                      <p className="line-clamp-2 text-slate-300 leading-relaxed">
                        {project.description}
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* Task Info */}
              {task && (
                <div className="space-y-1.5 text-[11px]">
                  <div className="flex items-center gap-1.5 text-purple-400">
                    <CheckSquare size={12} className="shrink-0" />
                    <span className="font-mono font-semibold">{task.taskNumber}</span>
                    <span className="text-slate-300 truncate">{task.title}</span>
                  </div>

                  <div className="flex items-center gap-2">
                    <StatusBadge status={task.status} size="sm" />
                    <StatusBadge status={task.priority} size="sm" />
                  </div>

                  {task.dueDate && (
                    <div className="flex items-center gap-1.5 text-slate-400">
                      <Calendar size={11} />
                      <span>Due: {task.dueDate}</span>
                    </div>
                  )}

                  {assignee && (
                    <div className="flex items-center gap-1.5 text-slate-400">
                      <User size={11} />
                      <span>{assignee.name}</span>
                    </div>
                  )}

                  {task.description && (
                    <div className="flex items-start gap-1.5 text-slate-400 mt-1">
                      <FileText size={11} className="shrink-0 mt-0.5" />
                      <p className="line-clamp-2 text-slate-300 leading-relaxed">
                        {task.description}
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* Standalone Event Info (no linked project/task) */}
              {!project && !task && (
                <div className="text-[11px] text-slate-400 flex items-center gap-1.5">
                  <Calendar size={11} />
                  <span>{entry.date}</span>
                  {entry.time && <span>at {entry.time}</span>}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};

