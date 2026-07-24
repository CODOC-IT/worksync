import React, { useState } from 'react';
import { useApp } from '../../store/AppContext';
import { UserRole } from '../../types';
import { Sparkles, Lock, Mail, User as UserIcon, Building2, Briefcase, Eye, EyeOff, ArrowRight, AlertCircle } from 'lucide-react';

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
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          email,
          password,
          role,
          department,
          title: title || `${role.replace('_', ' ')} Specialist`
        })
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message || 'Registration failed.');
      }

      if (data.token) {
        localStorage.setItem('worksync_auth_token', data.token);
      }

      setRole(role);
      onSignupSuccess();
    } catch (err: any) {
      setErrorMsg(err.message || 'Registration failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-screen flex items-center justify-center bg-[#090a0f] text-slate-100 p-4 relative overflow-hidden cursor-glow-container">
      {/* Background Blobs */}
      <div className="absolute top-1/4 -right-20 w-96 h-96 bg-purple-600/15 rounded-full blur-3xl pointer-events-none animate-pulse" />
      <div className="absolute bottom-1/4 -left-20 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none animate-pulse" />

      <div className="w-full max-w-lg z-10 space-y-6">
        {/* Brand Header */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-tr from-cyan-500 via-purple-600 to-pink-500 p-0.5 shadow-[0_0_25px_rgba(0,242,254,0.4)] mb-2">
            <div className="w-full h-full bg-slate-950 rounded-[14px] flex items-center justify-center">
              <Sparkles size={28} className="text-cyan-400 animate-pulse" />
            </div>
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-cyan-400 via-purple-300 to-pink-400 bg-clip-text text-transparent">
            Join WorkSync
          </h1>
          <p className="text-xs text-slate-400 font-mono tracking-wide">CREATE YOUR ENTERPRISE ACCOUNT</p>
        </div>

        {/* Signup Card */}
        <div className="glass-panel p-8 border border-white/10 shadow-[0_0_30px_rgba(0,0,0,0.5)] space-y-5 relative">
          {errorMsg && (
            <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-300 flex items-center gap-2">
              <AlertCircle size={16} className="shrink-0 text-rose-400" />
              <span>{errorMsg}</span>
            </div>
          )}

          <form onSubmit={handleSignupSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Role Select */}
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-300 block">Organizational Role</label>
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

            {/* Title / Designation */}
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

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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

            <button
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
            </button>
          </form>

          {/* Toggle to Login */}
          <div className="pt-4 border-t border-white/10 text-center">
            <p className="text-xs text-slate-400">
              Already have an account?{' '}
              <button
                type="button"
                onClick={onSwitchToLogin}
                className="text-cyan-400 hover:underline font-bold transition-colors"
              >
                Sign In
              </button>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
