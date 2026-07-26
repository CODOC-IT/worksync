import React, { useState } from 'react';
import { useApp } from '../../store/AppContext';
import { UserRole } from '../../types';
import { NotificationBell } from '../../features/notifications/NotificationBell';
import {
  Search,
  Sun,
  Moon,
  HelpCircle,
  UserCheck,
  ChevronDown,
  ShieldAlert,
  Sparkles,
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
  const { currentRole, setRole, currentUser, theme, toggleTheme } = useApp();
  const [roleMenuOpen, setRoleMenuOpen] = useState(false);

  const rolesList: { role: UserRole; desc: string }[] = [
    { role: 'Admin', desc: 'Full System Authority & Approvals' },
    { role: 'Team_Lead', desc: 'Projects, Tasks & Member Approval Requests' },
    { role: 'HR', desc: 'Attendance, Leaves & Break Policy Approval' },
    { role: 'Team_Member', desc: 'Global Read, Assigned Task Edits & AI Tools' }
  ];

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

      {/* Right: Demo Role Switcher, Controls & User */}
      <div className="flex items-center gap-1 sm:gap-3">
        {/* Role Switcher Dropdown (Mandatory Prototype Feature) */}
        <div className="relative">
          <button
            onClick={() => setRoleMenuOpen(!roleMenuOpen)}
            className="flex items-center gap-1 sm:gap-2 px-1.5 sm:px-3 py-1.5 rounded-xl bg-gradient-to-r from-cyan-950/60 to-purple-950/60 border border-cyan-500/40 text-cyan-300 hover:border-cyan-400 hover:shadow-[0_0_15px_rgba(0,242,254,0.2)] transition-all text-xs font-semibold"
          >
            <UserCheck size={14} className="text-cyan-400 shrink-0" />
            <span className="hidden md:inline">Demo Role:</span>
            <span className="text-white bg-cyan-500/20 px-1 sm:px-2 py-0.5 rounded-md border border-cyan-500/30 truncate max-w-[60px] sm:max-w-none">
              {currentRole.replace('_', ' ')}
            </span>
            <ChevronDown size={14} className={`text-cyan-400 transition-transform shrink-0 ${roleMenuOpen ? 'rotate-180' : ''}`} />
          </button>

          {roleMenuOpen && (
            <div className="absolute right-0 mt-2 w-60 sm:w-72 glass-panel p-2 shadow-2xl border border-cyan-500/30 z-50 animate-in fade-in zoom-in-95 duration-150">
              <div className="px-2 py-1.5 mb-1 border-b border-white/10 text-[11px] font-mono text-cyan-400 uppercase tracking-wider">
                Simulate Role Identity
              </div>
              <div className="space-y-1">
                {rolesList.map((item) => (
                  <button
                    key={item.role}
                    onClick={() => {
                      setRole(item.role);
                      setRoleMenuOpen(false);
                    }}
                    className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-colors flex flex-col gap-0.5 ${
                      currentRole === item.role
                        ? 'bg-cyan-500/20 text-cyan-200 border border-cyan-500/40'
                        : 'text-slate-300 hover:bg-white/5'
                    }`}
                  >
                    <div className="font-bold flex items-center justify-between">
                      <span>{item.role.replace('_', ' ')}</span>
                      {currentRole === item.role && <Sparkles size={12} className="text-cyan-400" />}
                    </div>
                    <span className="text-[10px] text-slate-400">{item.desc}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

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
