import React, { useEffect } from 'react';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { useApp } from '../../store/AppContext';
import { ToastItem, ToastTone } from '../../types';
import { TOAST_TONE_CLASSES } from './notificationTypes';

const TOAST_ICONS: Record<ToastTone, React.ComponentType<{ size?: number; className?: string }>> = {
  success: CheckCircle2,
  info: Info,
  warning: AlertTriangle,
  error: XCircle
};

const TOAST_AUTO_DISMISS_MS = 4500;

const Toast: React.FC<{ toast: ToastItem; onDismiss: (id: string) => void }> = ({ toast, onDismiss }) => {
  // Each toast owns its own timer (mount-only effect) so a new toast arriving doesn't reset
  // the countdown on toasts already on screen.
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(toast.id), TOAST_AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast.id]);

  const Icon = TOAST_ICONS[toast.tone];

  return (
    <div
      role="status"
      title={`${toast.title}: ${toast.message}`}
      className={`glass-panel-glow pointer-events-auto flex w-80 max-w-[90vw] items-start gap-3 border p-3.5 shadow-2xl animate-in fade-in slide-in-from-right-4 duration-200 ${TOAST_TONE_CLASSES[toast.tone]}`}
    >
      <Icon size={18} className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-bold text-white">{toast.title}</p>
        <p className="mt-0.5 line-clamp-2 text-[11px] text-slate-300">{toast.message}</p>
      </div>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label="Dismiss notification"
        className="shrink-0 text-slate-400 transition hover:text-white"
      >
        <X size={14} />
      </button>
    </div>
  );
};

// FR-05: bottom-right, fade + slide, 3-5s auto-dismiss, priority/tone color-coded. Mounted
// once at the app shell level (App.tsx) — see docs/Notification_Module_Guide.md.
export const ToastContainer: React.FC = () => {
  const { toasts, dismissToast } = useApp();

  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex flex-col gap-2">
      {toasts.map((toast) => (
        <Toast key={toast.id} toast={toast} onDismiss={dismissToast} />
      ))}
    </div>
  );
};
