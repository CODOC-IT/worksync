import React from 'react';
import { useApp } from '../../store/AppContext';
import { NotificationBell } from '../../features/notifications/NotificationBell';
import {
  Search,
  Sun,
  Moon,
  HelpCircle,
  Menu,
  X
} from 'lucide-react';

interface TopNavProps {
  onOpenSearch: () => void;
  onOpenShortcuts: () => void;
  onSelectTab: (tab: string) => void;
  onToggleMobileSidebar: () => void;
  mobileSidebarOpen: boolean;
}

export const TopNav: React.FC<TopNavProps> = ({
  onOpenSearch,
  onOpenShortcuts,
  onSelectTab,
  onToggleMobileSidebar,
  mobileSidebarOpen
}) => {
  const { currentUser, theme, toggleTheme } = useApp();

  return (
    <header className="h-16 border-b border-white/10 glass-panel rounded-none border-x-0 border-t-0 px-3 sm:px-6 flex items-center justify-between relative z-20 shrink-0">
      {/* Left: Hamburger + Global Search Trigger */}
      <div className="flex items-center gap-2 sm:gap-4">
        {/* Hamburger Menu - visible on mobile only */}
        <button
          onClick={onToggleMobileSidebar}
          className="lg:hidden p-2 rounded-xl bg-slate-900/50 border border-white/10 text-slate-400 hover:text-white hover:border-cyan-500/40 transition-all"
          title={mobileSidebarOpen ? 'Close sidebar' : 'Open sidebar'}
        >
          {mobileSidebarOpen ? <X size={18} /> : <Menu size={18} />}
        </button>

        <button
          onClick={onOpenSearch}
          className="flex items-center gap-3 px-3 sm:px-4 py-2 rounded-xl bg-slate-900/50 border border-white/10 text-slate-400 hover:text-slate-200 hover:border-cyan-500/40 hover:shadow-[0_0_15px_rgba(0,242,254,0.15)] transition-all w-44 sm:w-56 md:w-72 lg:w-80 text-xs"
        >
          <Search size={15} className="text-cyan-400 shrink-0" />
          <span className="truncate hidden sm:inline">Search projects, tasks, chat...</span>
          <span className="truncate sm:hidden">Search...</span>
          <kbd className="ml-auto px-1.5 py-0.5 rounded bg-white/10 border border-white/10 text-[10px] font-mono text-slate-300 hidden sm:inline">
            ⌘K
          </kbd>
        </button>
      </div>

      {/* Right: Controls & User */}
      <div className="flex items-center gap-1 sm:gap-3">
        {/* Theme Toggle Button */}
        <button
          onClick={toggleTheme}
          className="p-1.5 sm:p-2 rounded-xl bg-slate-900/50 border border-white/10 text-slate-300 hover:text-white hover:border-cyan-500/40 transition-all"
          title={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} Mode`}
        >
          {theme === 'dark' ? <Sun size={16} className="text-amber-400" /> : <Moon size={16} className="text-cyan-400" />}
        </button>

        {/* Keyboard Shortcuts Trigger - hide on very small screens */}
        <button
          onClick={onOpenShortcuts}
          className="p-1.5 sm:p-2 rounded-xl bg-slate-900/50 border border-white/10 text-slate-300 hover:text-white hover:border-purple-500/40 transition-all hidden sm:block"
          title="Keyboard Shortcuts (?)"
        >
          <HelpCircle size={16} className="text-purple-400" />
        </button>

        {/* Notifications Trigger */}
        <NotificationBell onSelectTab={onSelectTab} />

        {/* User Profile Pill */}
        <button
          onClick={() => onSelectTab('profile')}
          className="flex items-center gap-2 pl-2 pr-2 sm:pr-3 py-1 rounded-xl bg-slate-900/50 border border-white/10 hover:border-cyan-500/40 transition-all text-xs"
        >
          <img
            src={currentUser.avatar}
            alt={currentUser.name}
            className="w-6 h-6 sm:w-7 sm:h-7 rounded-lg object-cover ring-1 ring-cyan-500/40"
          />
          <div className="text-left hidden md:block">
            <span className="font-semibold text-slate-200 block leading-tight">{currentUser.name}</span>
            <span className="text-[10px] text-slate-400 block leading-tight">{currentUser.title}</span>
          </div>
        </button>
      </div>
    </header>
  );
};
