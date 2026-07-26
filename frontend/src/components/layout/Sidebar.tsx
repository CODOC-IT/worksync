import React from 'react';
import { useApp } from '../../store/AppContext';
import {
  LayoutDashboard,
  FolderKanban,
  CheckSquare,
  KanbanSquare,
  Calendar,
  BarChart3,
  Activity,
  Clock,
  Sparkles,
  MessageSquare,
  FileSpreadsheet,
  CheckCircle,
  Bell,
  Settings,
  User,
  ShieldCheck,
  ChevronLeft,
  ChevronRight,
  LogOut
} from 'lucide-react';

interface SidebarProps {
  currentTab: string;
  onTabChange: (tab: string) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  mobileOpen: boolean;
  onMobileClose: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentTab,
  onTabChange,
  collapsed,
  onToggleCollapse,
  mobileOpen,
  onMobileClose
}) => {
  const { currentRole, currentUser, systemApprovals, hrRequests, notifications } = useApp();

  const pendingApprovalsCount = systemApprovals.filter((sa) => sa.status === 'Pending').length;
  const pendingHrCount = hrRequests.filter((r) => r.status === 'Pending').length;
  const unreadNotifsCount = notifications.filter((n) => !n.read).length;

  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'projects', label: 'Projects', icon: FolderKanban },
    { id: 'tasks', label: 'Tasks', icon: CheckSquare },
    { id: 'kanban', label: 'Kanban Board', icon: KanbanSquare },
    { id: 'attendance', label: 'Attendance & Breaks', icon: Clock, badge: currentRole === 'HR' && pendingHrCount > 0 ? pendingHrCount : undefined },
    {
      id: 'approvals',
      label: 'Approvals Inbox',
      icon: CheckCircle,
      badge: (currentRole === 'Admin' || currentRole === 'Team_Lead') && pendingApprovalsCount > 0 ? pendingApprovalsCount : undefined,
      hidden: currentRole === 'Team_Member' || currentRole === 'HR'
    },
    { id: 'ai-assistant', label: 'AI Assistant', icon: Sparkles, highlight: true },
    { id: 'chat', label: 'Project Chat', icon: MessageSquare },
    { id: 'weekly-summary', label: 'Weekly Summary', icon: FileSpreadsheet },
    { id: 'calendar', label: 'Calendar', icon: Calendar },
    { id: 'reports', label: 'Reports', icon: BarChart3 },
    { id: 'activity', label: 'Activity Log', icon: Activity },
    { id: 'notifications', label: 'Notifications', icon: Bell, badge: unreadNotifsCount > 0 ? unreadNotifsCount : undefined },
    { id: 'profile', label: 'My Profile', icon: User },
    { id: 'settings', label: 'Settings', icon: Settings }
  ];

