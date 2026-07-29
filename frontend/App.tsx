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
import { TeamMembersView } from '../frontend/src/features/members/TeamMembersView';
import { ActivityLogView } from '../frontend/src/features/activity/ActivityLogView';

import { Shield, Sparkles } from "lucide-react";

const AppContent: React.FC = () => {
  const [currentTab, setCurrentTab] = useState<string>("login");
  const [sessionStatus, setSessionStatus] = useState<"checking" | "ready" | "error">("checking");
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [sessionCheckAttempt, setSessionCheckAttempt] = useState(0);
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState<boolean>(false);
  const [searchOpen, setSearchOpen] = useState<boolean>(false);
  const [shortcutsOpen, setShortcutsOpen] = useState<boolean>(false);

  const {
    currentRole,
    activeBreak,
    loginUser,
    logoutUser,
  } = useApp();

  useEffect(() => {
    const token = localStorage.getItem("worksync_auth_token");
    if (!token) {
      setSessionError(null);
      setSessionStatus("ready");
      return;
    }

    const controller = new AbortController();

    const restoreSession = async () => {
      setSessionError(null);
      setSessionStatus("checking");

      try {
        const response = await fetch("/api/auth/me", {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        });

        if ([401, 403, 404].includes(response.status)) {
          localStorage.removeItem("worksync_auth_token");
          if (!controller.signal.aborted) {
            setCurrentTab("login");
            setSessionStatus("ready");
          }
          return;
        }

        if (!response.ok) {
          throw new Error("The authentication service is temporarily unavailable.");
        }

        const data = await response.json();
        if (!data.success || !data.user) {
          throw new Error("The authentication service returned an invalid response.");
        }

        if (!controller.signal.aborted) {
          loginUser(data.user);
          setCurrentTab("dashboard");
          setSessionStatus("ready");
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        setSessionError(
          error instanceof Error
            ? error.message
            : "The authentication service is temporarily unavailable.",
        );
        setSessionStatus("error");
      }
    };

    void restoreSession();
    return () => controller.abort();
    // loginUser is intentionally excluded because AppContext recreates it after user hydration.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionCheckAttempt]);

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

  if (sessionStatus === "checking") {
    return (
      <div className="min-h-screen w-screen flex items-center justify-center bg-[var(--bg-canvas)] text-slate-100">
        <div className="flex flex-col items-center gap-4" role="status" aria-live="polite">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-cyan-500 via-purple-600 to-pink-500 p-0.5 shadow-[0_0_20px_rgba(0,242,254,0.35)]">
            <div className="w-full h-full bg-slate-950 rounded-[14px] flex items-center justify-center">
              <Sparkles size={22} className="text-cyan-400 animate-pulse" />
            </div>
          </div>
          <p className="text-xs text-slate-400 font-mono">Restoring secure session...</p>
        </div>
      </div>
    );
  }

  if (sessionStatus === "error") {
    return (
      <div className="min-h-screen w-screen flex items-center justify-center bg-[var(--bg-canvas)] text-slate-100 p-4">
        <div className="glass-panel max-w-md w-full p-6 rounded-2xl border border-amber-500/30 text-center space-y-4">
          <Shield size={28} className="text-amber-400 mx-auto" />
          <div>
            <h1 className="text-lg font-bold text-white">Unable to restore your session</h1>
            <p className="text-xs text-slate-400 mt-2">{sessionError}</p>
          </div>
          <div className="flex justify-center gap-3">
            <button
              type="button"
              onClick={() => setSessionCheckAttempt((attempt) => attempt + 1)}
              className="px-4 py-2 rounded-xl glass-button-neon text-xs font-bold"
            >
              Retry
            </button>
            <button
              type="button"
              onClick={() => {
                logoutUser();
                setCurrentTab("login");
                setSessionStatus("ready");
              }}
              className="px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-xs text-slate-300 hover:bg-white/10"
            >
              Sign out
            </button>
          </div>
        </div>
      </div>
    );
  }

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
          {currentTab === 'members' && <TeamMembersView />}
          {currentTab === 'activity' && <ActivityLogView onNavigate={handleNavigate} />}
          
         

        


          {currentTab === "calendar" && <CalendarView />}



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
