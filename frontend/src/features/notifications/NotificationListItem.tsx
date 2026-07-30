import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, ChevronUp, Clock, Info, X } from 'lucide-react';
import { NotificationItem } from '../../types';
import { getNotificationTypeMeta, NOTIFICATION_ICON_CLASSES, PRIORITY_CLASSES } from './notificationTypes';

interface NotificationListItemProps {
  notification: NotificationItem;
  onOpen: (notification: NotificationItem) => void;
  onClear?: (id: string) => void;
  compact?: boolean;
  // Grouping (see notificationService.groupNotifications): when groupCount > 1, this row
  // represents a collapsed group rather than a single notification. Clicking it toggles
  // expansion instead of navigating — see NotificationsView for the expanded child rows.
  groupCount?: number;
  expanded?: boolean;
  onToggleExpand?: () => void;
  onMarkAllRead?: () => void;
  // "Remind me later" — only rendered when the parent decides this notification is eligible
  // (due-date reminders and approval requests — see NotificationsView's SNOOZABLE_TYPES).
  // Clicking the clock button opens a small preset menu (below); the chosen preset's computed
  // time is passed back here.
  onSnooze?: (notification: NotificationItem, until: Date) => void;
}

const SNOOZE_PRESETS: { label: string; getUntil: () => Date }[] = [
  { label: 'In 1 hour', getUntil: () => new Date(Date.now() + 60 * 60 * 1000) },
  { label: 'In 3 hours', getUntil: () => new Date(Date.now() + 3 * 60 * 60 * 1000) },
  {
    label: 'Tomorrow, 9:00 AM',
    getUntil: () => {
      const date = new Date();
      date.setDate(date.getDate() + 1);
      date.setHours(9, 0, 0, 0);
      return date;
    }
  },
  { label: 'Next week', getUntil: () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) }
];

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

const DETAIL_POPOVER_WIDTH = 320;
const DETAIL_POPOVER_ESTIMATED_HEIGHT = 190;

