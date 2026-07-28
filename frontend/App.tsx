import React, { useState, useEffect } from "react";
import { AppProvider, useApp } from "../frontend/src/store/AppContext";
import { Sidebar } from "../frontend/src/components/layout/Sidebar";
import { TopNav } from "../frontend/src/components/layout/TopNav";
import { GlobalSearchModal } from "../frontend/src/components/common/GlobalSearchModal";
import { ShortcutsModal } from "../frontend/src/components/common/ShortcutsModal";

// Features
import { LoginView } from '../frontend/src/features/auth/LoginView';
import { SignupView } from '../frontend/src/features/auth/SignupView';
import { DashboardView } from '../frontend/src/features/dashboard/DashboardView';
import { ProfileView } from '../frontend/src/features/profile/ProfileView';
import { ProjectsView } from '../frontend/src/features/projects/ProjectsView';
import { TasksView } from '../frontend/src/features/tasks/TasksView';
import { AttendanceView } from '../frontend/src/features/attendance/AttendanceView';
import { AIAssistantView } from '../frontend/src/features/ai-assistant/AIAssistantView';
import { KanbanView } from '../frontend/src/features/kanban/KanbanView';
import { ApprovalsInboxView } from '../frontend/src/features/approvals/ApprovalsInboxView';
import { NotificationsView } from '../frontend/src/features/notifications/NotificationsView';
import { CalendarView } from "../frontend/src/features/calendar/CalendarView";
import { ToastContainer } from '../frontend/src/features/notifications/ToastContainer';
import { ReportsView } from '../frontend/src/features/reports/ReportsView';
import { ProjectChatsView } from '../frontend/src/features/project-chats/ProjectChatsView';
import { ActivityLogView } from '../frontend/src/features/activity/ActivityLogView';
import { TeamMembersView } from '../frontend/src/features/members/TeamMembersView';

import { Shield, Sparkles, Download, Database, Key } from "lucide-react";

