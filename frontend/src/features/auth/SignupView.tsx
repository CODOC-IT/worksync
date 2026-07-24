import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useApp } from '../../store/AppContext';
import { UserRole } from '../../types';
import { Sparkles, Lock, Mail, User as UserIcon, Building2, Briefcase, Eye, EyeOff, ArrowRight, AlertCircle, Shield, Check, X } from 'lucide-react';
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
  const [showConfirmPassword, setShowConfirmPassword] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showOTP, setShowOTP] = useState<boolean>(false);

  // Check if role requires Department & Job Title fields
  const isLeadOrMember = role === 'Team_Lead' || role === 'Team_Member';

  // Password Strength Criteria Calculation
  const passwordCriteria = useMemo(() => {
    return {
      hasMinLength: password.length >= 8,
      hasUpper: /[A-Z]/.test(password),
      hasLower: /[a-z]/.test(password),
      hasNumber: /[0-9]/.test(password),
      hasSpecial: /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>/?]/.test(password)
    };
  }, [password]);

  const strengthScore = useMemo(() => {
    let score = 0;
    if (passwordCriteria.hasMinLength) score++;
    if (passwordCriteria.hasUpper) score++;
    if (passwordCriteria.hasLower) score++;
    if (passwordCriteria.hasNumber) score++;
    if (passwordCriteria.hasSpecial) score++;
    return score;
  }, [passwordCriteria]);

  const strengthConfig = useMemo(() => {
    if (!password) return { label: 'Empty', color: 'bg-slate-700', text: 'text-slate-500', percent: 0 };
    if (strengthScore <= 2) return { label: 'Weak', color: 'bg-rose-500', text: 'text-rose-400', percent: 33 };
    if (strengthScore <= 4) return { label: 'Medium', color: 'bg-amber-500', text: 'text-amber-400', percent: 66 };
    return { label: 'Strong', color: 'bg-emerald-500', text: 'text-emerald-400', percent: 100 };
  }, [password, strengthScore]);

  const handleSignupSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    // 1. Full Name Validation (minimum 4 characters)
    if (name.trim().length < 4) {
      setErrorMsg('Full Name must be at least 4 characters long.');
      return;
    }

    // 2. Email Regex Validation
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    if (!emailRegex.test(email.trim())) {
      setErrorMsg('Please enter a valid email address (e.g. user@domain.com).');
      return;
    }

    // 3. Password Strength Validation
    if (strengthScore < 3) {
      setErrorMsg('Password is too weak. Please meet at least 3 of the strength criteria.');
      return;
    }

    // 4. Confirm Password Match
    if (password !== confirmPassword) {
      setErrorMsg('Passwords do not match.');
      return;
    }

    setLoading(true);

    // Determine final department & title based on role
    const finalDepartment = isLeadOrMember
      ? department
      : role === 'HR'
      ? 'Human Resources & People Ops'
      : 'Executive Operations';

    const finalTitle = isLeadOrMember
      ? title || `${role.replace('_', ' ')} Specialist`
      : role === 'HR'
      ? 'HR Specialist'
      : 'Administrator';

    try {
      // Send OTP to email first — registration happens after OTP verification
      const res = await fetch('/api/otp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), name: name.trim() })
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
    const finalDept = isLeadOrMember ? department : role === 'HR' ? 'Human Resources & People Ops' : 'Executive Operations';
    const finalTtl = isLeadOrMember ? title || `${role.replace('_', ' ')} Specialist` : role === 'HR' ? 'HR Specialist' : 'Administrator';

    return (
      <OTPVerificationView
        email={email.trim()}
        name={name.trim()}
        registrationData={{ password, role, department: finalDept, title: finalTtl }}
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
          x: [0, 25, 0],
          y: [0, -25, 0]
        }}
        transition={{ duration: 16, repeat: Infinity, ease: 'easeInOut', delay: 3 }}
        className="absolute bottom-1/4 -left-20 w-96 h-96 bg-cyan-600/20 rounded-full blur-3xl pointer-events-none"
      />

      {/* Main Glassmorphism Split-Screen Container */}
      <motion.div
        initial={{ opacity: 0, y: 24, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.45, ease: 'easeOut' }}
        className="w-full max-w-5xl grid grid-cols-1 lg:grid-cols-12 rounded-3xl overflow-hidden bg-slate-900/70 backdrop-blur-2xl border border-white/10 shadow-2xl shadow-purple-950/40 relative z-10"
      >
        {/* LEFT COLUMN: Visual Showcase Panel (40% width) */}
        <div className="lg:col-span-5 relative p-6 md:p-8 flex flex-col justify-between overflow-hidden border-b lg:border-b-0 lg:border-r border-white/10 bg-gradient-to-br from-purple-950/60 via-slate-950/80 to-slate-950/90">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-cyan-500/10 via-transparent to-transparent pointer-events-none" />

          {/* Top Brand Tag */}
          <div className="flex items-center gap-3 relative z-10">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-cyan-500 to-purple-600 p-0.5 flex items-center justify-center shadow-lg shadow-cyan-500/20">
              <div className="w-full h-full bg-slate-950 rounded-[10px] flex items-center justify-center">
                <Sparkles size={18} className="text-cyan-400" />
              </div>
            </div>
            <div>
              <span className="font-extrabold text-sm tracking-tight text-white block">WorkSync</span>
              <span className="text-[10px] text-purple-300/70 uppercase tracking-widest block font-mono">Enterprise Portal</span>
            </div>
          </div>

          {/* Hero Feature Showcase */}
          <div className="my-8 relative z-10 space-y-4">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-medium bg-purple-500/10 text-purple-300 border border-purple-500/20">
              <Sparkles size={12} className="text-cyan-400" /> Account Creation
            </span>
            <h2 className="text-2xl md:text-3xl font-extrabold text-white leading-tight">
              Join the Next-Gen Workspace Platform
            </h2>
            <p className="text-xs text-slate-300 leading-relaxed">
              Create your account to unlock team communication, task boards, attendance logs, and AI query assistance.
            </p>
          </div>

          {/* Bottom Info Note */}
          <div className="p-3.5 rounded-xl bg-slate-950/80 backdrop-blur-md border border-white/10 space-y-1 relative z-10">
            <span className="text-[10px] text-cyan-400 font-mono font-bold block">INSTANT ONBOARDING</span>
            <p className="text-xs text-slate-300">
              Your role and department permissions are automatically configured upon registration.
            </p>
          </div>
        </div>

        {/* RIGHT COLUMN: Signup Form Area (60% width) */}
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

            <AnimatePresence mode="wait">
              {errorMsg && (
                <motion.div
                  initial={{ opacity: 0, height: 0, y: -6 }}
                  animate={{ opacity: 1, height: 'auto', y: 0 }}
                  exit={{ opacity: 0, height: 0 }}
                  className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-300 flex items-center gap-2 overflow-hidden"
                >
                  <AlertCircle size={16} className="shrink-0 text-rose-400 animate-pulse" />
                  <span>{errorMsg}</span>
                </motion.div>
              )}
            </AnimatePresence>

            <form onSubmit={handleSignupSubmit} className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Full Name */}
                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-300 block">Full Name (Min 4 chars)</label>
                  <div className="relative">
                    <UserIcon size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      required
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="John Doe"
                      className={`w-full pl-9 pr-3 py-2 rounded-xl bg-black/40 border text-xs text-slate-100 focus:outline-none transition-all ${
                        name.length > 0 && name.trim().length < 4
                          ? 'border-rose-500/60 focus:border-rose-500'
                          : 'border-white/10 focus:border-cyan-500/60'
                      }`}
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
                      placeholder="john@domain.com"
                      className="w-full pl-9 pr-3 py-2 rounded-xl bg-black/40 border border-white/10 text-xs text-slate-100 focus:outline-none focus:border-cyan-500/60 transition-all"
                    />
                  </div>
                </div>
              </div>

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

              {/* Conditional Department & Job Title — Only for Team Lead & Team Member */}
              <AnimatePresence>
                {isLeadOrMember && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.2 }}
                    className="space-y-3 overflow-hidden"
                  >
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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

                      {/* Title */}
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-slate-300 block">Job Title / Designation</label>
                        <input
                          type="text"
                          value={title}
                          onChange={(e) => setTitle(e.target.value)}
                          placeholder="Full Stack Developer"
                          className="w-full px-3 py-2 rounded-xl bg-black/40 border border-white/10 text-xs text-slate-100 focus:outline-none focus:border-cyan-500/60 transition-all"
                        />
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Password & Confirm Password */}
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

                {/* Confirm Password (With Separate Eye Toggle) */}
                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-300 block">Confirm Password</label>
                  <div className="relative">
                    <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type={showConfirmPassword ? 'text' : 'password'}
                      required
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="••••••••"
                      className={`w-full pl-9 pr-8 py-2 rounded-xl bg-black/40 border text-xs text-slate-100 focus:outline-none transition-all ${
                        confirmPassword && confirmPassword !== password
                          ? 'border-rose-500/60 focus:border-rose-500'
                          : 'border-white/10 focus:border-cyan-500/60'
                      }`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                    >
                      {showConfirmPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                </div>
              </div>

              {/* Password Strength Meter & Visual Criteria Checklist */}
              {password.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  className="space-y-2 p-3 rounded-xl bg-black/30 border border-white/5 overflow-hidden"
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-400 font-medium">Password Strength:</span>
                    <span className={`font-bold ${strengthConfig.text}`}>{strengthConfig.label}</span>
                  </div>

                  {/* Progress Meter Bar */}
                  <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${strengthConfig.percent}%` }}
                      transition={{ duration: 0.3 }}
                      className={`h-full ${strengthConfig.color} rounded-full`}
                    />
                  </div>

                  {/* Criteria Checklist */}
                  <div className="grid grid-cols-2 gap-1.5 pt-1 text-[11px]">
                    <div className={`flex items-center gap-1.5 ${passwordCriteria.hasMinLength ? 'text-emerald-400' : 'text-slate-500'}`}>
                      {passwordCriteria.hasMinLength ? <Check size={12} /> : <X size={12} />}
                      <span>8+ characters</span>
                    </div>
                    <div className={`flex items-center gap-1.5 ${passwordCriteria.hasUpper ? 'text-emerald-400' : 'text-slate-500'}`}>
                      {passwordCriteria.hasUpper ? <Check size={12} /> : <X size={12} />}
                      <span>Uppercase (A-Z)</span>
                    </div>
                    <div className={`flex items-center gap-1.5 ${passwordCriteria.hasLower ? 'text-emerald-400' : 'text-slate-500'}`}>
                      {passwordCriteria.hasLower ? <Check size={12} /> : <X size={12} />}
                      <span>Lowercase (a-z)</span>
                    </div>
                    <div className={`flex items-center gap-1.5 ${passwordCriteria.hasNumber ? 'text-emerald-400' : 'text-slate-500'}`}>
                      {passwordCriteria.hasNumber ? <Check size={12} /> : <X size={12} />}
                      <span>Number (0-9)</span>
                    </div>
                    <div className={`flex items-center gap-1.5 ${passwordCriteria.hasSpecial ? 'text-emerald-400' : 'text-slate-500'}`}>
                      {passwordCriteria.hasSpecial ? <Check size={12} /> : <X size={12} />}
                      <span>Special (!@#$)</span>
                    </div>
                  </div>
                </motion.div>
              )}

              {/* Submit Button */}
              <motion.button
                whileHover={{ scale: 1.01 }}
                whileTap={{ scale: 0.99 }}
                type="submit"
                disabled={loading}
                className="w-full mt-4 py-2.5 rounded-xl bg-gradient-to-r from-purple-600 via-indigo-600 to-cyan-500 hover:from-purple-500 hover:to-cyan-400 text-white font-bold text-xs shadow-lg shadow-purple-950/50 flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50"
              >
                {loading ? (
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <>
                    <span>Verify & Continue</span>
                    <ArrowRight size={14} />
                  </>
                )}
              </motion.button>
            </form>
          </div>

          {/* Footer Note */}
          <div className="text-[11px] text-slate-500 text-center pt-2 border-t border-white/5 flex items-center justify-between">
            <span>Secure Registration</span>
            <span className="font-mono text-slate-600">WorkSync v1.0.4</span>
          </div>
        </div>
      </motion.div>
    </div>
  );
};
