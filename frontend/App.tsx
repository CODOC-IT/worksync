import React, { useState, useEffect } from "react";
import { AppProvider, useApp } from "../frontend/src/store/AppContext";
import { Sidebar } from "../frontend/src/components/layout/Sidebar";
import { TopNav } from "../frontend/src/components/layout/TopNav";
import { GlobalSearchModal } from "../frontend/src/components/common/GlobalSearchModal";
import { ShortcutsModal } from "../frontend/src/components/common/ShortcutsModal";

// Features
import { DashboardView } from '../frontend/src/features/dashboard/DashboardView';
import { ProfileView } from '../frontend/src/features/profile/ProfileView';
import { TeamMembersView } from '../frontend/src/features/members/TeamMembersView';
import { SettingsView } from '../frontend/src/features/settings/SettingsView';
import { LoginView } from '../frontend/src/features/auth/LoginView';

import { Shield, Sparkles, Download, Database, Key } from 'lucide-react';

const AppContent: React.FC = () => {
  const [currentTab, setCurrentTab] = useState<string>("dashboard");
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
          {currentTab === 'members' && <TeamMembersView />}
          {currentTab === 'profile' && <ProfileView />}
          {currentTab === 'settings' && <SettingsView />}
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
