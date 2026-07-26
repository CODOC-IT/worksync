import React, { useState, useRef, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Mail, Shield, ArrowLeft, CheckCircle, AlertCircle, RefreshCw, Lock, Eye, EyeOff, KeyRound } from 'lucide-react';

interface ForgotPasswordViewProps {
  onBackToLogin: () => void;
}

export const ForgotPasswordView: React.FC<ForgotPasswordViewProps> = ({ onBackToLogin }) => {
  const [step, setStep] = useState<'email' | 'otp' | 'password'>('email');
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState<string[]>(['', '', '', '', '', '']);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [resendCooldown, setResendCooldown] = useState(0);

  // Password Strength
  const passwordCriteria = useMemo(() => ({
    hasMinLength: newPassword.length >= 8,
    hasUpper: /[A-Z]/.test(newPassword),
    hasLower: /[a-z]/.test(newPassword),
    hasNumber: /[0-9]/.test(newPassword),
    hasSpecial: /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>/?]/.test(newPassword)
  }), [newPassword]);

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
    if (!newPassword) return { label: 'Empty', color: 'bg-slate-700', text: 'text-slate-500', percent: 0 };
    if (strengthScore <= 2) return { label: 'Weak', color: 'bg-rose-500', text: 'text-rose-400', percent: 33 };
    if (strengthScore <= 4) return { label: 'Medium', color: 'bg-amber-500', text: 'text-amber-400', percent: 66 };
    return { label: 'Strong', color: 'bg-emerald-500', text: 'text-emerald-400', percent: 100 };
  }, [newPassword, strengthScore]);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setInterval(() => setResendCooldown((p) => (p > 0 ? p - 1 : 0)), 1000);
    return () => clearInterval(timer);
  }, [resendCooldown]);

  const handleSendOTP = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    if (!emailRegex.test(email.trim())) {
      setErrorMsg('Please enter a valid email address.');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() })
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message);
      setSuccessMsg('If an account exists, a verification code has been sent.');
      setTimeout(() => setSuccessMsg(null), 5000);
      setStep('otp');
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to send verification code.');
    } finally {
      setLoading(false);
    }
  };

  const handleOtpChange = (index: number, value: string) => {
    if (!/^\d*$/.test(value)) return;
    const newOtp = [...otp];
    newOtp[index] = value.slice(-1);
    setOtp(newOtp);
    setErrorMsg(null);
    if (value && index < 5) inputRefs.current[index + 1]?.focus();
  };

  const handleOtpKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !otp[index] && index > 0) inputRefs.current[index - 1]?.focus();
    if (e.key === 'Enter') handleVerifyOTP();
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (pasted.length === 6) {
      setOtp(pasted.split(''));
      inputRefs.current[5]?.focus();
    }
    e.preventDefault();
  };

  const handleVerifyOTP = async () => {
    const otpCode = otp.join('');
    if (otpCode.length !== 6) {
      setErrorMsg('Please enter the complete 6-digit code.');
      return;
    }
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/otp/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), otp: otpCode, purpose: 'password_reset' })
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || 'Verification failed.');
      localStorage.setItem('worksync_reset_token', data.resetToken);
      setStep('password');
      setOtp(['', '', '', '', '', '']);
    } catch (err: any) {
      setErrorMsg(err.message || 'Verification failed.');
      setOtp(['', '', '', '', '', '']);
      inputRefs.current[0]?.focus();
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (resendCooldown > 0) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() })
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message);
      setResendCooldown(60);
      setOtp(['', '', '', '', '', '']);
      inputRefs.current[0]?.focus();
      setSuccessMsg('A new code has been sent to your email.');
      setTimeout(() => setSuccessMsg(null), 4000);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to resend code.');
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (strengthScore < 3) {
      setErrorMsg('Password is too weak. Please meet at least 3 of the strength criteria.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setErrorMsg('Passwords do not match.');
      return;
    }

    const resetToken = localStorage.getItem('worksync_reset_token');
    if (!resetToken) {
      setErrorMsg('Session expired. Please start over.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/auth/password', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resetToken, newPassword })
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message);
      localStorage.removeItem('worksync_reset_token');
      setSuccessMsg('Password updated successfully! Redirecting to login...');
      setTimeout(() => onBackToLogin(), 2000);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to update password.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-screen flex items-center justify-center bg-[var(--bg-canvas)] text-slate-100 relative overflow-hidden"
      style={{
        backgroundImage: `linear-gradient(to bottom, rgba(9,10,15,0.92), rgba(9,10,15,0.97)), url('/assets/images/auth-bg.png')`,
        backgroundSize: 'cover',
        backgroundPosition: 'center'
      }}
    >
      <motion.div
        animate={{ scale: [1, 1.15, 1], opacity: [0.12, 0.2, 0.12] }}
        transition={{ duration: 7, repeat: Infinity, ease: 'easeInOut' }}
        className="absolute top-1/4 left-1/4 w-96 h-96 bg-cyan-500 rounded-full blur-[120px] pointer-events-none"
      />
      <motion.div
        animate={{ scale: [1, 1.2, 1], opacity: [0.1, 0.18, 0.1] }}
        transition={{ duration: 9, repeat: Infinity, ease: 'easeInOut', delay: 2 }}
        className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-violet-600 rounded-full blur-[120px] pointer-events-none"
      />

      <motion.div
        initial={{ opacity: 0, y: 32, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
        className="relative z-10 w-full max-w-md mx-2 sm:mx-4"
      >
        <div className="bg-slate-900/80 backdrop-blur-2xl border border-cyan-500/20 rounded-2xl p-5 sm:p-8 shadow-2xl shadow-cyan-500/5">
          <div className="flex justify-center mb-6">
            <motion.div
              animate={{ rotate: [0, 5, -5, 0] }}
              transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
              className="w-16 h-16 rounded-2xl bg-gradient-to-br from-cyan-500/20 to-violet-600/20 border border-cyan-500/30 flex items-center justify-center"
            >
              <KeyRound className="w-8 h-8 text-cyan-400" />
            </motion.div>
          </div>

          <AnimatePresence mode="wait">
            {step === 'email' && (
              <motion.div key="email" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <h1 className="text-2xl font-bold text-center text-white mb-1">Forgot Password</h1>
                <p className="text-slate-400 text-sm text-center mb-6">Enter your email to receive a verification code.</p>

                <form onSubmit={handleSendOTP} className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-slate-300 block">Work Email</label>
                    <div className="relative">
                      <Mail size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        type="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="name@codoc.com"
                        className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-black/40 border border-white/10 text-sm text-slate-100 focus:outline-none focus:border-cyan-500/60 focus:ring-1 focus:ring-cyan-500/60 transition-all"
                      />
                    </div>
                  </div>

                  {errorMsg && (
                    <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3">
                      <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                      <span className="text-red-400 text-sm">{errorMsg}</span>
                    </div>
                  )}

                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    type="submit"
                    disabled={loading}
                    className="w-full h-12 rounded-xl font-bold text-sm tracking-wide bg-gradient-to-r from-cyan-500 to-violet-600 hover:from-cyan-400 hover:to-violet-500 disabled:opacity-50 disabled:cursor-not-allowed text-white shadow-lg shadow-cyan-500/25 transition-all duration-200 flex items-center justify-center gap-2"
                  >
                    {loading ? (
                      <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    ) : (
                      <>Send Verification Code</>
                    )}
                  </motion.button>
                </form>

                <button onClick={onBackToLogin} className="flex items-center gap-1.5 text-slate-400 hover:text-white transition-colors text-sm mt-4 mx-auto">
                  <ArrowLeft className="w-4 h-4" />
                  Back to Login
                </button>
              </motion.div>
            )}

            {step === 'otp' && (
              <motion.div key="otp" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <h1 className="text-2xl font-bold text-center text-white mb-1">Verify Email</h1>
                <p className="text-slate-400 text-sm text-center mb-2">Enter the 6-digit code sent to</p>
                <div className="flex items-center justify-center gap-2 mb-6">
                  <Mail className="w-4 h-4 text-cyan-400" />
                  <span className="text-cyan-400 font-medium text-sm">{email}</span>
                </div>

                <div className="flex gap-2 sm:gap-3 justify-center mb-6" onPaste={handlePaste}>
                  {otp.map((digit, i) => (
                    <motion.input
                      key={i}
                      ref={(el) => { inputRefs.current[i] = el; }}
                      type="text"
                      inputMode="numeric"
                      maxLength={1}
                      value={digit}
                      onChange={(e) => handleOtpChange(i, e.target.value)}
                      onKeyDown={(e) => handleOtpKeyDown(i, e)}
                      whileFocus={{ scale: 1.08 }}
                      autoFocus={i === 0}
                      className={`w-10 h-12 sm:w-12 sm:h-14 text-lg sm:text-xl font-bold rounded-xl border-2 bg-slate-800/60 text-white outline-none transition-all duration-200 ${
                        digit ? 'border-cyan-400 shadow-[0_0_12px_rgba(0,212,255,0.3)]' : 'border-slate-700'
                      } ${errorMsg ? 'border-red-500/60' : ''} focus:border-cyan-400 focus:shadow-[0_0_12px_rgba(0,212,255,0.3)]`}
                    />
                  ))}
                </div>

                <AnimatePresence mode="wait">
                  {errorMsg && (
                    <motion.div key="err" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                      className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 mb-4">
                      <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                      <span className="text-red-400 text-sm">{errorMsg}</span>
                    </motion.div>
                  )}
                  {successMsg && (
                    <motion.div key="suc" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                      className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/30 rounded-xl px-4 py-3 mb-4">
                      <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
                      <span className="text-emerald-400 text-sm">{successMsg}</span>
                    </motion.div>
                  )}
                </AnimatePresence>

                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={handleVerifyOTP}
                  disabled={loading || otp.join('').length !== 6}
                  className="w-full h-12 rounded-xl font-bold text-sm tracking-wide bg-gradient-to-r from-cyan-500 to-violet-600 hover:from-cyan-400 hover:to-violet-500 disabled:opacity-50 disabled:cursor-not-allowed text-white shadow-lg shadow-cyan-500/25 transition-all duration-200 flex items-center justify-center gap-2 mb-4"
                >
                  {loading ? (
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <><CheckCircle className="w-4 h-4" /> Verify Code</>
                  )}
                </motion.button>

                <div className="flex items-center justify-between text-sm">
                  <button onClick={() => setStep('email')} className="flex items-center gap-1.5 text-slate-400 hover:text-white transition-colors">
                    <ArrowLeft className="w-4 h-4" />
                    Back
                  </button>
                  <button onClick={handleResend} disabled={resendCooldown > 0 || loading}
                    className="flex items-center gap-1.5 text-slate-400 hover:text-cyan-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                    <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                    {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend code'}
                  </button>
                </div>
              </motion.div>
            )}

            {step === 'password' && (
              <motion.div key="password" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <h1 className="text-2xl font-bold text-center text-white mb-1">Reset Password</h1>
                <p className="text-slate-400 text-sm text-center mb-6">Enter your new password.</p>

                <form onSubmit={handleResetPassword} className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-slate-300 block">New Password</label>
                    <div className="relative">
                      <Lock size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        type={showPassword ? 'text' : 'password'}
                        required
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        placeholder="••••••••"
                        className="w-full pl-10 pr-10 py-2.5 rounded-xl bg-black/40 border border-white/10 text-sm text-slate-100 focus:outline-none focus:border-cyan-500/60 focus:ring-1 focus:ring-cyan-500/60 transition-all"
                      />
                      <button type="button" onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white transition-colors">
                        {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                    {/* Password Strength Bar */}
                    {newPassword && (
                      <div className="mt-2 space-y-1.5">
                        <div className="flex items-center justify-between">
                          <div className="flex gap-1 flex-1 mr-3">
                            {[1, 2, 3, 4, 5].map((level) => (
                              <div
                                key={level}
                                className={`h-1.5 flex-1 rounded-full transition-all duration-300 ${
                                  strengthScore >= level ? strengthConfig.color : 'bg-slate-700'
                                }`}
                              />
                            ))}
                          </div>
                          <span className={`text-[10px] font-semibold ${strengthConfig.text}`}>
                            {strengthConfig.label}
                          </span>
                        </div>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                          {[
                            { label: '8+ characters', met: passwordCriteria.hasMinLength },
                            { label: 'Uppercase', met: passwordCriteria.hasUpper },
                            { label: 'Lowercase', met: passwordCriteria.hasLower },
                            { label: 'Number', met: passwordCriteria.hasNumber },
                            { label: 'Special char', met: passwordCriteria.hasSpecial }
                          ].map((criterion) => (
                            <div key={criterion.label} className="flex items-center gap-1.5">
                              <div className={`w-1.5 h-1.5 rounded-full ${criterion.met ? 'bg-emerald-500' : 'bg-slate-600'}`} />
                              <span className={`text-[10px] ${criterion.met ? 'text-emerald-400' : 'text-slate-500'}`}>
                                {criterion.label}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-slate-300 block">Confirm Password</label>
                    <div className="relative">
                      <Lock size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        type={showConfirm ? 'text' : 'password'}
                        required
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="••••••••"
                        className="w-full pl-10 pr-10 py-2.5 rounded-xl bg-black/40 border border-white/10 text-sm text-slate-100 focus:outline-none focus:border-cyan-500/60 focus:ring-1 focus:ring-cyan-500/60 transition-all"
                      />
                      <button type="button" onClick={() => setShowConfirm(!showConfirm)}
                        className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white transition-colors">
                        {showConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                  </div>

                  {errorMsg && (
                    <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3">
                      <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                      <span className="text-red-400 text-sm">{errorMsg}</span>
                    </div>
                  )}
                  {successMsg && (
                    <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/30 rounded-xl px-4 py-3">
                      <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
                      <span className="text-emerald-400 text-sm">{successMsg}</span>
                    </div>
                  )}

                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    type="submit"
                    disabled={loading}
                    className="w-full h-12 rounded-xl font-bold text-sm tracking-wide bg-gradient-to-r from-cyan-500 to-violet-600 hover:from-cyan-400 hover:to-violet-500 disabled:opacity-50 disabled:cursor-not-allowed text-white shadow-lg shadow-cyan-500/25 transition-all duration-200 flex items-center justify-center gap-2"
                  >
                    {loading ? (
                      <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    ) : (
                      <><CheckCircle className="w-4 h-4" /> Update Password</>
                    )}
                  </motion.button>
                </form>

                <button onClick={onBackToLogin} className="flex items-center gap-1.5 text-slate-400 hover:text-white transition-colors text-sm mt-4 mx-auto">
                  <ArrowLeft className="w-4 h-4" />
                  Back to Login
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  );
};