// Shared row markup for both the bell dropdown and the full Notification Center, so the two
// surfaces can never visually drift apart. Deliberately sibling <button>s (open / details /
// clear) rather than a clickable row nested inside another button, to keep the markup valid
// HTML — no button-inside-button.
export const NotificationListItem: React.FC<NotificationListItemProps> = ({
  notification,
  onOpen,
  onClear,
  compact = false,
  groupCount,
  expanded = false,
  onToggleExpand,
  onMarkAllRead,
  onSnooze
}) => {
  const meta = getNotificationTypeMeta(notification.type);
  const Icon = meta.icon;
  const isGroup = (groupCount ?? 1) > 1;

  const [showDetail, setShowDetail] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const rowRef = useRef<HTMLDivElement>(null);

  const [showSnoozeMenu, setShowSnoozeMenu] = useState(false);
  const [snoozeCoords, setSnoozeCoords] = useState<{ top: number; left: number } | null>(null);
  const snoozeButtonRef = useRef<HTMLButtonElement>(null);
  const snoozeMenuRef = useRef<HTMLDivElement>(null);

  const SNOOZE_MENU_WIDTH = 180;

  const openSnoozeMenu = () => {
    const rect = snoozeButtonRef.current?.getBoundingClientRect();
    if (!rect) return;
    setSnoozeCoords({
      top: rect.bottom + 6,
      left: Math.min(rect.left - SNOOZE_MENU_WIDTH + rect.width, window.innerWidth - SNOOZE_MENU_WIDTH - 12)
    });
    setShowSnoozeMenu(true);
  };

  // Closes the preset menu on any click outside it (unlike the hover-driven detail popover,
  // this one needs to stay open while the user reads the options and picks one).
  useEffect(() => {
    if (!showSnoozeMenu) return;
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (snoozeMenuRef.current?.contains(target) || snoozeButtonRef.current?.contains(target)) return;
      setShowSnoozeMenu(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showSnoozeMenu]);

  // Full title/message/actor/priority/timestamp in a portal-rendered popover — the row's own
  // text is truncated to one line for layout, so this is the only place the complete,
  // untruncated content is readable without navigating away. Portal + fixed positioning is
  // required (not plain `absolute`) so it isn't clipped by the bell dropdown's
  // `overflow-y-auto` container, the same issue solved for the board's assignee tooltip.
  const openDetail = () => {
    const rect = rowRef.current?.getBoundingClientRect();
    if (!rect) return;
    const showAbove = rect.bottom + DETAIL_POPOVER_ESTIMATED_HEIGHT > window.innerHeight;
    setCoords({
      top: showAbove ? rect.top - DETAIL_POPOVER_ESTIMATED_HEIGHT - 8 : rect.bottom + 8,
      left: Math.min(rect.left, window.innerWidth - DETAIL_POPOVER_WIDTH - 12)
    });
    setShowDetail(true);
  };
  const closeDetail = () => setShowDetail(false);

  return (
    <div
      ref={rowRef}
      onMouseEnter={openDetail}
      onMouseLeave={closeDetail}
      className={`group relative flex items-start gap-2 px-4 transition hover:bg-white/5 ${
        compact ? 'py-2.5' : 'py-3.5'
      } ${!notification.read ? 'bg-cyan-500/[0.04]' : ''}`}
    >
      <button
        type="button"
        onClick={() => (isGroup && onToggleExpand ? onToggleExpand() : onOpen(notification))}
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
            {isGroup && (
              <span className="shrink-0 rounded-full bg-white/10 px-1.5 py-0.5 text-[9px] font-bold text-slate-300">
                ×{groupCount}
              </span>
            )}
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

      <div className="flex shrink-0 items-center gap-0.5">
        {isGroup && onToggleExpand && (
          <button
            type="button"
            onClick={onToggleExpand}
            aria-label={expanded ? 'Collapse group' : 'Expand group'}
            className="rounded-lg p-1 text-slate-400 transition hover:bg-white/10 hover:text-cyan-300"
          >
            {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>
        )}
        {isGroup && onMarkAllRead && (
          <button
            type="button"
            onClick={onMarkAllRead}
            className="rounded-lg px-1.5 py-1 text-[10px] font-semibold text-slate-500 opacity-100 transition hover:bg-white/10 hover:text-cyan-300 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100"
          >
            Mark all read
          </button>
        )}
        {onSnooze && (
          <button
            ref={snoozeButtonRef}
            type="button"
            onClick={() => (showSnoozeMenu ? setShowSnoozeMenu(false) : openSnoozeMenu())}
            aria-label="Remind me later"
            title="Remind me later"
            className={`rounded-lg p-1 text-slate-500 transition hover:bg-white/10 hover:text-amber-300 ${
              showSnoozeMenu
                ? 'bg-white/10 text-amber-300'
                : 'opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100'
            }`}
          >
            <Clock size={13} />
          </button>
        )}
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            if (showDetail) closeDetail();
            else openDetail();
          }}
          aria-label="View full notification details"
          className="rounded-lg p-1 text-slate-500 opacity-100 transition hover:bg-white/10 hover:text-cyan-300 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100"
        >
          <Info size={13} />
        </button>
        {onClear && (
          <button
            type="button"
            onClick={() => onClear(notification.id)}
            aria-label="Clear notification"
            className="rounded-lg p-1 text-slate-500 opacity-100 transition hover:bg-white/10 hover:text-rose-300 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100"
          >
            <X size={13} />
          </button>
        )}
      </div>

      {showDetail &&
        coords &&
        createPortal(
          <div
            style={{ position: 'fixed', top: coords.top, left: coords.left, width: DETAIL_POPOVER_WIDTH }}
            className="glass-panel-glow pointer-events-none z-50 max-w-[90vw] p-3.5 text-xs text-slate-200 shadow-2xl"
          >
            <div className="mb-2 flex items-start gap-2">
              <span className={`mt-0.5 shrink-0 rounded-lg border p-1.5 ${NOTIFICATION_ICON_CLASSES[meta.tone]}`}>
                <Icon size={14} />
              </span>
              <span className="min-w-0 flex-1 font-bold text-white">{notification.title}</span>
            </div>
            <p className="whitespace-pre-wrap break-words leading-5 text-slate-300">{notification.message}</p>
            <div className="mt-2.5 space-y-1 border-t border-white/10 pt-2.5 text-[11px] text-slate-400">
              {notification.actorName && (
                <div>
                  From <span className="font-medium text-slate-200">{notification.actorName}</span>
                </div>
              )}
              <div className="flex items-center gap-2">
                <span>{meta.label}</span>
                {notification.priority && (
                  <span
                    className={`rounded-full border px-1.5 py-0.5 text-[9px] font-semibold ${PRIORITY_CLASSES[notification.priority]}`}
                  >
                    {notification.priority}
                  </span>
                )}
              </div>
              <div>
                {notification.createdAt ? new Date(notification.createdAt).toLocaleString() : notification.timestamp}
              </div>
            </div>
          </div>,
          document.body
        )}

      {showSnoozeMenu &&
        snoozeCoords &&
        onSnooze &&
        createPortal(
          <div
            ref={snoozeMenuRef}
            style={{ position: 'fixed', top: snoozeCoords.top, left: snoozeCoords.left, width: SNOOZE_MENU_WIDTH }}
            className="glass-panel-glow z-50 overflow-hidden p-1 text-xs shadow-2xl"
          >
            <div className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              Remind me later
            </div>
            {SNOOZE_PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                onClick={() => {
                  onSnooze(notification, preset.getUntil());
                  setShowSnoozeMenu(false);
                }}
                className="block w-full rounded-lg px-2 py-1.5 text-left text-slate-200 transition hover:bg-white/10 hover:text-amber-300"
              >
                {preset.label}
              </button>
            ))}
          </div>,
          document.body
        )}
    </div>
  );
};