const sidebarContent = (
    <>
      {/* Brand Header */}
      <div className="h-16 px-4 flex items-center justify-between border-b border-white/10 shrink-0">
        {!collapsed && (
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-cyan-500 via-purple-600 to-pink-500 flex items-center justify-center p-0.5 shadow-[0_0_15px_rgba(0,242,254,0.4)]">
              <div className="w-full h-full bg-slate-950 rounded-[10px] flex items-center justify-center">
                <Sparkles size={18} className="text-cyan-400 animate-pulse" />
              </div>
            </div>
            <div>
              <span className="font-bold text-sm tracking-wide bg-gradient-to-r from-cyan-400 via-purple-300 to-pink-400 bg-clip-text text-transparent">
                Worksync
              </span>
              <p className="text-[10px] text-slate-400 font-mono tracking-wider">OFFICE CORE</p>
            </div>
          </div>
        )}
        {collapsed && (
          <div className="w-9 h-9 mx-auto rounded-xl bg-gradient-to-tr from-cyan-500 to-purple-600 flex items-center justify-center shadow-[0_0_15px_rgba(0,242,254,0.4)]">
            <Sparkles size={18} className="text-white animate-pulse" />
          </div>
        )}

        <button
          onClick={onToggleCollapse}
          className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
        </button>
      </div>

      {/* Role Badge Indicator */}
      <div className="px-3 py-2 border-b border-white/5 bg-white/[0.02]">
        {!collapsed ? (
          <div className="flex items-center justify-between px-2 py-1.5 rounded-lg bg-cyan-500/10 border border-cyan-500/20">
            <div className="flex items-center gap-2 overflow-hidden">
              <ShieldCheck size={14} className="text-cyan-400 shrink-0" />
              <div className="truncate">
                <span className="text-xs font-semibold text-cyan-300 block">{currentRole.replace('_', ' ')}</span>
                <span className="text-[10px] text-slate-400 block truncate">{currentUser.name}</span>
              </div>
            </div>
          </div>
        ) : (
          <div
            className="w-8 h-8 mx-auto rounded-lg bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400"
            title={`${currentRole}: ${currentUser.name}`}
          >
            <ShieldCheck size={16} />
          </div>
        )}
      </div>

      {/* Navigation List */}
      <div className="flex-1 overflow-y-auto px-2 py-3 space-y-1">
        {navItems
          .filter((item) => !item.hidden)
          .map((item) => {
            const Icon = item.icon;
            const isActive = currentTab === item.id;

            return (
              <button
                key={item.id}
                onClick={() => {
                  onTabChange(item.id);
                  onMobileClose();
                }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 group relative ${
                  isActive
                    ? 'bg-gradient-to-r from-cyan-500/20 to-purple-600/20 text-white border border-cyan-500/40 shadow-[0_0_15px_rgba(0,242,254,0.15)]'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-white/5 border border-transparent'
                }`}
                title={collapsed ? item.label : undefined}
              >
                {isActive && (
                  <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-cyan-400 rounded-r-full shadow-[0_0_8px_rgba(0,242,254,0.8)]" />
                )}

                <Icon
                  size={18}
                  className={`shrink-0 transition-colors ${
                    isActive
                      ? 'text-cyan-400'
                      : item.highlight
                      ? 'text-purple-400 group-hover:text-purple-300'
                      : 'text-slate-400 group-hover:text-slate-200'
                  }`}
                />

                {!collapsed && (
                  <span className={`truncate ${item.highlight && !isActive ? 'text-purple-300 font-semibold' : ''}`}>
                    {item.label}
                  </span>
                )}

                {/* Badge Alert */}
                {item.badge !== undefined && (
                  <span
                    className={`ml-auto shrink-0 flex items-center justify-center rounded-full font-bold text-[10px] ${
                      collapsed
                        ? 'absolute top-1 right-1 w-4 h-4 bg-rose-500 text-white shadow-[0_0_8px_rgba(244,63,94,0.8)]'
                        : 'px-1.5 py-0.5 bg-rose-500/20 text-rose-300 border border-rose-500/40 shadow-[0_0_10px_rgba(244,63,94,0.3)]'
                    }`}
                  >
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
      </div>

      {/* Footer / Logout */}
      <div className="p-3 border-t border-white/10 shrink-0">
        <button
          onClick={() => onTabChange('login')}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-xs text-rose-400 hover:bg-rose-500/10 hover:border-rose-500/20 border border-transparent transition-colors"
          title={collapsed ? 'Switch / Logout' : undefined}
        >
          <LogOut size={16} />
          {!collapsed && <span>Switch Account / Logout</span>}
        </button>
      </div>
    </>
  );

  return (
    <>
      {/* Mobile Overlay Backdrop - visible only on small screens */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
          onClick={onMobileClose}
        />
      )}

      {/* Mobile Drawer (fixed, slides in from left) - visible only on mobile when open */}
      <aside
        className={`
          lg:hidden fixed left-0 top-0 z-50 h-screen flex flex-col glass-panel rounded-none border-r border-y-0 border-l-0 transition-transform duration-300
          ${collapsed ? 'w-20' : 'w-64'}
          ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}
        `}
      >
        {sidebarContent}
      </aside>

      {/* Desktop Sidebar - always visible on large screens */}
      <aside
        className={`
          hidden lg:flex relative z-30 h-screen flex-col glass-panel rounded-none border-r border-y-0 border-l-0 transition-all duration-300 shrink-0
          ${collapsed ? 'w-20' : 'w-64'}
        `}
      >
        {sidebarContent}
      </aside>
    </>
  );
};
