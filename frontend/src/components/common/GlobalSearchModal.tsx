import React, { useState, useEffect } from 'react';
import { useApp } from '../../store/AppContext';
import { Search, FolderKanban, CheckSquare, MessageSquare, ArrowRight, X } from 'lucide-react';

interface GlobalSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectResult: (tab: string, id?: string) => void;
}

export const GlobalSearchModal: React.FC<GlobalSearchModalProps> = ({
  isOpen,
  onClose,
  onSelectResult
}) => {
  const { projects, tasks, chatMessages } = useApp();
  const [query, setQuery] = useState('');

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        if (isOpen) onClose();
      } else if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const q = query.toLowerCase().trim();

  const filteredProjects = q
    ? projects.filter((p) => p.title.toLowerCase().includes(q) || p.description.toLowerCase().includes(q) || p.code.toLowerCase().includes(q))
    : projects.slice(0, 3);

  const filteredTasks = q
    ? tasks.filter((t) => t.title.toLowerCase().includes(q) || t.taskNumber.toLowerCase().includes(q) || t.description.toLowerCase().includes(q))
    : tasks.slice(0, 4);

  const filteredChat = q
    ? chatMessages.filter((m) => m.message.toLowerCase().includes(q))
    : chatMessages.slice(0, 2);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 p-4 bg-black/70 backdrop-blur-md animate-in fade-in duration-150">
      <div className="w-full max-w-2xl glass-panel-glow border border-cyan-500/40 shadow-2xl relative overflow-hidden">
        {/* Search Header */}
        <div className="p-4 border-b border-white/10 flex items-center gap-3 bg-slate-900/60">
          <Search size={20} className="text-cyan-400 shrink-0" />
          <input
            type="text"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search projects, tasks..."
            className="w-full bg-transparent text-sm text-white placeholder-slate-400 focus:outline-none font-medium"
          />
          {query && (
            <button onClick={() => setQuery('')} className="p-1 text-slate-400 hover:text-white">
              <X size={16} />
            </button>
          )}
          <kbd className="px-2 py-0.5 rounded bg-white/10 text-[10px] text-slate-300 font-mono">ESC</kbd>
        </div>

        {/* Results Body */}
        <div className="max-h-[60vh] overflow-y-auto p-4 space-y-5">
          {/* Projects Section */}
          {filteredProjects.length > 0 && (
            <div>
              <div className="text-[11px] font-mono text-cyan-400 uppercase tracking-wider mb-2 flex items-center gap-1.5 font-semibold">
                <FolderKanban size={13} />
                Projects ({filteredProjects.length})
              </div>
              <div className="space-y-1.5">
                {filteredProjects.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => {
                      onSelectResult('projects', p.id);
                      onClose();
                    }}
                    className="w-full text-left p-3 rounded-xl bg-white/[0.03] hover:bg-cyan-500/10 border border-white/5 hover:border-cyan-500/30 transition-all flex items-center justify-between group"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-cyan-400 font-bold">{p.code}</span>
                        <span className="font-semibold text-xs text-slate-200 group-hover:text-cyan-300">{p.title}</span>
                      </div>
                      <p className="text-[11px] text-slate-400 line-clamp-1 mt-0.5">{p.description}</p>
                    </div>
                    <ArrowRight size={14} className="text-slate-500 group-hover:text-cyan-400 opacity-0 group-hover:opacity-100 transition-all transform group-hover:translate-x-1" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Tasks Section */}
          {filteredTasks.length > 0 && (
            <div>
              <div className="text-[11px] font-mono text-purple-400 uppercase tracking-wider mb-2 flex items-center gap-1.5 font-semibold">
                <CheckSquare size={13} />
                Tasks ({filteredTasks.length})
              </div>
              <div className="space-y-1.5">
                {filteredTasks.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => {
                      onSelectResult('tasks', t.id);
                      onClose();
                    }}
                    className="w-full text-left p-3 rounded-xl bg-white/[0.03] hover:bg-purple-500/10 border border-white/5 hover:border-purple-500/30 transition-all flex items-center justify-between group"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-purple-400 font-bold">{t.taskNumber}</span>
                        <span className="font-semibold text-xs text-slate-200 group-hover:text-purple-300">{t.title}</span>
                      </div>
                      <p className="text-[11px] text-slate-400 line-clamp-1 mt-0.5">{t.description}</p>
                    </div>
                    <ArrowRight size={14} className="text-slate-500 group-hover:text-purple-400 opacity-0 group-hover:opacity-100 transition-all transform group-hover:translate-x-1" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Chat Messages Section */}
          {filteredChat.length > 0 && (
            <div>
              <div className="text-[11px] font-mono text-emerald-400 uppercase tracking-wider mb-2 flex items-center gap-1.5 font-semibold">
                <MessageSquare size={13} />
                Project Live Chat ({filteredChat.length})
              </div>
              <div className="space-y-1.5">
                {filteredChat.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => {
                      onSelectResult('chat', m.projectId);
                      onClose();
                    }}
                    className="w-full text-left p-3 rounded-xl bg-white/[0.03] hover:bg-emerald-500/10 border border-white/5 hover:border-emerald-500/30 transition-all flex items-center justify-between group"
                  >
                    <div>
                      <span className="text-xs text-slate-300 group-hover:text-emerald-300 line-clamp-1">"{m.message}"</span>
                      <span className="text-[10px] text-slate-500 block mt-0.5">{m.timestamp}</span>
                    </div>
                    <ArrowRight size={14} className="text-slate-500 group-hover:text-emerald-400 opacity-0 group-hover:opacity-100 transition-all transform group-hover:translate-x-1" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {filteredProjects.length === 0 && filteredTasks.length === 0 && filteredChat.length === 0 && (
            <div className="text-center py-8 text-slate-400 text-xs font-mono">
              No matching results found for "{query}". Try searching by task number (e.g. NX-12) or keyword.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
