import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'motion/react';
import { useApp } from '../../store/AppContext';
import { UserRole } from '../../types';
import { ForgotPasswordView } from './ForgotPasswordView';
import { Sparkles, Lock, Mail, Shield, Eye, EyeOff, ArrowRight, CheckCircle2, AlertCircle, ArrowLeft, Globe } from 'lucide-react';

interface LoginViewProps {
  onLoginSuccess: () => void;
  onSwitchToSignup: () => void;
}

export const LoginView: React.FC<LoginViewProps> = ({ onLoginSuccess, onSwitchToSignup }) => {
  const { loginUser, users } = useApp();

  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [email, setEmail] = useState<string>('fazal.k@codoc.com');
  const [password, setPassword] = useState<string>('password123');
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [selectedDemoRole, setSelectedDemoRole] = useState<UserRole>('Admin');
  const [emailCheck, setEmailCheck] = useState<{ checking: boolean; exists: boolean | null; msg: string | null }>({ checking: false, exists: null, msg: null });
  const emailTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Real-time email check with debounce
  useEffect(() => {
    const trimmed = email.trim();
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

    if (emailTimer.current) clearTimeout(emailTimer.current);

    if (!trimmed) {
      setEmailCheck({ checking: false, exists: null, msg: null });
      return;
    }

    if (!emailRegex.test(trimmed)) {
      setEmailCheck({ checking: false, exists: null, msg: 'Invalid email format.' });
      return;
    }

    setEmailCheck((prev) => ({ ...prev, checking: true, msg: null }));
    emailTimer.current = setTimeout(() => {
      fetch(`/api/auth/check-email?email=${encodeURIComponent(trimmed)}`)
        .then((res) => res.json())
        .then((data) => {
          if (data.success) {
            setEmailCheck({
              checking: false,
              exists: data.exists,
              msg: data.exists ? null : 'No account found with this email.'
            });
          }
        })
        .catch(() => setEmailCheck({ checking: false, exists: null, msg: null }));
    }, 300);

    return () => {
      if (emailTimer.current) clearTimeout(emailTimer.current);
    };
  }, [email]);

  // One-click quick demo preset handler
  const handleQuickDemoSelect = (role: UserRole) => {
    setSelectedDemoRole(role);
    const matchedUser = users.find((u) => u.role === role);
    if (matchedUser) {
      setEmail(matchedUser.email);
      setPassword('password123');
    }
  };

  const activeDemoUser = users.find((u) => u.role === selectedDemoRole) || users[0];

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    if (!emailRegex.test(email.trim())) {
      setErrorMsg('Please enter a valid email address (e.g. user@domain.com).');
      return;
    }

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

      // Sync logged-in user to global App Context
      if (data.user && data.user.role) {
        loginUser(data.user);
      } else {
        const matchedUser = users.find((u) => u.role === selectedDemoRole) || users[0];
        loginUser(matchedUser);
      }

      onLoginSuccess();
    } catch (err: any) {
      // If the API responded with a valid JSON body, show that message
      if (err.message && err.message !== 'Login failed.') {
        setErrorMsg(err.message);
      } else {
        // Network error or empty response — backend is likely not running
        setErrorMsg('Cannot reach the server. Make sure the backend is running on port 5000.');
      }
    } finally {
      setLoading(false);
    }
  };

  if (showForgotPassword) {
    return <ForgotPasswordView onBackToLogin={() => setShowForgotPassword(false)} />;
  }

  return (
    <div
      className="min-h-screen w-screen flex items-center justify-center bg-[#090a0f] text-slate-100 p-4 md:p-8 relative overflow-hidden cursor-glow-container bg-cover bg-center bg-no-repeat"
      style={{
        backgroundImage: `linear-gradient(to bottom, rgba(9, 10, 15, 0.88), rgba(9, 10, 15, 0.95)), url('/assets/images/auth-bg.png')`
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

      {/* Outer Split-Screen Card Container */}
      <motion.div
        initial={{ opacity: 0, y: 24, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="w-full max-w-5xl glass-panel p-2 md:p-3 rounded-3xl border border-white/10 shadow-[0_0_50px_rgba(0,0,0,0.7)] z-10 overflow-hidden"
      >
        <div className="grid grid-cols-1 lg:grid-cols-12 min-h-[560px] gap-3">
          {/* LEFT COLUMN: Visual Showcase Panel with auth_bg.png */}
          <div
            className="lg:col-span-5 relative rounded-2xl overflow-hidden p-6 md:p-8 flex flex-col justify-between bg-cover bg-center border border-white/10"
            style={{
              backgroundImage: `linear-gradient(to bottom, rgba(9, 10, 15, 0.55), rgba(9, 10, 15, 0.90)), url('/assets/images/auth-bg.png')`
            }}
          >
            {/* Top Brand Bar inside Left Card */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <motion.div
                  whileHover={{ scale: 1.08, rotate: 5 }}
                  className="w-10 h-10 rounded-xl bg-gradient-to-tr from-cyan-500 via-purple-600 to-pink-500 p-0.5 shadow-[0_0_15px_rgba(0,242,254,0.4)]"
                >
                  <div className="w-full h-full bg-slate-950 rounded-[10px] flex items-center justify-center">
                    <Sparkles size={20} className="text-cyan-400 animate-pulse" />
                  </div>
                </motion.div>
                <div>
                  <span className="font-bold text-base tracking-wide bg-gradient-to-r from-cyan-400 via-purple-300 to-pink-400 bg-clip-text text-transparent block">
                    WorkSync
                  </span>
                  <span className="text-[10px] text-slate-400 font-mono tracking-wider">OFFICE CORE</span>
                </div>
              </div>
            </div>

            {/* Middle Feature Hero Content */}
            <div className="my-8 space-y-3">
              <span className="px-3 py-1 rounded-full text-[11px] font-mono font-semibold bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 inline-block shadow-[0_0_12px_rgba(0,242,254,0.2)]">
                ENTERPRISE MANAGEMENT PLATFORM
              </span>
              <h2 className="text-2xl md:text-3xl font-extrabold text-white leading-tight">
                Streamline operations & collaborate with precision.
              </h2>
              <p className="text-xs text-slate-300 leading-relaxed">
                Role-based access control, task orchestration, attendance tracking, and AI-powered workflow analytics in one sleek workspace.
              </p>
            </div>

            {/* Bottom Demo User Showcase Card */}
            <div className="p-3.5 rounded-xl bg-slate-950/80 backdrop-blur-md border border-white/10 space-y-2">
              <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono">
                <span>Selected Demo Profile</span>
                <span className="text-cyan-400 font-bold">{activeDemoUser.role.replace('_', ' ')}</span>
              </div>
              <div className="flex items-center gap-3">
                <img
                  src={activeDemoUser.avatar}
                  alt={activeDemoUser.name}
                  className="w-10 h-10 rounded-xl object-cover border border-cyan-500/40 shadow-[0_0_10px_rgba(0,242,254,0.3)]"
                  onError={(e) => {
                    (e.target as HTMLElement).setAttribute('src', 'https://images.unsplash.com/photo-1492562080023-ab3db95bfbce?w=150&auto=format&fit=crop&q=80');
                  }}
                />
                <div className="min-w-0 flex-1">
                  <h4 className="text-xs font-bold text-white truncate">{activeDemoUser.name}</h4>
                  <p className="text-[10px] text-slate-400 truncate">{activeDemoUser.title}</p>
                </div>
              </div>
            </div>
          </div>

          {/* RIGHT COLUMN: Interactive Login Form Area */}
          <div className="lg:col-span-7 p-6 md:p-10 flex flex-col justify-between space-y-6">
            {/* Top Navigation Row */}
            <div className="flex items-center justify-between pb-2 border-b border-white/5">
              <div className="flex items-center gap-2">
                <Shield size={18} className="text-cyan-400" />
                <span className="text-xs font-bold text-slate-200 uppercase tracking-wider">Account Portal</span>
              </div>
              <div className="flex items-center gap-3 text-xs">
                <span className="text-slate-400 hidden sm:inline">New here?</span>
                <button
                  type="button"
                  onClick={onSwitchToSignup}
                  className="px-3.5 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-cyan-300 border border-cyan-500/30 text-xs font-semibold transition-all hover:scale-105"
                >
                  Create Account
                </button>
              </div>
            </div>

            {/* Main Greeting & Input Form */}
            <div className="space-y-5 my-auto">
              <div>
                <h2 className="text-2xl md:text-3xl font-extrabold text-white">Hi, Welcome Back</h2>
                <p className="text-xs text-slate-400 mt-1">Sign in with your enterprise credentials or select a role preset</p>
              </div>

              {/* Quick Demo Role Selector Chips */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-mono text-slate-400 uppercase tracking-wider block">
                  Quick Demo Preset:
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {[
                    { role: 'Admin', label: 'Fazal', badge: 'Admin', color: 'border-cyan-500/40 text-cyan-300' },
                    { role: 'Team_Lead', label: 'Adolf', badge: 'Lead', color: 'border-purple-500/40 text-purple-300' },
                    { role: 'HR', label: 'Maryam', badge: 'HR', color: 'border-pink-500/40 text-pink-300' },
                    { role: 'Team_Member', label: 'Salman', badge: 'Engineer', color: 'border-emerald-500/40 text-emerald-300' }
                  ].map((item) => (
                    <motion.button
                      key={item.role}
                      type="button"
                      whileHover={{ scale: 1.03, y: -1 }}
                      whileTap={{ scale: 0.97 }}
                      onClick={() => handleQuickDemoSelect(item.role as UserRole)}
                      className={`p-2 rounded-xl text-xs font-semibold border transition-all flex flex-col items-center justify-center gap-1 ${
                        selectedDemoRole === item.role
                          ? `${item.color} bg-white/10 shadow-[0_0_12px_rgba(0,242,254,0.15)]`
                          : 'border-white/10 text-slate-400 hover:text-slate-200 hover:bg-white/5'
                      }`}
                    >
                      <span className="font-bold truncate text-[11px]">{item.label}</span>
                      <span className="text-[9px] font-mono opacity-80">{item.badge}</span>
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

              {/* Form Controls */}
              <form onSubmit={handleLoginSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-300 block">Work Email</label>
                  <div className="relative">
                    <Mail size={16} className="absolute left-3.5 top-[20px] -translate-y-1/2 text-slate-400 pointer-events-none" />
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="name@codoc.com"
                      className={`w-full pl-10 pr-4 py-2.5 rounded-xl bg-black/40 border text-sm text-slate-100 focus:outline-none focus:ring-1 transition-all ${
                        emailCheck.exists === true ? 'border-emerald-500/60 focus:border-emerald-500 focus:ring-emerald-500/60' :
                        emailCheck.msg === 'Invalid email format.' ? 'border-rose-500/60 focus:border-rose-500 focus:ring-rose-500/60' :
                        emailCheck.msg ? 'border-amber-500/60 focus:border-amber-500 focus:ring-amber-500/60' :
                        'border-white/10 focus:border-cyan-500/60 focus:ring-cyan-500/60'
                      }`}
                    />
                  </div>
                  {emailCheck.checking && (
                    <div className="flex items-center gap-1.5 mt-1">
                      <div className="w-3 h-3 border-2 border-slate-500 border-t-transparent rounded-full animate-spin" />
                      <span className="text-[11px] text-slate-400">Checking...</span>
                    </div>
                  )}
                  {!emailCheck.checking && emailCheck.exists === true && (
                    <div className="flex items-center gap-1.5 mt-1">
                      <CheckCircle2 size={12} className="text-emerald-400 shrink-0" />
                      <span className="text-[11px] text-emerald-400">Account found</span>
                    </div>
                  )}
                  {!emailCheck.checking && emailCheck.exists === false && (
                    <div className="flex items-center gap-1.5 mt-1">
                      <AlertCircle size={12} className="text-amber-400 shrink-0" />
                      <span className="text-[11px] text-amber-400">No account found with this email.</span>
                    </div>
                  )}
                  {emailCheck.msg === 'Invalid email format.' && (
                    <div className="flex items-center gap-1.5 mt-1">
                      <AlertCircle size={12} className="text-rose-400 shrink-0" />
                      <span className="text-[11px] text-rose-400">{emailCheck.msg}</span>
                    </div>
                  )}
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-medium text-slate-300 block">Password</label>
                    {emailCheck.exists === true ? (
                      <span onClick={() => setShowForgotPassword(true)} className="text-[11px] text-cyan-400 hover:underline cursor-pointer">Forgot password?</span>
                    ) : (
                      <span className="text-[11px] text-slate-600 cursor-not-allowed" title="Enter a registered email to reset password">Forgot password?</span>
                    )}
                  </div>
                  <div className="relative">
                    <Lock size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type={showPassword ? 'text' : 'password'}
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full pl-10 pr-10 py-2.5 rounded-xl bg-black/40 border border-white/10 text-sm text-slate-100 focus:outline-none focus:border-cyan-500/60 focus:ring-1 focus:ring-cyan-500/60 transition-all"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white transition-colors"
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
                      Sign In to Workspace <ArrowRight size={16} />
                    </>
                  )}
                </motion.button>
              </form>
            </div>

            {/* Bottom Footer Info */}
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