const AppContent: React.FC = () => {
  const [currentTab, setCurrentTab] = useState<string>("login");
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState<boolean>(false);
  const [searchOpen, setSearchOpen] = useState<boolean>(false);
  const [shortcutsOpen, setShortcutsOpen] = useState<boolean>(false);

  const { currentRole, activeBreak, settings, deactivateUser, exportBackup } =
    useApp();

  // Keyboard shortcut listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isInput = ["INPUT", "TEXTAREA"].includes(
        (e.target as HTMLElement)?.tagName,
      );
      if (!isInput) {
        if ((e.metaKey || e.ctrlKey) && e.key === "k") {
          e.preventDefault();
          setSearchOpen(true);
        } else if (e.key === "?") {
          e.preventDefault();
          setShortcutsOpen(true);
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  if (currentTab === "login") {
    return (
      <LoginView
        onLoginSuccess={() => setCurrentTab("dashboard")}
        onSwitchToSignup={() => setCurrentTab("signup")}
      />
    );
  }

  if (currentTab === "signup") {
    return (
      <SignupView
        onSignupSuccess={() => setCurrentTab("dashboard")}
        onSwitchToLogin={() => setCurrentTab("login")}
      />
    );
  }

  const handleNavigate = (tab: string, _filterId?: string) => {
    setCurrentTab(tab);
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[var(--bg-canvas)] text-slate-300 font-sans cursor-glow-container">
      {/* Sidebar Navigation */}
      <Sidebar
        currentTab={currentTab}
        onTabChange={(tab) => setCurrentTab(tab)}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
        mobileOpen={mobileSidebarOpen}
        onMobileClose={() => setMobileSidebarOpen(false)}
      />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col h-full overflow-hidden min-w-0">
        {/* Top Header Navigation */}
        <TopNav
          onOpenSearch={() => setSearchOpen(true)}
          onOpenShortcuts={() => setShortcutsOpen(true)}
          onSelectTab={(tab) => setCurrentTab(tab)}
          onToggleMobileSidebar={() => setMobileSidebarOpen((prev) => !prev)}
          mobileSidebarOpen={mobileSidebarOpen}
        />

        {/* Active Break Alert Bar */}
        {activeBreak?.isBreaking && (
          <div className="bg-gradient-to-r from-amber-500/20 via-purple-500/20 to-amber-500/20 border-b border-amber-500/40 px-6 py-1.5 flex items-center justify-between text-xs text-amber-300 font-mono animate-pulse shrink-0">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-amber-400" />
              <span>
                <strong>ACTIVE BREAK TIMER:</strong> {activeBreak.breakType} (
                {Math.floor(activeBreak.elapsedSeconds / 60)}m{" "}
                {activeBreak.elapsedSeconds % 60}s elapsed)
              </span>
            </div>
            <button
              onClick={() => setCurrentTab("attendance")}
              className="underline hover:text-white font-bold"
            >
              Manage Break →
            </button>
          </div>
        )}

        {/* Main Scrollable View Area */}
        <main className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6 min-w-0">
          {currentTab === 'dashboard' && <DashboardView onNavigate={handleNavigate} />}
          {currentTab === 'projects' && <ProjectsView />}
          {currentTab === 'tasks' && <TasksView />}
          {currentTab === 'attendance' && <AttendanceView />}
          {currentTab === 'profile' && <ProfileView />}
          {currentTab === 'ai-assistant' && <AIAssistantView />}
          {currentTab === 'kanban' && <KanbanView />}
          {currentTab === 'approvals' && <ApprovalsInboxView />}
          {currentTab === 'notifications' && <NotificationsView onNavigate={handleNavigate} />}
          {currentTab === 'reports' && <ReportsView />}
          {currentTab === 'project-chats' && <ProjectChatsView />}
          {currentTab === 'activity' && <ActivityLogView onNavigate={handleNavigate} />}
          {currentTab === 'members' && <TeamMembersView />}
          
         

        


          {currentTab === "calendar" && <CalendarView />}


          {/* Settings Tab */}
          {currentTab === "settings" && (
            <div className="space-y-6 max-w-4xl mx-auto">
              <div className="glass-panel p-6 border border-cyan-500/30">
                <div className="flex items-center gap-3 mb-6 pb-4 border-b border-white/10">
                  <div className="p-2.5 rounded-xl bg-cyan-500/20 text-cyan-400 border border-cyan-500/30">
                    <Shield size={22} />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-white">
                      System Settings & Controls
                    </h2>
                    <p className="text-xs text-slate-400">
                      Manage workspace configurations, API keys, and account
                      safeguards
                    </p>
                  </div>
                </div>

                <div className="space-y-6 text-xs">
                  {/* Backup & Export Data */}
                  <div className="p-4 rounded-xl bg-slate-900/50 border border-white/10 space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="font-bold text-white flex items-center gap-2">
                          <Database size={16} className="text-purple-400" />{" "}
                          Export JSON Vault Backup
                        </span>
                        <p className="text-slate-400 mt-0.5">
                          Download complete system state snapshot (users,
                          projects, tasks, attendance, logs).
                        </p>
                      </div>
                      <button
                        onClick={exportBackup}
                        className="px-4 py-2 rounded-xl glass-button-neon font-bold flex items-center gap-1.5 shrink-0"
                      >
                        <Download size={14} /> Export Backup
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Modals */}
      <GlobalSearchModal
        isOpen={searchOpen}
        onClose={() => setSearchOpen(false)}
        onSelectResult={(tab) => setCurrentTab(tab)}
      />
      <ShortcutsModal
        isOpen={shortcutsOpen}
        onClose={() => setShortcutsOpen(false)}
      />
      <ToastContainer />
    </div>
  );
};

export default function App() {
  return (
    <AppProvider>
      <AppContent />
    </AppProvider>
  );
}
