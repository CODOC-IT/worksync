import React, { useState } from 'react';
import { useApp } from '../../store/AppContext';
import { UserRole } from '../../types';
import { Sparkles, LogIn, ShieldCheck } from 'lucide-react';

interface LoginViewProps {
  onLoginSuccess: () => void;
}

const ROLE_OPTIONS: { role: UserRole; label: string; description: string; color: string }[] = [
  { role: 'Admin', label: 'Administrator', description: 'Full system access and oversight', color: 'from-amber-500/20 to-orange-500/20 border-amber-500/40 text-amber-300' },
  { role: 'Team_Lead', label: 'Team Lead', description: 'Project-scoped temporary authority', color: 'from-purple-500/20 to-violet-500/20 border-purple-500/40 text-purple-300' },
  { role: 'HR', label: 'HR Representative', description: 'Attendance-scoped temporary access', color: 'from-pink-500/20 to-rose-500/20 border-pink-500/40 text-pink-300' },
  { role: 'Team_Member', label: 'Team Member', description: 'Standard access to shared work', color: 'from-cyan-500/20 to-sky-500/20 border-cyan-500/40 text-cyan-300' },
];

export const LoginView: React.FC<LoginViewProps> = ({ onLoginSuccess }) => {
  const { setRole } = useApp();
  const [selectedRole, setSelectedRole] = useState<UserRole>('Admin');

  const handleLogin = () => {
    setRole(selectedRole);
    onLoginSuccess();
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-[#090a0f] p-4">
      {/* Background glow effects */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-cyan-500/5 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-500/5 rounded-full blur-3xl" />
      </div>

      <div className="relative w-full max-w-md space-y-6">
        {/* Logo / Brand */}
        <div className="text-center space-y-3">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-tr from-cyan-500 via-purple-600 to-pink-500 p-0.5 shadow-[0_0_30px_rgba(0,242,254,0.3)] mx-auto">
            <div className="w-full h-full bg-slate-950 rounded-[14px] flex items-center justify-center">
              <Sparkles size={28} className="text-cyan-400" />
            </div>
          </div>
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight bg-gradient-to-r from-cyan-400 via-purple-300 to-pink-400 bg-clip-text text-transparent">
              Worksync
            </h1>
            <p className="text-xs text-slate-400 font-mono tracking-widest mt-1">OFFICE CORE · DEMO LOGIN</p>
          </div>
        </div>

        {/* Login Panel */}
        <div className="glass-panel p-6 border border-white/10 space-y-5">
          <div className="flex items-center gap-2 pb-4 border-b border-white/10">
            <ShieldCheck size={16} className="text-cyan-400" />
            <span className="text-sm font-bold text-white">Select Your Role to Continue</span>
          </div>

          <div className="space-y-2">
            {ROLE_OPTIONS.map(({ role, label, description, color }) => (
              <button
                key={role}
                onClick={() => setSelectedRole(role)}
                className={`w-full text-left px-4 py-3 rounded-xl border bg-gradient-to-r transition-all duration-200 ${
                  selectedRole === role
                    ? `${color} shadow-[0_0_15px_rgba(0,0,0,0.3)]`
                    : 'from-white/[0.02] to-white/[0.02] border-white/10 text-slate-400 hover:border-white/20 hover:text-slate-200'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-xs font-bold block">{label}</span>
                    <span className="text-[11px] opacity-70">{description}</span>
                  </div>
                  {selectedRole === role && (
                    <div className="w-2 h-2 rounded-full bg-current shadow-[0_0_8px_currentColor] shrink-0" />
                  )}
                </div>
              </button>
            ))}
          </div>

          <button
            onClick={handleLogin}
            className="w-full py-3 rounded-xl glass-button-neon font-bold text-sm flex items-center justify-center gap-2 shadow-[0_0_20px_rgba(0,242,254,0.3)]"
          >
            <LogIn size={16} /> Enter as {ROLE_OPTIONS.find(r => r.role === selectedRole)?.label}
          </button>

          <p className="text-center text-[10px] text-slate-500">
            Demo mode · No real authentication required
          </p>
        </div>
      </div>
    </div>
  );
};
