import React, { useState } from 'react';
import { motion } from 'motion/react';
import { useApp } from '../../store/AppContext';
import { UserRole } from '../../types';
import { Sparkles, Lock, Mail, User as UserIcon, Building2, Briefcase, Eye, EyeOff, ArrowRight, AlertCircle, Shield } from 'lucide-react';
import { OTPVerificationView } from './OTPVerificationView';

interface SignupViewProps {
  onSignupSuccess: () => void;
  onSwitchToLogin: () => void;
}

export const SignupView: React.FC<SignupViewProps> = ({ onSignupSuccess, onSwitchToLogin }) => {
  const { setRole } = useApp();

  const [name, setName] = useState<string>('');
  const [email, setEmail] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [confirmPassword, setConfirmPassword] = useState<string>('');
  const [role, setRoleState] = useState<UserRole>('Team_Member');
  const [department, setDepartment] = useState<string>('Engineering');
  const [title, setTitle] = useState<string>('');
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showOTP, setShowOTP] = useState<boolean>(false);

  const handleSignupSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (password !== confirmPassword) {
      setErrorMsg('Passwords do not match.');
      return;
    }

    if (password.length < 6) {
      setErrorMsg('Password must be at least 6 characters long.');
      return;
    }

    setLoading(true);

    try {
      // Send OTP to email first — registration happens after OTP verification
      const res = await fetch('/api/otp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, name })
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || 'Failed to send verification code.');
      setShowOTP(true);
    } catch (err: any) {
      setErrorMsg(err.message || 'Registration failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleOTPSuccess = (_token: string, user: any) => {
    const userRole: UserRole = user?.role || role;
    setRole(userRole);
    onSignupSuccess();
  };

  if (showOTP) {
    return (
      <OTPVerificationView
        email={email}
        name={name}
        registrationData={{ password, role, department, title: title || `${role.replace('_', ' ')} Specialist` }}
        onVerifySuccess={handleOTPSuccess}
        onBack={() => setShowOTP(false)}
      />
    );
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
          scale: [1, 1.25, 1],
          opacity: [0.15, 0.28, 0.15],
          x: [0, -25, 0],
          y: [0, 25, 0]
        }}
        transition={{ duration: 14, repeat: Infinity, ease: 'easeInOut' }}
        className="absolute top-1/4 -right-20 w-96 h-96 bg-purple-600/25 rounded-full blur-3xl pointer-events-none"
      />
      <motion.div
        animate={{
          scale: [1, 1.2, 1],
          opacity: [0.15, 0.25, 0.15],
          x: [0, 20, 0],
          y: [0, -20, 0]
        }}
        transition={{ duration: 12, repeat: Infinity, ease: 'easeInOut', delay: 1 }}
        className="absolute bottom-1/4 -left-20 w-96 h-96 bg-cyan-500/20 rounded-full blur-3xl pointer-events-none"
      />

      {/* Outer Split-Screen Card Container */}
      <motion.div
        initial={{ opacity: 0, y: 24, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="w-full max-w-5xl glass-panel p-2 md:p-3 rounded-3xl border border-white/10 shadow-[0_0_50px_rgba(0,0,0,0.7)] z-10 overflow-hidden"
      >
        <div className="grid grid-cols-1 lg:grid-cols-12 min-h-[580px] gap-3">
          {/* LEFT COLUMN: Visual Showcase Panel with auth_bg.png */}
          <div
            className="lg:col-span-5 relative rounded-2xl overflow-hidden p-6 md:p-8 flex flex-col justify-between bg-cover bg-center border border-white/10"
            style={{
              backgroundImage: `linear-gradient(to bottom, rgba(9, 10, 15, 0.55), rgba(9, 10, 15, 0.90)), url('/assets/images/auth-bg.png')`
            }}
          >
            {/* Top Brand Bar */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <motion.div
                  whileHover={{ scale: 1.08, rotate: -5 }}
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

            {/* Middle Feature Content */}
            <div className="my-8 space-y-3">
              <span className="px-3 py-1 rounded-full text-[11px] font-mono font-semibold bg-purple-500/20 text-purple-300 border border-purple-500/30 inline-block shadow-[0_0_12px_rgba(168,85,247,0.2)]">
                JOIN THE WORKSPACE
              </span>
              <h2 className="text-2xl md:text-3xl font-extrabold text-white leading-tight">
                Empower your productivity with real-time office tools.
              </h2>
              <p className="text-xs text-slate-300 leading-relaxed">
                Create your account to unlock team communication, task boards, attendance logs, and AI query assistance.
              </p>
            </div>

            {/* Bottom Info Note */}
            <div className="p-3.5 rounded-xl bg-slate-950/80 backdrop-blur-md border border-white/10 space-y-1">
              <span className="text-[10px] text-cyan-400 font-mono font-bold block">INSTANT ONBOARDING</span>
              <p className="text-xs text-slate-300">
                Your role and department permissions are automatically configured upon registration.
              </p>
            </div>
          </div>

          {/* RIGHT COLUMN: Signup Form Area */}
          <div className="lg:col-span-7 p-6 md:p-10 flex flex-col justify-between space-y-6">
            {/* Top Navigation Row */}
            <div className="flex items-center justify-between pb-2 border-b border-white/5">
              <div className="flex items-center gap-2">
                <Shield size={18} className="text-purple-400" />
                <span className="text-xs font-bold text-slate-200 uppercase tracking-wider">Registration</span>
              </div>
              <div className="flex items-center gap-3 text-xs">
                <span className="text-slate-400 hidden sm:inline">Already registered?</span>
                <button
                  type="button"
                  onClick={onSwitchToLogin}
                  className="px-3.5 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-purple-300 border border-purple-500/30 text-xs font-semibold transition-all hover:scale-105"
                >
                  Sign In
                </button>
              </div>
            </div>

            {/* Form & Greeting */}
            <div className="space-y-4 my-auto">
              <div>
                <h2 className="text-2xl md:text-3xl font-extrabold text-white">Create Account</h2>
                <p className="text-xs text-slate-400 mt-1">Fill in your profile details to join WorkSync</p>
              </div>

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

              <form onSubmit={handleSignupSubmit} className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* Full Name */}
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-slate-300 block">Full Name</label>
                    <div className="relative">
                      <UserIcon size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        type="text"
                        required
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="John Doe"
                        className="w-full pl-9 pr-3 py-2 rounded-xl bg-black/40 border border-white/10 text-xs text-slate-100 focus:outline-none focus:border-cyan-500/60 transition-all"
                      />
                    </div>
                  </div>

                  {/* Work Email */}
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-slate-300 block">Work Email</label>
                    <div className="relative">
                      <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        type="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="john@codoc.com"
                        className="w-full pl-9 pr-3 py-2 rounded-xl bg-black/40 border border-white/10 text-xs text-slate-100 focus:outline-none focus:border-cyan-500/60 transition-all"
                      />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* Role Select */}
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-slate-300 block">Role</label>
                    <div className="relative">
                      <Briefcase size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                      <select
                        value={role}
                        onChange={(e) => setRoleState(e.target.value as UserRole)}
                        className="w-full pl-9 pr-3 py-2 rounded-xl bg-black/40 border border-white/10 text-xs text-slate-100 focus:outline-none focus:border-cyan-500/60 transition-all appearance-none"
                      >
                        <option value="Team_Member" className="bg-slate-900">Team Member</option>
                        <option value="Team_Lead" className="bg-slate-900">Team Lead</option>
                        <option value="HR" className="bg-slate-900">HR Specialist</option>
                        <option value="Admin" className="bg-slate-900">Administrator</option>
                      </select>
                    </div>
                  </div>

                  {/* Department */}
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-slate-300 block">Department</label>
                    <div className="relative">
                      <Building2 size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                      <select
                        value={department}
                        onChange={(e) => setDepartment(e.target.value)}
                        className="w-full pl-9 pr-3 py-2 rounded-xl bg-black/40 border border-white/10 text-xs text-slate-100 focus:outline-none focus:border-cyan-500/60 transition-all appearance-none"
                      >
                        <option value="Engineering" className="bg-slate-900">Engineering</option>
                        <option value="IT" className="bg-slate-900">IT</option>
                        <option value="Human Resources & People Ops" className="bg-slate-900">Human Resources</option>
                        <option value="Executive Operations" className="bg-slate-900">Executive Ops</option>
                        <option value="AI Research" className="bg-slate-900">AI Research</option>
                      </select>
                    </div>
                  </div>
                </div>

                {/* Title */}
                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-300 block">Job Title / Designation</label>
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Full Stack Software Engineer"
                    className="w-full px-3 py-2 rounded-xl bg-black/40 border border-white/10 text-xs text-slate-100 focus:outline-none focus:border-cyan-500/60 transition-all"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* Password */}
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-slate-300 block">Password</label>
                    <div className="relative">
                      <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        type={showPassword ? 'text' : 'password'}
                        required
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="••••••••"
                        className="w-full pl-9 pr-8 py-2 rounded-xl bg-black/40 border border-white/10 text-xs text-slate-100 focus:outline-none focus:border-cyan-500/60 transition-all"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                      >
                        {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    </div>
                  </div>

                  {/* Confirm Password */}
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-slate-300 block">Confirm Password</label>
                    <div className="relative">
                      <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        type={showPassword ? 'text' : 'password'}
                        required
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="••••••••"
                        className="w-full pl-9 pr-3 py-2 rounded-xl bg-black/40 border border-white/10 text-xs text-slate-100 focus:outline-none focus:border-cyan-500/60 transition-all"
                      />
                    </div>
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
                      Register Account <ArrowRight size={16} />
                    </>
                  )}
                </motion.button>
              </form>
            </div>

            {/* Bottom Footer Info */}
            <div className="pt-3 border-t border-white/5 flex items-center justify-between text-[11px] text-slate-500">
              <span>Secure Registration</span>
              <span>WorkSync v1.0.4</span>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
};
