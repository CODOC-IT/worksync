import React, { useState } from 'react';
import { useApp } from '../../store/AppContext';
import {
  Shield, Key, Database, Sun, Moon, Bell, Lock,
  AlertTriangle, Save, Clock, Sliders, CheckCircle2, UserX
} from 'lucide-react';
import { UserRole } from '../../types';

export const SettingsView: React.FC = () => {
  const {
    currentRole, currentUser, theme, toggleTheme, settings,
    updateSettings, exportBackup, deactivateUser
  } = useApp();

  // Local form states
  const [workingStart, setWorkingStart] = useState(settings.workingHours.start);
  const [workingEnd, setWorkingEnd] = useState(settings.workingHours.end);
  const [breakLimit, setBreakLimit] = useState(settings.breakLimitMinutes);

  // Notification toggles
  const [notifEmail, setNotifEmail] = useState(true);
  const [notifInApp, setNotifInApp] = useState(true);
  const [notifDigest, setNotifDigest] = useState(false);

  // Password change state
  const [currentPass, setCurrentPass] = useState('');
  const [newPass, setNewPass] = useState('');
  const [passMsg, setPassMsg] = useState('');

  // Save handler for Working Hours & Break Limits
  const handleSaveHours = () => {
    updateSettings({
      workingHours: { start: workingStart, end: workingEnd },
      breakLimitMinutes: breakLimit,
    });
    alert('Settings updated successfully!');
  };

  const handlePasswordChange = (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentPass || !newPass) {
      setPassMsg('Please enter both current and new password.');
      return;
    }
    setPassMsg('Password updated successfully! (Simulated)');
    setCurrentPass('');
    setNewPass('');
  };

  const isRoleAdmin = currentRole === 'Admin';
  const isRoleHR = currentRole === 'HR';
  const isRoleLead = currentRole === 'Team_Lead';

  const roleBadgeColor: Record<UserRole, string> = {
    Admin: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
    Team_Lead: 'bg-purple-500/20 text-purple-300 border-purple-500/40',
    HR: 'bg-pink-500/20 text-pink-300 border-pink-500/40',
    Team_Member: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40',
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Header Banner */}
      <div className="glass-panel p-6 border border-cyan-500/30">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-2xl bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 shadow-[0_0_15px_rgba(0,242,254,0.2)]">
              <Shield size={24} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-extrabold text-white">System Settings & Controls</h1>
                <span className={`px-2.5 py-0.5 rounded-full border text-[10px] font-bold ${roleBadgeColor[currentRole]}`}>
                  {currentRole.replace('_', ' ')} Access
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Manage theme, notifications, security, and workspace parameters for your role.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* ── 1. Appearance & Theme ── */}
      <div className="glass-panel p-6 space-y-4">
        <div className="flex items-center gap-2 pb-3 border-b border-white/10">
          {theme === 'dark' ? <Moon size={18} className="text-purple-400" /> : <Sun size={18} className="text-amber-400" />}
          <h2 className="text-sm font-bold text-white">Appearance & Theme</h2>
        </div>

        <div className="flex items-center justify-between text-xs">
          <div>
            <span className="font-semibold text-white block">Theme Mode</span>
            <span className="text-slate-400 text-[11px]">Current active theme is <strong className="text-cyan-400 capitalize">{theme} Mode</strong></span>
          </div>
          <button
            onClick={toggleTheme}
            className="px-4 py-2 rounded-xl glass-button-neon text-xs font-bold flex items-center gap-2"
          >
            {theme === 'dark' ? <Sun size={14} className="text-amber-400" /> : <Moon size={14} className="text-purple-400" />}
            Switch to {theme === 'dark' ? 'Light' : 'Dark'} Mode
          </button>
        </div>
      </div>

      {/* ── 2. Notification Preferences ── */}
      <div className="glass-panel p-6 space-y-4">
        <div className="flex items-center gap-2 pb-3 border-b border-white/10">
          <Bell size={18} className="text-cyan-400" />
          <h2 className="text-sm font-bold text-white">Notification Preferences</h2>
        </div>

        <div className="space-y-3 text-xs">
          <label className="flex items-center justify-between p-3 rounded-xl bg-slate-900/50 border border-white/5 cursor-pointer hover:border-white/10 transition-colors">
            <div>
              <span className="font-semibold text-white block">Email Notifications</span>
              <span className="text-slate-400 text-[11px]">Receive daily updates and task assignment alerts via email</span>
            </div>
            <input
              type="checkbox"
              checked={notifEmail}
              onChange={(e) => setNotifEmail(e.target.checked)}
              className="w-4 h-4 rounded border-white/20 bg-slate-800 text-cyan-500 focus:ring-0"
            />
          </label>

          <label className="flex items-center justify-between p-3 rounded-xl bg-slate-900/50 border border-white/5 cursor-pointer hover:border-white/10 transition-colors">
            <div>
              <span className="font-semibold text-white block">In-App Popups & Sounds</span>
              <span className="text-slate-400 text-[11px]">Show real-time toast alerts for mentions and approvals</span>
            </div>
            <input
              type="checkbox"
              checked={notifInApp}
              onChange={(e) => setNotifInApp(e.target.checked)}
              className="w-4 h-4 rounded border-white/20 bg-slate-800 text-cyan-500 focus:ring-0"
            />
          </label>

          <label className="flex items-center justify-between p-3 rounded-xl bg-slate-900/50 border border-white/5 cursor-pointer hover:border-white/10 transition-colors">
            <div>
              <span className="font-semibold text-white block">Weekly Summary Digest</span>
              <span className="text-slate-400 text-[11px]">Get an AI-compiled weekly activity digest every Monday</span>
            </div>
            <input
              type="checkbox"
              checked={notifDigest}
              onChange={(e) => setNotifDigest(e.target.checked)}
              className="w-4 h-4 rounded border-white/20 bg-slate-800 text-cyan-500 focus:ring-0"
            />
          </label>
        </div>
      </div>

      {/* ── 3. Account Security ── */}
      <div className="glass-panel p-6 space-y-4">
        <div className="flex items-center gap-2 pb-3 border-b border-white/10">
          <Lock size={18} className="text-emerald-400" />
          <h2 className="text-sm font-bold text-white">Account Security</h2>
        </div>

        <form onSubmit={handlePasswordChange} className="space-y-3 max-w-md text-xs">
          <div>
            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Current Password</label>
            <input
              type="password"
              value={currentPass}
              onChange={(e) => setCurrentPass(e.target.value)}
              placeholder="••••••••"
              className="w-full px-3 py-2 rounded-xl bg-black/40 border border-white/10 text-white font-mono"
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">New Password</label>
            <input
              type="password"
              value={newPass}
              onChange={(e) => setNewPass(e.target.value)}
              placeholder="••••••••"
              className="w-full px-3 py-2 rounded-xl bg-black/40 border border-white/10 text-white font-mono"
            />
          </div>
          {passMsg && (
            <p className="text-[11px] font-mono text-emerald-400 flex items-center gap-1">
              <CheckCircle2 size={12} /> {passMsg}
            </p>
          )}
          <button type="submit" className="px-4 py-2 rounded-xl bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-bold hover:bg-emerald-500/30 transition-colors">
            Update Password
          </button>
        </form>
      </div>

      {/* ── 4. Working Hours & Break Limits (Admin, HR, Team Lead) ── */}
      {(isRoleAdmin || isRoleHR || isRoleLead) && (
        <div className="glass-panel p-6 space-y-4 border border-purple-500/20">
          <div className="flex items-center justify-between pb-3 border-b border-white/10">
            <div className="flex items-center gap-2">
              <Clock size={18} className="text-purple-400" />
              <h2 className="text-sm font-bold text-white">Office Hours & Break Limits</h2>
            </div>
            {!isRoleAdmin && !isRoleHR && (
              <span className="text-[10px] font-mono text-slate-400 bg-white/5 px-2 py-0.5 rounded border border-white/10">
                READ-ONLY FOR TEAM LEAD
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
            <div>
              <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Workday Start</label>
              <input
                type="time"
                disabled={!isRoleAdmin && !isRoleHR}
                value={workingStart}
                onChange={(e) => setWorkingStart(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-black/40 border border-white/10 text-white font-mono disabled:opacity-50"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Workday End</label>
              <input
                type="time"
                disabled={!isRoleAdmin && !isRoleHR}
                value={workingEnd}
                onChange={(e) => setWorkingEnd(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-black/40 border border-white/10 text-white font-mono disabled:opacity-50"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Break Limit (Mins)</label>
              <input
                type="number"
                disabled={!isRoleAdmin && !isRoleHR}
                value={breakLimit}
                onChange={(e) => setBreakLimit(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-xl bg-black/40 border border-white/10 text-white font-mono disabled:opacity-50"
              />
            </div>
          </div>

          {(isRoleAdmin || isRoleHR) && (
            <div className="pt-2">
              <button
                onClick={handleSaveHours}
                className="px-4 py-2 rounded-xl glass-button-neon text-xs font-bold flex items-center gap-1.5"
              >
                <Save size={14} /> Save Office Hours
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── 5. Admin-Only Controls: AI API Key, Vault Backup, Safeguards ── */}
      {isRoleAdmin && (
        <div className="glass-panel p-6 space-y-5 border border-amber-500/30">
          <div className="flex items-center gap-2 pb-3 border-b border-white/10">
            <Key size={18} className="text-amber-400" />
            <div>
              <h2 className="text-sm font-bold text-white">Admin Controls & Safeguards</h2>
              <p className="text-[11px] text-amber-300 font-mono">Restricted to System Administrator</p>
            </div>
          </div>

          <div className="space-y-4 text-xs">

            {/* JSON Vault Backup */}
            <div className="p-4 rounded-xl bg-slate-900/60 border border-white/10 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-bold text-white flex items-center gap-2">
                    <Database size={14} className="text-cyan-400" /> Export JSON Vault Backup
                  </span>
                  <p className="text-slate-400 text-[11px] mt-0.5">
                    Download complete system state snapshot (users, projects, tasks, attendance, activity logs).
                  </p>
                </div>
                <button
                  onClick={exportBackup}
                  className="px-4 py-2 rounded-xl glass-button-neon font-bold flex items-center gap-1.5 shrink-0"
                >
                  <Database size={14} /> Export Backup
                </button>
              </div>
            </div>

          </div>
        </div>
      )}
    </div>
  );
};
