import React, { useState, useEffect } from 'react';
import { AppProvider, useApp } from '../frontend/src/store/AppContext';
import { Sidebar } from '../frontend/src/components/layout/Sidebar';
import { TopNav } from '../frontend/src/components/layout/TopNav';
import { GlobalSearchModal } from '../frontend/src/components/common/GlobalSearchModal';
import { ShortcutsModal } from '../frontend/src/components/common/ShortcutsModal';

// Features
import { LoginView } from '../frontend/src/features/auth/LoginView';
import { SignupView } from '../frontend/src/features/auth/SignupView';
import { DashboardView } from '../frontend/src/features/dashboard/DashboardView';
import { ProfileView } from '../frontend/src/features/profile/ProfileView';

import { Shield, Sparkles, Download, Database, Key } from 'lucide-react';

const AppContent: React.FC = () => {
  const [currentTab, setCurrentTab] = useState<string>('dashboard');
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(false);
  const [searchOpen, setSearchOpen] = useState<boolean>(false);
  const [shortcutsOpen, setShortcutsOpen] = useState<boolean>(false);

  const { currentRole, activeBreak, settings, deactivateUser, exportBackup } = useApp();

  // Keyboard shortcut listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isInput = ['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName);
      if (!isInput) {
        if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
          e.preventDefault();
          setSearchOpen(true);
        } else if (e.key === '?') {
          e.preventDefault();
          setShortcutsOpen(true);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  if (currentTab === 'login') {
    return (
      <LoginView
        onLoginSuccess={() => setCurrentTab('dashboard')}
        onSwitchToSignup={() => setCurrentTab('signup')}
      />
    );
  }

  if (currentTab === 'signup') {
    return (
      <SignupView
        onSignupSuccess={() => setCurrentTab('dashboard')}
        onSwitchToLogin={() => setCurrentTab('login')}
      />
    );
  }

  const handleNavigate = (tab: string, _filterId?: string) => {
    setCurrentTab(tab);
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#090a0f] text-slate-100 font-sans cursor-glow-container">
      {/* Sidebar Navigation */}
      <Sidebar
        currentTab={currentTab}
        onTabChange={(tab) => setCurrentTab(tab)}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
      />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col h-full overflow-hidden min-w-0">
        {/* Top Header Navigation */}
        <TopNav
          onOpenSearch={() => setSearchOpen(true)}
          onOpenNotifs={() => setCurrentTab('notifications')}
          onOpenShortcuts={() => setShortcutsOpen(true)}
          onSelectTab={(tab) => setCurrentTab(tab)}
        />

        {/* Active Break Alert Bar */}
        {activeBreak?.isBreaking && (
          <div className="bg-gradient-to-r from-amber-500/20 via-purple-500/20 to-amber-500/20 border-b border-amber-500/40 px-6 py-1.5 flex items-center justify-between text-xs text-amber-300 font-mono animate-pulse shrink-0">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-amber-400" />
              <span>
                <strong>ACTIVE BREAK TIMER:</strong> {activeBreak.breakType} ({Math.floor(activeBreak.elapsedSeconds / 60)}m {activeBreak.elapsedSeconds % 60}s elapsed)
              </span>
            </div>
            <button
              onClick={() => setCurrentTab('attendance')}
              className="underline hover:text-white font-bold"
            >
              Manage Break →
            </button>
          </div>
        )}

        {/* Main Scrollable View Area */}
        <main className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6 min-w-0">
          {currentTab === 'dashboard' && <DashboardView onNavigate={handleNavigate} />}
   
          {currentTab === 'profile' && <ProfileView />}

          {/* Settings Tab */}
          {currentTab === 'settings' && (
            <div className="space-y-6 max-w-4xl mx-auto">
              <div className="glass-panel p-6 border border-cyan-500/30">
                <div className="flex items-center gap-3 mb-6 pb-4 border-b border-white/10">
                  <div className="p-2.5 rounded-xl bg-cyan-500/20 text-cyan-400 border border-cyan-500/30">
                    <Shield size={22} />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-white">System Settings & Controls</h2>
                    <p className="text-xs text-slate-400">Manage workspace configurations, API keys, and account safeguards</p>
                  </div>
                </div>

                <div className="space-y-6 text-xs">
                  {/* API Key Configuration */}
                  <div className="p-4 rounded-xl bg-slate-900/50 border border-white/10 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-white flex items-center gap-2">
                        <Key size={16} className="text-cyan-400" /> Masked AI API Key
                      </span>
                      <span className="text-[10px] text-emerald-400 font-mono bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/30">
                        Active & Injected
                      </span>
                    </div>
                    <p className="text-slate-400">Injected securely via environment variables. Key is never exposed client-side.</p>
                    <input
                      type="text"
                      readOnly
                      value={settings.maskedAiKey}
                      className="w-full px-3 py-2 rounded-lg bg-black/40 border border-white/10 text-slate-300 font-mono"
                    />
                  </div>

                  {/* Backup & Export Data */}
                  <div className="p-4 rounded-xl bg-slate-900/50 border border-white/10 space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="font-bold text-white flex items-center gap-2">
                          <Database size={16} className="text-purple-400" /> Export JSON Vault Backup
                        </span>
                        <p className="text-slate-400 mt-0.5">Download complete system state snapshot (users, projects, tasks, attendance, logs).</p>
                      </div>
                      <button
                        onClick={exportBackup}
                        className="px-4 py-2 rounded-xl glass-button-neon font-bold flex items-center gap-1.5 shrink-0"
                      >
                        <Download size={14} /> Export Backup
                      </button>
                    </div>
                  </div>

                  {/* Admin Safeguard Check */}
                  <div className="p-4 rounded-xl bg-slate-900/50 border border-rose-500/20 space-y-3">
                    <span className="font-bold text-rose-400 block">Sole Active Admin Account Safeguard Check</span>
                    <p className="text-slate-400">
                      The system blocks deactivating the sole active Admin account (`usr-1`). Try deactivating Alexander Wright below to test the safeguard logic.
                    </p>
                    <button
                      onClick={() => {
                        const res = deactivateUser('usr-1');
                        alert(res.message);
                      }}
                      className="px-3 py-1.5 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 font-semibold"
                    >
                      Attempt Sole Admin Deactivation
                    </button>
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