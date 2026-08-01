import React, { useState } from 'react';
import { motion } from 'motion/react';
import { AlertCircle, ArrowRight, Eye, EyeOff, Lock, Mail, Shield, Sparkles } from 'lucide-react';
import { useApp } from '../../store/AppContext';
import type { User } from '../../types';
import { supabase } from '../../../utils/supabase';

interface LoginViewProps {
  onLoginSuccess: () => void;
}

const parseAuthResponse = async (response: Response): Promise<{ success?: boolean; message?: string; user?: User }> => {
  const body = await response.text();
  try {
    return body ? JSON.parse(body) as { success?: boolean; message?: string; user?: User } : {};
  } catch {
    throw new Error(`Authentication service returned an unexpected response (HTTP ${response.status}).`);
  }
};

export const LoginView: React.FC<LoginViewProps> = ({ onLoginSuccess }) => {
  const { loginUser } = useApp();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleLoginSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setErrorMsg(null);

    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    if (!emailRegex.test(email.trim())) {
      setErrorMsg('Please enter a valid email address.');
      return;
    }

    setLoading(true);
    try {
      if (!supabase) throw new Error('Supabase Auth is not configured.');
      let { data: sessionData, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error || !sessionData.session) {
        const migration = await fetch('/api/auth/migrate-legacy-credentials', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email.trim(), password }) });
        const migrationData = await migration.json().catch(() => ({}));
        if (!migration.ok || !migrationData.success) throw new Error(migrationData.message || error?.message || 'Authentication failed.');
        ({ data: sessionData, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password }));
      }
      if (error || !sessionData.session) throw new Error(error?.message || 'Authentication failed.');
      localStorage.setItem('worksync_auth_token', sessionData.session.access_token);
      const response = await fetch('/api/auth/me', { headers: { Authorization: `Bearer ${sessionData.session.access_token}` } });
      const data = await parseAuthResponse(response);
      if (!response.ok || !data.success || !data.user) throw new Error(data.message || 'Your account is not provisioned for WorkSync.');
      loginUser(data.user);
      fetch('/api/auth/audit-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionData.session.access_token}` }
      }).catch(() => {});
      onLoginSuccess();
    } catch (error: any) {
      setErrorMsg(error.message || 'Cannot reach the authentication service.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      data-login-page
      className="min-h-screen w-screen flex items-center justify-center bg-[var(--bg-canvas)] text-slate-100 p-4 md:p-8 relative overflow-hidden bg-cover bg-center bg-no-repeat"
      style={{
        backgroundImage: `linear-gradient(to bottom, rgba(9, 10, 15, 0.88), rgba(9, 10, 15, 0.95)), url('/assets/images/auth-bg.png')`
      }}
    >
      <motion.div
        animate={{ scale: [1, 1.25, 1], opacity: [0.15, 0.28, 0.15], x: [0, 25, 0], y: [0, -25, 0] }}
        transition={{ duration: 14, repeat: Infinity, ease: 'easeInOut' }}
        className="absolute top-1/4 -left-20 w-96 h-96 bg-cyan-600/20 rounded-full blur-3xl pointer-events-none"
      />
      <motion.div
        animate={{ scale: [1, 1.25, 1], opacity: [0.15, 0.3, 0.15], x: [0, -25, 0], y: [0, 25, 0] }}
        transition={{ duration: 15, repeat: Infinity, ease: 'easeInOut', delay: 1 }}
        className="absolute bottom-1/4 -right-20 w-96 h-96 bg-purple-600/25 rounded-full blur-3xl pointer-events-none"
      />

      <motion.div
        initial={{ opacity: 0, y: 24, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="w-full max-w-5xl glass-panel p-2 md:p-3 rounded-3xl border border-white/10 shadow-[0_0_50px_rgba(0,0,0,0.7)] z-10 overflow-hidden"
      >
        <div className="grid grid-cols-1 lg:grid-cols-12 min-h-0 gap-3">
          <div
            className="lg:col-span-5 relative rounded-2xl overflow-hidden p-5 sm:p-6 md:p-8 flex flex-col justify-between bg-cover bg-center border border-white/10 min-h-[200px] lg:min-h-[560px]"
            style={{
              backgroundImage: `linear-gradient(to bottom, rgba(9, 10, 15, 0.55), rgba(9, 10, 15, 0.90)), url('/assets/images/auth-bg.png')`
            }}
          >
            <div className="flex items-center gap-2.5">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-cyan-500 via-purple-600 to-pink-500 p-0.5 shadow-[0_0_15px_rgba(0,242,254,0.4)]">
                <div className="w-full h-full bg-slate-950 rounded-[10px] flex items-center justify-center">
                  <Sparkles size={20} className="text-cyan-400" />
                </div>
              </div>
              <div>
                <span className="font-bold text-base tracking-wide bg-gradient-to-r from-cyan-400 via-purple-300 to-pink-400 bg-clip-text text-transparent block">WorkSync</span>
                <span className="text-[10px] text-slate-400 font-mono tracking-wider">OFFICE CORE</span>
              </div>
            </div>

            <div className="my-6 sm:my-8 space-y-3">
              <span className="px-3 py-1 rounded-full text-[11px] font-mono font-semibold bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 inline-block">
                ENTERPRISE MANAGEMENT PLATFORM
              </span>
              <h2 className="text-2xl md:text-3xl font-extrabold text-white leading-tight">
                Streamline operations & collaborate with precision.
              </h2>
              <p className="text-xs text-slate-300 leading-relaxed">
                Secure access to task orchestration, attendance tracking, and workflow analytics in one workspace.
              </p>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-950/80 backdrop-blur-md border border-white/10">
              <div className="flex items-center gap-3">
                <Shield size={20} className="text-cyan-400 shrink-0" />
                <div>
                  <p className="text-xs font-bold text-white">Protected workspace access</p>
                  <p className="text-[10px] text-slate-400 mt-0.5">Sign in with your assigned organization credentials.</p>
                </div>
              </div>
            </div>
          </div>

          <div className="lg:col-span-7 p-5 sm:p-6 md:p-10 flex flex-col justify-between space-y-6">
            <div className="flex items-center justify-between pb-2 border-b border-white/5">
              <div className="flex items-center gap-2">
                <Shield size={18} className="text-cyan-400" />
                <span className="text-xs font-bold text-slate-200 uppercase tracking-wider">Account Portal</span>
              </div>
              <span className="text-xs text-slate-400">Need access? Contact an Administrator or HR.</span>
            </div>

            <div className="space-y-5 my-auto">
              <div>
                <h2 className="text-2xl md:text-3xl font-extrabold text-white">Hi, Welcome Back</h2>
                <p className="text-xs text-slate-400 mt-1">Sign in with your enterprise credentials</p>
              </div>

              {/* Error Alert */}
              {errorMsg && (
                <motion.div
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-300 flex items-center gap-2"
                >
                  <AlertCircle size={16} className="shrink-0 text-rose-400" />
                  <span>{errorMsg}</span>
                </motion.div>
              )}

              <form onSubmit={handleLoginSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-300 block">Work Email</label>
                  <div className="relative">
                    <Mail size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                    <input
                      type="email"
                      required
                      autoComplete="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      placeholder="name@company.com"
                      className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-black/40 border border-white/10 text-sm text-slate-100 focus:outline-none focus:border-cyan-500/60 focus:ring-1 focus:ring-cyan-500/60 transition-all"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-300 block">Password</label>
                  <div className="relative">
                    <Lock size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type={showPassword ? 'text' : 'password'}
                      required
                      autoComplete="current-password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      placeholder="••••••••"
                      className="w-full pl-10 pr-10 py-2.5 rounded-xl bg-black/40 border border-white/10 text-sm text-slate-100 focus:outline-none focus:border-cyan-500/60 focus:ring-1 focus:ring-cyan-500/60 transition-all"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((visible) => !visible)}
                      className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white transition-colors"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>

                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  type="submit"
                  disabled={loading}
                  className="w-full py-3 rounded-xl glass-button-neon font-bold text-sm flex items-center justify-center gap-2 shadow-lg disabled:opacity-50"
                >
                  {loading ? (
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <>Sign In to Workspace <ArrowRight size={16} /></>
                  )}
                </motion.button>
              </form>
            </div>

            <div className="pt-3 border-t border-white/5 flex items-center justify-between text-[11px] text-slate-500">
              <span>Encrypted JWT Session</span>
              <span>WorkSync v1.0.4</span>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
};
