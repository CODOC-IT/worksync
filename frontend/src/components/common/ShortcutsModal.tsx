import React, { useEffect } from 'react';
import { X, Command, Keyboard } from 'lucide-react';

interface ShortcutsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ShortcutsModal: React.FC<ShortcutsModalProps> = ({ isOpen, onClose }) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === '?' && !['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) {
        e.preventDefault();
        onClose();
      } else if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const shortcutGroups = [
    {
      category: 'Global Navigation',
      items: [
        { keys: ['⌘', 'K'], label: 'Open Global Typeahead Search' },
        { keys: ['?'], label: 'Toggle Keyboard Shortcuts Overlay' },
        { keys: ['G', 'D'], label: 'Navigate to Dashboard' },
        { keys: ['G', 'P'], label: 'Navigate to Projects' },
        { keys: ['G', 'K'], label: 'Navigate to Kanban Board' }
      ]
    },
    {
      category: 'Kanban & Tasks',
      items: [
        { keys: ['N'], label: 'New Task / Project Modal' },
        { keys: ['Esc'], label: 'Close Slide-over / Modal' },
        { keys: ['D'], label: 'Mark Task Done (with summary)' },
        { keys: ['B'], label: 'Mark Task Blocked (with reason)' }
      ]
    },
    {
      category: 'AI Assistant & Workflows',
      items: [
        { keys: ['⌘', 'Enter'], label: 'Submit AI Prompt / PR Template' },
        { keys: ['C'], label: 'Copy Generated Output / Markdown' },
        { keys: ['R'], label: 'Regenerate AI Response' }
      ]
    }
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-in fade-in duration-200">
      <div className="w-full max-w-2xl glass-panel-glow p-6 border border-purple-500/40 shadow-2xl relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10"
        >
          <X size={18} />
        </button>

        <div className="flex items-center gap-3 mb-6 pb-4 border-b border-white/10">
          <div className="p-2.5 rounded-xl bg-purple-500/20 text-purple-400 border border-purple-500/30">
            <Keyboard size={22} />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white">Keyboard Shortcuts Help</h2>
            <p className="text-xs text-slate-400">Boost your workflow productivity across Kinetic OS</p>
          </div>
        </div>

        <div className="space-y-6 max-h-[60vh] overflow-y-auto pr-2">
          {shortcutGroups.map((group) => (
            <div key={group.category}>
              <h3 className="text-xs font-mono uppercase tracking-wider text-cyan-400 mb-3 font-semibold">
                {group.category}
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {group.items.map((item) => (
                  <div
                    key={item.label}
                    className="flex items-center justify-between p-2.5 rounded-lg bg-slate-900/40 border border-white/5 text-xs"
                  >
                    <span className="text-slate-300">{item.label}</span>
                    <div className="flex items-center gap-1">
                      {item.keys.map((k, i) => (
                        <kbd
                          key={i}
                          className="px-2 py-0.5 rounded bg-white/10 border border-white/20 font-mono text-[11px] text-cyan-300 shadow-sm"
                        >
                          {k}
                        </kbd>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
