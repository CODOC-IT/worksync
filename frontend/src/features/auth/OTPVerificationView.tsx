import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Mail, RefreshCw, CheckCircle, AlertCircle, ArrowLeft, Shield } from 'lucide-react';
import { UserRole } from '../../types';

interface OTPVerificationViewProps {
  email: string;
  name: string;
  registrationData: {
    password: string;
    role: UserRole;
    department: string;
    title?: string;
  };
  onVerifySuccess: (token: string, user: any) => void;
  onBack: () => void;
}

export const OTPVerificationView: React.FC<OTPVerificationViewProps> = ({
  email,
  name,
  registrationData,
  onVerifySuccess,
  onBack
}) => {
  const [otp, setOtp] = useState<string[]>(['', '', '', '', '', '']);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [resendCooldown, setResendCooldown] = useState(60);
  const [resending, setResending] = useState(false);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Countdown timer for resend
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setInterval(() => {
      setResendCooldown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [resendCooldown]);

  const handleOtpChange = (index: number, value: string) => {
    if (!/^\d*$/.test(value)) return; // digits only
    const newOtp = [...otp];
    newOtp[index] = value.slice(-1); // single digit
    setOtp(newOtp);
    setErrorMsg(null);
    if (value && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !otp[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
    if (e.key === 'Enter') handleVerify();
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (pasted.length === 6) {
      setOtp(pasted.split(''));
      inputRefs.current[5]?.focus();
    }
    e.preventDefault();
  };

  const handleVerify = async () => {
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
        body: JSON.stringify({
          email,
          otp: otpCode,
          name,
          password: registrationData.password,
          role: registrationData.role,
          department: registrationData.department,
          title: registrationData.title
        })
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || 'Verification failed.');
      setSuccessMsg('Email verified! Creating your account...');
      setTimeout(() => {
        if (data.token) localStorage.setItem('worksync_auth_token', data.token);
        onVerifySuccess(data.token, data.user);
      }, 1200);
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
    setResending(true);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/otp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, name, role: registrationData.role })
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message);
      setResendCooldown(60);
      setOtp(['', '', '', '', '', '']);
      inputRefs.current[0]?.focus();
      setSuccessMsg('A new code has been sent to your email.');
      setTimeout(() => setSuccessMsg(null), 4000);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to resend OTP.');
    } finally {
      setResending(false);
    }
  };

  return (
    <div
      className="min-h-screen w-screen flex items-center justify-center bg-[var(--bg-canvas)] text-slate-100 relative overflow-hidden"
      style={{
        backgroundImage: `linear-gradient(to bottom, rgba(9,10,15,0.92), rgba(9,10,15,0.97)), url('/assets/images/auth-bg.png')`,
        backgroundSize: 'cover',
        backgroundPosition: 'center'
      }}
    >
      {/* Ambient blobs */}
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
        {/* Card */}
        <div className="bg-slate-900/80 backdrop-blur-2xl border border-cyan-500/20 rounded-2xl p-5 sm:p-8 shadow-2xl shadow-cyan-500/5">
          {/* Icon */}
          <div className="flex justify-center mb-6">
            <motion.div
              animate={{ rotate: [0, 5, -5, 0] }}
              transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
              className="w-16 h-16 rounded-2xl bg-gradient-to-br from-cyan-500/20 to-violet-600/20 border border-cyan-500/30 flex items-center justify-center"
            >
              <Shield className="w-8 h-8 text-cyan-400" />
            </motion.div>
          </div>

          <h1 className="text-2xl font-bold text-center text-white mb-1">Verify Your Email</h1>
          <p className="text-slate-400 text-sm text-center mb-2">
            We sent a 6-digit code to
          </p>
          <div className="flex items-center justify-center gap-2 mb-6">
            <Mail className="w-4 h-4 text-cyan-400" />
            <span className="text-cyan-400 font-medium text-sm">{email}</span>
          </div>

          {/* OTP Boxes */}
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
                onKeyDown={(e) => handleKeyDown(i, e)}
                whileFocus={{ scale: 1.08 }}
                autoFocus={i === 0}
                className={`w-10 h-12 sm:w-12 sm:h-14 text-lg sm:text-xl font-bold text-center rounded-xl border-2 bg-slate-800/60 text-white outline-none transition-all duration-200
                  ${digit ? 'border-cyan-400 shadow-[0_0_12px_rgba(0,212,255,0.3)]' : 'border-slate-700'}
                  ${errorMsg ? 'border-red-500/60' : ''}
                  focus:border-cyan-400 focus:shadow-[0_0_12px_rgba(0,212,255,0.3)]`}
              />
            ))}
          </div>

          {/* Error / Success */}
          <AnimatePresence mode="wait">
            {errorMsg && (
              <motion.div
                key="error"
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 mb-4"
              >
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                <span className="text-red-400 text-sm">{errorMsg}</span>
              </motion.div>
            )}
            {successMsg && (
              <motion.div
                key="success"
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/30 rounded-xl px-4 py-3 mb-4"
              >
                <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
                <span className="text-emerald-400 text-sm">{successMsg}</span>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Verify Button */}
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={handleVerify}
            disabled={loading || otp.join('').length !== 6}
            className="w-full h-12 rounded-xl font-bold text-sm tracking-wide
              bg-gradient-to-r from-cyan-500 to-violet-600
              hover:from-cyan-400 hover:to-violet-500
              disabled:opacity-50 disabled:cursor-not-allowed
              text-white shadow-lg shadow-cyan-500/25 transition-all duration-200
              flex items-center justify-center gap-2 mb-4"
          >
            {loading ? (
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full"
              />
            ) : (
              <>
                <CheckCircle className="w-4 h-4" />
                Verify & Create Account
              </>
            )}
          </motion.button>

          {/* Resend + Back */}
          <div className="flex items-center justify-between text-sm">
            <button
              onClick={onBack}
              className="flex items-center gap-1.5 text-slate-400 hover:text-white transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              Back
            </button>
            <button
              onClick={handleResend}
              disabled={resendCooldown > 0 || resending}
              className="flex items-center gap-1.5 text-slate-400 hover:text-cyan-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <RefreshCw className={`w-4 h-4 ${resending ? 'animate-spin' : ''}`} />
              {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend code'}
            </button>
          </div>

          {/* Expiry note */}
          <p className="text-xs text-slate-600 text-center mt-4">
            Code expires in 1 minute · Single use only
          </p>
        </div>
      </motion.div>
    </div>
  );
};
