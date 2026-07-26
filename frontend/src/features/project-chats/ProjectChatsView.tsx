import React from 'react';
import { MessageSquare } from 'lucide-react';

/**
 * Project Chats is intentionally a separate workspace rather than a project-page widget.
 * The feature is filled out in the following milestones; this shell keeps navigation
 * independent from the existing project and task modules.
 */
export const ProjectChatsView: React.FC = () => (
  <section className="mx-auto max-w-7xl">
    <div className="glass-panel flex min-h-[420px] flex-col items-center justify-center p-8 text-center">
      <div className="rounded-2xl border border-cyan-400/20 bg-cyan-500/10 p-4 text-cyan-300">
        <MessageSquare size={28} />
      </div>
      <h1 className="mt-4 text-2xl font-bold text-white">Project Chats</h1>
      <p className="mt-2 max-w-md text-sm leading-6 text-slate-400">
        A focused workspace for project and task discussions.
      </p>
    </div>
  </section>
);
