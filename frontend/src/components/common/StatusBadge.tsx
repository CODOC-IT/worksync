import React from 'react';
import {
  CheckCircle2,
  Clock,
  AlertTriangle,
  XCircle,
  HelpCircle,
  PlayCircle,
  ShieldAlert,
  FileCheck
} from 'lucide-react';

interface StatusBadgeProps {
  status: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({
  status,
  size = 'md',
  className = ''
}) => {
  const normalized = status.toLowerCase();

  let colorClasses = 'bg-slate-500/15 text-slate-300 border-slate-500/30';
  let Icon = HelpCircle;

  if (['active', 'approved', 'present', 'done', 'completed'].includes(normalized)) {
    colorClasses = 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30 shadow-[0_0_10px_rgba(0,255,136,0.15)]';
    Icon = CheckCircle2;
  } else if (['in progress', 'review', 'pending', 'pending approval', 'late'].includes(normalized)) {
    colorClasses = 'bg-amber-500/15 text-amber-400 border-amber-500/30 shadow-[0_0_10px_rgba(255,170,0,0.15)]';
    Icon = Clock;
  } else if (['todo'].includes(normalized)) {
    colorClasses = 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30 shadow-[0_0_10px_rgba(0,242,254,0.15)]';
    Icon = PlayCircle;
  } else if (['blocked', 'rejected', 'failed'].includes(normalized)) {
    colorClasses = 'bg-rose-500/15 text-rose-400 border-rose-500/30 shadow-[0_0_10px_rgba(244,63,94,0.15)]';
    Icon = ShieldAlert;
  } else if (['urgent', 'high'].includes(normalized)) {
    colorClasses = 'bg-fuchsia-500/15 text-fuchsia-400 border-fuchsia-500/30 shadow-[0_0_10px_rgba(217,70,239,0.15)]';
    Icon = AlertTriangle;
  } else if (['short hours'].includes(normalized)) {
    colorClasses = 'bg-orange-500/15 text-orange-400 border-orange-500/30 shadow-[0_0_10px_rgba(249,115,22,0.15)]';
    Icon = Clock;
  } else if (['archived'].includes(normalized)) {
    colorClasses = 'bg-slate-600/20 text-slate-400 border-slate-600/30';
    Icon = FileCheck;
  }

  const sizeClasses = {
    sm: 'px-2 py-0.5 text-xs gap-1',
    md: 'px-2.5 py-1 text-xs gap-1.5',
    lg: 'px-3 py-1.5 text-sm gap-2'
  };

  const iconSizes = {
    sm: 12,
    md: 14,
    lg: 16
  };

  return (
    <span
      data-status={normalized}
      className={`inline-flex items-center font-medium rounded-full border backdrop-blur-sm whitespace-nowrap ${sizeClasses[size]} ${colorClasses} ${className}`}
    >
      <Icon size={iconSizes[size]} className="shrink-0" />
      <span>{status}</span>
    </span>
  );
};
