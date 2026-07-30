import React, { useState } from 'react';
import { AlertCircle, CheckCircle2, Eye, EyeOff, Lock, ShieldCheck } from 'lucide-react';
import { supabase } from '../../../utils/supabase';
import { User } from '../../types';
import { getPasswordChecks, isStrongPassword, PASSWORD_POLICY_MESSAGE } from '../members/accountFormRules';

interface FirstLoginPasswordViewProps {
  accessToken: string;
  onComplete: (user: User) => void;
}

export const FirstLoginPasswordView: React.FC<FirstLoginPasswordViewProps> = ({ accessToken, onComplete }) => {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const checks = getPasswordChecks(password);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (!isStrongPassword(password)) {
      setError(PASSWORD_POLICY_MESSAGE);
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const changed = await fetch('/api/accounts/first-login/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ password, confirmPassword })
      });
      const changedData = await changed.json().catch(() => ({}));
      if (!changed.ok || !changedData.success) throw new Error(changedData.message || 'Could not change the password.');

      const refreshed = await supabase?.auth.refreshSession();
      const token = refreshed?.data.session?.access_token || accessToken;
      localStorage.setItem('worksync_auth_token', token);
      const response = await fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success || !data.user) throw new Error(data.message || 'Could not activate the account.');
      onComplete(data.user as User);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not complete account activation.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen w-screen bg-[var(--bg-canvas)] p-4 text-slate-100 flex items-center justify-center">
      <form onSubmit={submit} className="glass-panel-glow w-full max-w-lg border border-cyan-500/25 p-6 md:p-8">
        <div className="flex items-center gap-3">
          <div className="rounded-xl border border-cyan-500/30 bg-cyan-500/10 p-3 text-cyan-300"><ShieldCheck size={22} /></div>
          <div>
            <h1 className="text-xl font-bold text-white">Secure your account</h1>
            <p className="mt-1 text-xs text-slate-400">Replace the temporary password before entering WorkSync.</p>
          </div>
        </div>

        {error && <div role="alert" className="mt-5 flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-200"><AlertCircle size={15} />{error}</div>}

        <div className="mt-6 space-y-4">
          <label className="block text-xs font-semibold text-slate-300">New password <span className="text-rose-400">*</span>
            <div className="relative">
              <Lock size={15} className="absolute left-3 top-1/2 mt-0.5 -translate-y-1/2 text-slate-500" />
              <input required autoComplete="new-password" type={showPassword ? 'text' : 'password'} value={password} onChange={(event) => { setPassword(event.target.value); setError(''); }} className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 py-2.5 pl-9 pr-10 text-sm outline-none focus:border-cyan-500/50" />
              <button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'Hide password' : 'Show password'} className="absolute right-3 top-1/2 mt-0.5 -translate-y-1/2 text-slate-400 hover:text-white">{showPassword ? <EyeOff size={15} /> : <Eye size={15} />}</button>
            </div>
          </label>
          <label className="block text-xs font-semibold text-slate-300">Confirm password <span className="text-rose-400">*</span>
            <div className="relative">
              <Lock size={15} className="absolute left-3 top-1/2 mt-0.5 -translate-y-1/2 text-slate-500" />
              <input required autoComplete="new-password" type={showConfirmation ? 'text' : 'password'} value={confirmPassword} onChange={(event) => { setConfirmPassword(event.target.value); setError(''); }} className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 py-2.5 pl-9 pr-10 text-sm outline-none focus:border-cyan-500/50" />
              <button type="button" onClick={() => setShowConfirmation((value) => !value)} aria-label={showConfirmation ? 'Hide confirmation' : 'Show confirmation'} className="absolute right-3 top-1/2 mt-0.5 -translate-y-1/2 text-slate-400 hover:text-white">{showConfirmation ? <EyeOff size={15} /> : <Eye size={15} />}</button>
            </div>
          </label>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 rounded-xl border border-white/10 bg-black/20 p-3 text-[11px] sm:grid-cols-5">
          {Object.entries(checks).map(([key, passed]) => <span key={key} className={`inline-flex items-center gap-1 ${passed ? 'text-emerald-300' : 'text-slate-500'}`}><CheckCircle2 size={11} />{key === 'length' ? '8-128 chars' : key}</span>)}
        </div>
        <button disabled={busy} className="mt-6 w-full rounded-xl bg-cyan-500 px-4 py-3 text-sm font-bold text-slate-950 transition hover:bg-cyan-400 disabled:opacity-50">{busy ? 'Securing account...' : 'Change password and continue'}</button>
      </form>
    </div>
  );
};
