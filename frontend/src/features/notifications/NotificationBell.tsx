import React, { useEffect, useRef, useState } from 'react';
import { Bell } from 'lucide-react';
import { useApp } from '../../store/AppContext';
import { NotificationItem } from '../../types';
import { getNotificationsByUser, groupNotifications } from './notificationService';
import { NotificationListItem } from './NotificationListItem';

interface NotificationBellProps {
  onSelectTab: (tab: string) => void;
}

const DROPDOWN_PREVIEW_COUNT = 8;

// FR-03/FR-07: bell + unread badge + dropdown preview, with a "View all" footer that opens
// the full Notification Center (NotificationsView). Business logic (recipient scoping, RBAC)
// stays in NotificationService — this component only renders and calls AppContext actions.
export const NotificationBell: React.FC<NotificationBellProps> = ({ onSelectTab }) => {
  const { currentUser, currentRole, notifications, markNotificationRead, markAllNotificationsRead } = useApp();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const myNotifications = getNotificationsByUser(notifications, currentUser.id, currentRole);
  const unreadCount = myNotifications.filter((notification) => !notification.read).length;
  // Grouped for display only (same-type/same-target collapsed into one row with a ×N badge) —
  // this compact preview has no room for the full expand/collapse UI the Notification Center
  // gets, so clicking a grouped row here just opens its newest item, same as any other row.
  const preview = groupNotifications(myNotifications.slice(0, DROPDOWN_PREVIEW_COUNT));

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  const handleOpenNotification = (notification: NotificationItem) => {
    markNotificationRead(notification.id);
    setOpen(false);
    onSelectTab(notification.linkRoute);
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="relative p-2 rounded-xl bg-slate-900/50 border border-white/10 text-slate-300 hover:text-white hover:border-cyan-500/40 transition-all"
        title="Notifications"
        aria-label={`Notifications${unreadCount > 0 ? `, ${unreadCount} unread` : ''}`}
      >
        <Bell size={17} className="text-slate-300" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center animate-pulse shadow-[0_0_10px_rgba(244,63,94,0.8)]">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-96 max-w-[90vw] glass-panel border border-cyan-500/30 shadow-2xl z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
            <span className="text-sm font-bold text-white">Notifications</span>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={markAllNotificationsRead}
                className="text-[11px] font-semibold text-cyan-400 hover:text-cyan-300"
              >
                Mark all read
              </button>
            )}
          </div>

          <div className="max-h-96 divide-y divide-white/5 overflow-y-auto">
            {preview.length === 0 ? (
              <div className="px-4 py-8 text-center text-xs text-slate-500">You're all caught up.</div>
            ) : (
              preview.map((group) => (
                <NotificationListItem
                  key={group.key}
                  notification={group.items[0]}
                  groupCount={group.items.length}
                  onOpen={handleOpenNotification}
                  compact
                />
              ))
            )}
          </div>

          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onSelectTab('notifications');
            }}
            className="w-full border-t border-white/10 py-2.5 text-center text-xs font-semibold text-cyan-400 transition hover:bg-white/5"
          >
            View all notifications
          </button>
        </div>
      )}
    </div>
  );
};
