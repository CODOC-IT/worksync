import React from 'react';
import { X } from 'lucide-react';
import { NotificationItem } from '../../types';
import { getNotificationTypeMeta, NOTIFICATION_ICON_CLASSES } from './notificationTypes';

interface NotificationListItemProps {
  notification: NotificationItem;
  onOpen: (notification: NotificationItem) => void;
  onClear?: (id: string) => void;
  compact?: boolean;
}

const formatRelativeTime = (createdAt?: string, fallback?: string): string => {
  if (!createdAt) return fallback || '';
  const diffMinutes = Math.floor((Date.now() - new Date(createdAt).getTime()) / 60000);
  if (diffMinutes < 1) return 'Just now';
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return fallback || new Date(createdAt).toLocaleDateString();
};

// Shared row markup for both the bell dropdown and the full Notification Center, so the two
// surfaces can never visually drift apart. Deliberately two sibling <button>s (open / clear)
// rather than a clickable row nested inside another button, to keep the markup valid HTML.
export const NotificationListItem: React.FC<NotificationListItemProps> = ({
  notification,
  onOpen,
  onClear,
  compact = false
}) => {
  const meta = getNotificationTypeMeta(notification.type);
  const Icon = meta.icon;

  return (
    <div
      className={`group flex items-start gap-2 px-4 transition hover:bg-white/5 ${compact ? 'py-2.5' : 'py-3.5'} ${
        !notification.read ? 'bg-cyan-500/[0.04]' : ''
      }`}
    >
      <button
        type="button"
        onClick={() => onOpen(notification)}
        className="flex min-w-0 flex-1 items-start gap-3 text-left"
      >
        <span className={`mt-0.5 shrink-0 rounded-lg border p-1.5 ${NOTIFICATION_ICON_CLASSES[meta.tone]}`}>
          <Icon size={14} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span
              className={`truncate text-xs ${
                !notification.read ? 'font-bold text-white' : 'font-medium text-slate-300'
              }`}
            >
              {notification.title}
            </span>
            {!notification.read && (
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-400 shadow-[0_0_6px_rgba(0,242,254,0.8)]" />
            )}
          </span>
          <span className="mt-0.5 block truncate text-[11px] text-slate-400">{notification.message}</span>
          <span className="mt-1 block text-[10px] text-slate-500">
            {formatRelativeTime(notification.createdAt, notification.timestamp)}
          </span>
        </span>
      </button>
      {onClear && (
        <button
          type="button"
          onClick={() => onClear(notification.id)}
          aria-label="Clear notification"
          className="shrink-0 rounded-lg p-1 text-slate-500 opacity-0 transition hover:bg-white/10 hover:text-rose-300 group-hover:opacity-100"
        >
          <X size={13} />
        </button>
      )}
    </div>
  );
};
