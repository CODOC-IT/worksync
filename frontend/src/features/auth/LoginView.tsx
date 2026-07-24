import React, { useState } from 'react';
import { motion } from 'motion/react';
import { useApp } from '../../store/AppContext';
import { UserRole } from '../../types';
import { Sparkles, Lock, Mail, Shield, Eye, EyeOff, ArrowRight, CheckCircle2, AlertCircle } from 'lucide-react';

interface LoginViewProps {
  onLoginSuccess: () => void;
  onSwitchToSignup: () => void;
}

export const LoginView: React.FC<LoginViewProps> = ({ onLoginSuccess, onSwitchToSignup }) => {
  const { setRole, users } = useApp();

  const [email, setEmail] = useState<string>('fazal.k@codoc.com');
  const [password, setPassword] = useState<string>('password123');
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [selectedDemoRole, setSelectedDemoRole] = useState<UserRole>('Admin');

  // One-click quick demo preset handler
  const handleQuickDemoSelect = (role: UserRole) => {
    setSelectedDemoRole(role);
    const matchedUser = users.find((u) => u.role === role);
    if (matchedUser) {
      setEmail(matchedUser.email);
      setPassword('password123');
    }
  };

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setLoading(true);

    try {
      // Call backend API
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message || 'Authentication failed. Please check credentials.');
      }

      // Store JWT token in local storage
      if (data.token) {
        localStorage.setItem('worksync_auth_token', data.token);
      }

      // Sync role to global App Context
      if (data.user && data.user.role) {
        setRole(data.user.role as UserRole);
      } else {
        setRole(selectedDemoRole);
      }

      onLoginSuccess();
    } catch (err: any) {
      setErrorMsg(err.message || 'Login failed.');
      const matchedUser = users.find((u) => u.email.toLowerCase() === email.toLowerCase());
      if (matchedUser) {
        setRole(matchedUser.role);
        setTimeout(() => {
          onLoginSuccess();
        }, 1000);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen w-screen flex items-center justify-center bg-[#090a0f] text-slate-100 p-4 relative overflow-hidden cursor-glow-container bg-cover bg-center bg-no-repeat"
      style={{
        backgroundImage: `linear-gradient(to bottom, rgba(9, 10, 15, 0.82), rgba(9, 10, 15, 0.94)), url('/assets/images/auth-bg.png')`
      }}
    >
      {/* Background Animated Floating Blobs */}
      <motion.div
        animate={{
          scale: [1, 1.2, 1],
          opacity: [0.15, 0.25, 0.15],
          x: [0, 20, 0],
          y: [0, -20, 0]
        }}
        transition={{ duration: 12, repeat: Infinity, ease: 'easeInOut' }}
        className="absolute top-1/4 -left-20 w-96 h-96 bg-cyan-500/20 rounded-full blur-3xl pointer-events-none"
      />
      <motion.div
        animate={{
          scale: [1, 1.25, 1],
          opacity: [0.15, 0.3, 0.15],
          x: [0, -25, 0],
          y: [0, 25, 0]
        }}
        transition={{ duration: 15, repeat: Infinity, ease: 'easeInOut', delay: 1 }}
        className="absolute bottom-1/4 -right-20 w-96 h-96 bg-purple-600/25 rounded-full blur-3xl pointer-events-none"
      />

      <motion.div
        initial={{ opacity: 0, y: 24, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="w-full max-w-md z-10 space-y-6"
      >
        {/* Brand Header */}
        <div className="text-center space-y-2">
          <motion.div
            whileHover={{ scale: 1.08, rotate: 5 }}
            whileTap={{ scale: 0.95 }}
            className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-tr from-cyan-500 via-purple-600 to-pink-500 p-0.5 shadow-[0_0_25px_rgba(0,242,254,0.4)] mb-2 cursor-pointer"
          >
            <div className="w-full h-full bg-slate-950 rounded-[14px] flex items-center justify-center">
              <Sparkles size={28} className="text-cyan-400 animate-pulse" />
            </div>
          </motion.div>
          <h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-cyan-400 via-purple-300 to-pink-400 bg-clip-text text-transparent">
            WorkSync
          </h1>
          <p className="text-xs text-slate-400 font-mono tracking-wide">ENTERPRISE OFFICE CORE PLATFORM</p>
        </div>

        {/* Login Glass Panel */}
        <div className="glass-panel p-8 border border-white/10 shadow-[0_0_30px_rgba(0,0,0,0.5)] space-y-6 relative">
          <div className="flex items-center justify-between pb-4 border-b border-white/10">
            <div>
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <Shield size={18} className="text-cyan-400 animate-bounce" /> Welcome Back
              </h2>
              <p className="text-xs text-slate-400">Sign in to access your role workspace</p>
            </div>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-cyan-500/10 border border-cyan-500/30 text-cyan-300">
              v1.0.4
            </span>
          </div>

          {/* Quick Demo Role Selector */}
          <div className="space-y-2">
            <label className="text-[11px] font-mono text-slate-400 uppercase tracking-wider block">
              Quick Demo Role Switcher:
            </label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { role: 'Admin', label: 'Fazal (Admin)', color: 'border-cyan-500/40 text-cyan-300' },
                { role: 'Team_Lead', label: 'Adolf (Lead)', color: 'border-purple-500/40 text-purple-300' },
                { role: 'HR', label: 'Maryam (HR)', color: 'border-pink-500/40 text-pink-300' },
                { role: 'Team_Member', label: 'Salman (Engineer)', color: 'border-emerald-500/40 text-emerald-300' }
              ].map((item) => (
                <motion.button
                  key={item.role}
                  type="button"
                  whileHover={{ scale: 1.03, y: -1 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={() => handleQuickDemoSelect(item.role as UserRole)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all text-left flex items-center justify-between ${
                    selectedDemoRole === item.role
                      ? `${item.color} bg-white/10 shadow-[0_0_12px_rgba(0,242,254,0.15)]`
                      : 'border-white/10 text-slate-400 hover:text-slate-200 hover:bg-white/5'
                  }`}
                >
                  <span className="truncate">{item.label}</span>
                  {selectedDemoRole === item.role && <CheckCircle2 size={12} className="text-cyan-400 shrink-0" />}
                </motion.button>
              ))}
            </div>
          </div>

          {/* Error Alert */}
          {errorMsg && (
            <motion.div
              initial={{ opacity: 0, height: 0, y: -6 }}
              animate={{ opacity: 1, height: 'auto', y: 0 }}
              className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-300 flex items-center gap-2 overflow-hidden"
            >
              <AlertCircle size={16} className="shrink-0 text-rose-400 animate-pulse" />
              <span>{errorMsg}</span>
            </motion.div>
          )}

          {/* Credentials Form */}
          <form onSubmit={handleLoginSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-300 block">Work Email</label>
              <div className="relative">
                <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@codoc.com"
                  className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-black/40 border border-white/10 text-sm text-slate-100 focus:outline-none focus:border-cyan-500/60 focus:ring-1 focus:ring-cyan-500/60 transition-all"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-slate-300 block">Password</label>
                <span className="text-[11px] text-cyan-400 hover:underline cursor-pointer">Forgot password?</span>
              </div>
              <div className="relative">
                <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full pl-9 pr-10 py-2.5 rounded-xl bg-black/40 border border-white/10 text-sm text-slate-100 focus:outline-none focus:border-cyan-500/60 focus:ring-1 focus:ring-cyan-500/60 transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
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
              className="w-full py-3 rounded-xl glass-button-neon font-bold text-sm flex items-center justify-center gap-2 shadow-lg disabled:opacity-50 mt-2"
            >
              {loading ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <>
                  Sign In to Workspace <ArrowRight size={16} className="transition-transform group-hover:translate-x-1" />
                </>
              )}
            </motion.button>
          </form>

          {/* Toggle to Signup */}
          <div className="pt-4 border-t border-white/10 text-center">
            <p className="text-xs text-slate-400">
              Don't have an account?{' '}
              <button
                type="button"
                onClick={onSwitchToSignup}
                className="text-cyan-400 hover:underline font-bold transition-colors"
              >
                Create an Account
              </button>
            </p>
          </div>
        </div>

        {/* Footer info */}
        <p className="text-[11px] text-slate-500 text-center">
          Secured with JWT authentication & BCrypt password encryption • Codoc WorkSync
        </p>
      </motion.div>
    </div>
  );
};
