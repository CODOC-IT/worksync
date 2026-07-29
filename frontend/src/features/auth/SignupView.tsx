import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { AlertCircle, ArrowRight, Briefcase, Building2, Check, Eye, EyeOff, Lock, Mail, Shield, Sparkles, User as UserIcon, X } from 'lucide-react';
import { useApp } from '../../store/AppContext';
import { UserRole } from '../../types';
import { OTPVerificationView } from './OTPVerificationView';

interface SignupViewProps {
  onSignupSuccess: () => void;
  onSwitchToLogin: () => void;
}

export const SignupView: React.FC<SignupViewProps> = ({ onSignupSuccess, onSwitchToLogin }) => {
  const { onUserRegistered } = useApp();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [department, setDepartment] = useState('Engineering');
  const [title, setTitle] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showOTP, setShowOTP] = useState(false);
  const [role, setRole] = useState<UserRole>('Team_Member');
  const [roleStatus, setRoleStatus] = useState({ hasAdmin: false, hasHR: false });

  useEffect(() => {
    fetch('/api/auth/role-status')
      .then((response) => response.json())
      .then((data) => {
        if (!data.success) return;
        const nextStatus = { hasAdmin: Boolean(data.hasAdmin), hasHR: Boolean(data.hasHR) };
        setRoleStatus(nextStatus);
        setRole((currentRole) =>
          (currentRole === 'Admin' && nextStatus.hasAdmin) || (currentRole === 'HR' && nextStatus.hasHR)
            ? 'Team_Member'
            : currentRole
        );
      })
      .catch(() => {
        // Keep all roles selectable when occupancy status is unavailable.
      });
  }, []);

  const isLeadOrMember = role === 'Team_Lead' || role === 'Team_Member';

  const passwordCriteria = useMemo(() => ({
    hasMinLength: password.length >= 8,
    hasUpper: /[A-Z]/.test(password),
    hasLower: /[a-z]/.test(password),
    hasNumber: /[0-9]/.test(password),
    hasSpecial: /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>/?]/.test(password)
  }), [password]);

  const strengthScore = useMemo(
    () => Object.values(passwordCriteria).filter(Boolean).length,
    [passwordCriteria]
  );

  const strengthConfig = useMemo(() => {
    if (!password) return { label: 'Empty', color: 'bg-slate-700', text: 'text-slate-500', percent: 0 };
    if (strengthScore <= 2) return { label: 'Weak', color: 'bg-rose-500', text: 'text-rose-400', percent: 33 };
    if (strengthScore <= 4) return { label: 'Medium', color: 'bg-amber-500', text: 'text-amber-400', percent: 66 };
    return { label: 'Strong', color: 'bg-emerald-500', text: 'text-emerald-400', percent: 100 };
  }, [password, strengthScore]);

  const handleSignupSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setErrorMsg(null);
    const sanitizedName = name.trim();
    const nameParts = sanitizedName.split(/\s+/).filter(Boolean);
    if (sanitizedName.length < 4 || nameParts.length < 2) {
      setErrorMsg('Full name must include a first and last name.');
      return;
    }
    if (nameParts[0].toLowerCase() === nameParts[nameParts.length - 1].toLowerCase()) {
      setErrorMsg('First name and last name cannot be the same.');
      return;
    }
    if (!/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(email.trim())) {
      setErrorMsg('Please enter a valid email address.');
      return;
    }
    if (strengthScore < 3) {
      setErrorMsg('Password is too weak. Please meet at least 3 of the strength criteria.');
      return;
    }
    if (password !== confirmPassword) {
      setErrorMsg('Passwords do not match.');
      return;
    }
    if (role === 'Admin' && roleStatus.hasAdmin) {
      setErrorMsg('An Administrator account already exists in this organization. Only one Admin is permitted.');
      return;
    }
    if (role === 'HR' && roleStatus.hasHR) {
      setErrorMsg('An HR Specialist account already exists in this organization. Only one HR is permitted.');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch('/api/otp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), name: sanitizedName, role })
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.message || 'Failed to send verification code.');
      setShowOTP(true);
    } catch (error: any) {
      setErrorMsg(error.message || 'Registration failed.');
    } finally {
      setLoading(false);
    }
  };


  const handleOTPSuccess = (_token: string, user: any) => {
    if (user) onUserRegistered(user);
    onSignupSuccess();
  };

  if (showOTP) {
    const finalDepartment = isLeadOrMember
      ? department
      : role === 'HR'
        ? 'Human Resources & People Ops'
        : 'Executive Operations';
    const finalTitle = isLeadOrMember
      ? title.trim() || `${role.replace('_', ' ')} Specialist`
      : role === 'HR'
        ? 'HR Specialist'
        : 'Administrator';

    return (
      <OTPVerificationView
        email={email.trim()}
        name={name.trim()}
        registrationData={{
          password,
          role,
          department: finalDepartment,
          title: finalTitle
        }}
        onVerifySuccess={handleOTPSuccess}
        onBack={() => setShowOTP(false)}
      />
    );
  }

  return (
    <div
      data-login-page
      className="min-h-screen w-screen flex items-center justify-center bg-[var(--bg-canvas)] text-slate-100 p-4 md:p-8 relative overflow-hidden bg-cover bg-center bg-no-repeat"
      style={{
        backgroundImage: `linear-gradient(to bottom, rgba(9, 10, 15, 0.88), rgba(9, 10, 15, 0.95)), url('/assets/images/auth-bg.png')`
      }}
    >
      <motion.div
        animate={{ scale: [1, 1.25, 1], opacity: [0.15, 0.28, 0.15], x: [0, -25, 0], y: [0, 25, 0] }}
        transition={{ duration: 14, repeat: Infinity, ease: 'easeInOut' }}
        className="absolute top-1/4 -right-20 w-96 h-96 bg-purple-600/25 rounded-full blur-3xl pointer-events-none"
      />
      <motion.div
        animate={{ scale: [1, 1.2, 1], opacity: [0.15, 0.25, 0.15], x: [0, 25, 0], y: [0, -25, 0] }}
        transition={{ duration: 16, repeat: Infinity, ease: 'easeInOut', delay: 3 }}
        className="absolute bottom-1/4 -left-20 w-96 h-96 bg-cyan-600/20 rounded-full blur-3xl pointer-events-none"
      />

      <div className="w-full max-w-5xl grid grid-cols-1 lg:grid-cols-12 rounded-3xl overflow-hidden bg-slate-900/70 backdrop-blur-2xl border border-white/10 shadow-2xl shadow-purple-950/40 relative z-10 lg:min-h-[600px] lg:max-h-[90vh]">
        <div className="lg:col-span-5 relative p-6 md:p-8 flex flex-col justify-between border-b lg:border-b-0 lg:border-r border-white/10 bg-gradient-to-br from-purple-950/60 via-slate-950/80 to-slate-950/90">
          <div className="flex items-center gap-3 relative z-10">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-cyan-500 to-purple-600 p-0.5 shadow-lg shadow-cyan-500/20">
              <div className="w-full h-full bg-slate-950 rounded-[10px] flex items-center justify-center">
                <Sparkles size={18} className="text-cyan-400" />
              </div>
            </div>
            <div>
              <span className="font-extrabold text-sm tracking-tight text-white block">WorkSync</span>
              <span className="text-[10px] text-purple-300/70 uppercase tracking-widest block font-mono">Enterprise Portal</span>
            </div>
          </div>

          <div className="my-8 relative z-10 space-y-4">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-medium bg-purple-500/10 text-purple-300 border border-purple-500/20">
              <Sparkles size={12} className="text-cyan-400" /> Account Creation
            </span>
            <h2 className="text-2xl md:text-3xl font-extrabold text-white leading-tight">Join the Next-Gen Workspace Platform</h2>
            <p className="text-xs text-slate-300 leading-relaxed">
              Create your account to unlock team communication, task boards, attendance logs, and AI assistance.
            </p>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-950/80 backdrop-blur-md border border-white/10 space-y-1 relative z-10">
            <span className="text-[10px] text-cyan-400 font-mono font-bold block">INSTANT ONBOARDING</span>
            <p className="text-[11px] text-slate-400">Your selected role and department permissions are configured during registration.</p>
          </div>
        </div>

        <div className="lg:col-span-7 flex flex-col min-h-0">
          <div className="flex-1 overflow-y-auto px-4 sm:px-6 md:px-10 pt-4 sm:pt-6 md:pt-8 min-h-0">
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
                  className="px-3.5 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-purple-300 border border-purple-500/30 text-xs font-semibold transition-all"
                >
                  Sign In
                </button>
              </div>
            </div>

            <div className="space-y-4 py-5">
              <div>
                <h2 className="text-2xl md:text-3xl font-extrabold text-white">Create Account</h2>
                <p className="text-xs text-slate-400 mt-1">Fill in your profile details to join WorkSync</p>
              </div>

              {errorMsg && (
                <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-300 flex items-center gap-2">
                  <AlertCircle size={16} className="shrink-0 text-rose-400" />
                  <span>{errorMsg}</span>
                </div>
              )}

              <form id="signup-form" onSubmit={handleSignupSubmit} className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-slate-300 block">Full Name</label>
                    <div className="relative">
                      <UserIcon size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        type="text"
                        required
                        autoComplete="name"
                        value={name}
                        onChange={(event) => setName(event.target.value)}
                        placeholder="John Doe"
                        className="w-full pl-9 pr-3 py-2 rounded-xl bg-black/40 border border-white/10 text-xs text-slate-100 focus:outline-none focus:border-cyan-500/60 transition-all"
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-medium text-slate-300 block">Work Email</label>
                    <div className="relative">
                      <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        type="email"
                        required
                        autoComplete="email"
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                        placeholder="john@company.com"
                        className="w-full pl-9 pr-3 py-2 rounded-xl bg-black/40 border border-white/10 text-xs text-slate-100 focus:outline-none focus:border-cyan-500/60 transition-all"
                      />
                    </div>
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-300 block">Role</label>
                  <div className="relative">
                    <Briefcase size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <select
                      value={role}
                      onChange={(event) => setRole(event.target.value as UserRole)}
                      className="w-full pl-9 pr-3 py-2 rounded-xl bg-black/40 border border-white/10 text-xs text-slate-100 focus:outline-none focus:border-cyan-500/60 appearance-none"
                    >
                      <option value="Team_Member" className="bg-slate-900">Team Member</option>
                      <option value="Team_Lead" className="bg-slate-900">Team Lead</option>
                      <option value="HR" disabled={roleStatus.hasHR} className="bg-slate-900">
                        {roleStatus.hasHR ? 'HR Specialist (Occupied - 1 Max)' : 'HR Specialist'}
                      </option>
                      <option value="Admin" disabled={roleStatus.hasAdmin} className="bg-slate-900">
                        {roleStatus.hasAdmin ? 'Administrator (Occupied - 1 Max)' : 'Administrator'}
                      </option>
                    </select>
                  </div>
                </div>

                {isLeadOrMember && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-slate-300 block">Department</label>
                      <div className="relative">
                        <Building2 size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                        <select
                          value={department}
                          onChange={(event) => setDepartment(event.target.value)}
                          className="w-full pl-9 pr-3 py-2 rounded-xl bg-black/40 border border-white/10 text-xs text-slate-100 focus:outline-none focus:border-cyan-500/60 appearance-none"
                        >
                          <option value="Engineering" className="bg-slate-900">Engineering</option>
                          <option value="IT" className="bg-slate-900">IT</option>
                          <option value="Human Resources & People Ops" className="bg-slate-900">Human Resources</option>
                          <option value="Executive Operations" className="bg-slate-900">Executive Operations</option>
                          <option value="AI Research" className="bg-slate-900">AI Research</option>
                        </select>
                      </div>
                    </div>

                    <div className="space-y-1">
                      <label className="text-xs font-medium text-slate-300 block">Job Title / Designation</label>
                      <input
                        type="text"
                        value={title}
                        onChange={(event) => setTitle(event.target.value)}
                        placeholder="Software Engineer"
                        className="w-full px-3 py-2 rounded-xl bg-black/40 border border-white/10 text-xs text-slate-100 focus:outline-none focus:border-cyan-500/60 transition-all"
                      />
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-slate-300 block">Password</label>
                    <div className="relative">
                      <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        type={showPassword ? 'text' : 'password'}
                        required
                        autoComplete="new-password"
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        placeholder="••••••••"
                        className="w-full pl-9 pr-8 py-2 rounded-xl bg-black/40 border border-white/10 text-xs text-slate-100 focus:outline-none focus:border-cyan-500/60"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((visible) => !visible)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                      >
                        {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-medium text-slate-300 block">Confirm Password</label>
                    <div className="relative">
                      <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        type={showConfirmPassword ? 'text' : 'password'}
                        required
                        autoComplete="new-password"
                        value={confirmPassword}
                        onChange={(event) => setConfirmPassword(event.target.value)}
                        placeholder="••••••••"
                        className="w-full pl-9 pr-8 py-2 rounded-xl bg-black/40 border border-white/10 text-xs text-slate-100 focus:outline-none focus:border-cyan-500/60"
                      />
                      <button
                        type="button"
                        onClick={() => setShowConfirmPassword((visible) => !visible)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                        aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                      >
                        {showConfirmPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    </div>
                  </div>
                </div>

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
                    <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${strengthConfig.percent}%` }}
                        transition={{ duration: 0.3 }}
                        className={`h-full ${strengthConfig.color} rounded-full`}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-1.5 pt-1 text-[11px]">
                      {[
                        ['8+ characters', passwordCriteria.hasMinLength],
                        ['Uppercase (A-Z)', passwordCriteria.hasUpper],
                        ['Lowercase (a-z)', passwordCriteria.hasLower],
                        ['Number (0-9)', passwordCriteria.hasNumber],
                        ['Special (!@#$)', passwordCriteria.hasSpecial]
                      ].map(([label, met]) => (
                        <div key={String(label)} className={`flex items-center gap-1.5 ${met ? 'text-emerald-400' : 'text-slate-500'}`}>
                          {met ? <Check size={12} /> : <X size={12} />}
                          <span>{label}</span>
                        </div>
                      ))}
                    </div>
                  </motion.div>
                )}
              </form>
            </div>
          </div>

          <div className="px-4 sm:px-6 md:px-10 pt-3 pb-4 border-t border-white/5 bg-slate-900/60 backdrop-blur-sm shrink-0">
            <motion.button
              form="signup-form"
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.99 }}
              type="submit"
              disabled={loading}
              className="w-full py-2.5 rounded-xl bg-gradient-to-r from-purple-600 via-indigo-600 to-cyan-500 hover:from-purple-500 hover:to-cyan-400 text-white font-bold text-xs shadow-lg shadow-purple-950/50 flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {loading ? (
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <><span>Verify & Continue</span><ArrowRight size={14} /></>
              )}
            </motion.button>
            <p className="text-[11px] text-slate-500 text-center mt-2 flex items-center justify-between">
              <span>Secure Registration</span>
              <span className="font-mono text-slate-600">WorkSync v1.0.4</span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};