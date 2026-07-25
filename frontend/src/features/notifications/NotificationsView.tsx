import React, { useMemo, useState } from 'react';
import {
  Bell,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Filter,
  Search,
  Settings2,
  SlidersHorizontal
} from 'lucide-react';
import { useApp } from '../../store/AppContext';
import { NotificationItem, NotificationPreferences, NotificationPriority, NotificationType } from '../../types';
import {
  filterNotifications,
  getNotificationsByUser,
  NotificationFilters,
  paginateNotifications
} from './notificationService';
import { getNotificationTypeMeta, PRIORITY_CLASSES } from './notificationTypes';
import { NotificationListItem } from './NotificationListItem';

const inputClass =
  'w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-400/10';

const PAGE_SIZE = 20;

const PREFERENCE_LABELS: { key: keyof NotificationPreferences; label: string; description: string }[] = [
  { key: 'inApp', label: 'In-App Notifications', description: 'Show events in the Notification Center' },
  { key: 'toast', label: 'Toast Pop-ups', description: 'Bottom-right toast when a notification arrives' },
  { key: 'assignments', label: 'Assignments', description: 'Task assigned, reassigned, or removed' },
  { key: 'mentions', label: 'Mentions', description: '@mentions in project chat' },
  { key: 'comments', label: 'Comments', description: 'New comments and replies' },
  { key: 'dueReminders', label: 'Due Reminders', description: 'Due today, due tomorrow, and overdue alerts' },
  { key: 'email', label: 'Email Digest', description: 'Not yet connected — reserved for future backend delivery' }
];

export const NotificationsView: React.FC = () => {
  const {
    currentUser,
    currentRole,
    notifications,
    notificationPreferences,
    markNotificationRead,
    markAllNotificationsRead,
    clearNotification,
    updateNotificationPreferences
  } = useApp();

  const [search, setSearch] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [typeFilter, setTypeFilter] = useState<NotificationType | 'All'>('All');
  const [priorityFilter, setPriorityFilter] = useState<NotificationPriority | 'All'>('All');
  const [dateRange, setDateRange] = useState<NotificationFilters['dateRange']>('All');
  const [page, setPage] = useState(1);
  const [showPreferences, setShowPreferences] = useState(false);

  const myNotifications = useMemo(
    () => getNotificationsByUser(notifications, currentUser.id, currentRole),
    [notifications, currentUser.id, currentRole]
  );

  const filtered = useMemo(
    () =>
      filterNotifications(myNotifications, {
        search,
        unreadOnly,
        type: typeFilter,
        priority: priorityFilter,
        dateRange
      }),
    [myNotifications, search, unreadOnly, typeFilter, priorityFilter, dateRange]
  );

  const { items: pageItems, totalPages } = paginateNotifications(filtered, page, PAGE_SIZE);
  const unreadCount = myNotifications.filter((notification) => !notification.read).length;

  const presentTypes = useMemo(
    () => Array.from(new Set(myNotifications.map((notification) => notification.type))),
    [myNotifications]
  );

  const resetFilters = () => {
    setSearch('');
    setUnreadOnly(false);
    setTypeFilter('All');
    setPriorityFilter('All');
    setDateRange('All');
    setPage(1);
  };

  const handleOpen = (notification: NotificationItem) => {
    markNotificationRead(notification.id);
  };

  const hasActiveFilters = Boolean(search || unreadOnly || typeFilter !== 'All' || priorityFilter !== 'All' || dateRange !== 'All');

  return (
    <section className="mx-auto max-w-[1100px] space-y-5">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-cyan-400">
            <Bell size={15} />
            Notification center
          </div>
          <h1 className="text-2xl font-bold text-white">Notifications</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-400">
            {unreadCount > 0
              ? `You have ${unreadCount} unread notification${unreadCount !== 1 ? 's' : ''}.`
              : "You're all caught up."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowPreferences((value) => !value)}
            className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold transition ${
              showPreferences
                ? 'border-cyan-400/50 bg-cyan-500/15 text-cyan-300'
                : 'border-white/10 text-slate-300 hover:bg-white/5'
            }`}
          >
            <Settings2 size={14} />
            Preferences
          </button>
          {unreadCount > 0 && (
            <button
              type="button"
              onClick={markAllNotificationsRead}
              className="glass-button-neon inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-bold"
            >
              <Check size={14} />
              Mark all read
            </button>
          )}
        </div>
      </header>

      {showPreferences && (
        <div className="glass-panel-glow space-y-3 p-5">
          <h2 className="flex items-center gap-2 text-sm font-bold text-white">
            <SlidersHorizontal size={15} className="text-cyan-400" />
            Notification Preferences
          </h2>
          <p className="text-xs text-slate-400">
            Choose which events generate an in-app notification or toast for your account. Preferences are
            stored per session in this prototype (see docs/Notification_Module_Guide.md for backend plans).
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {PREFERENCE_LABELS.map(({ key, label, description }) => (
              <label
                key={key}
                className="flex items-start gap-3 rounded-xl border border-white/10 bg-slate-950/40 p-3 text-xs"
              >
                <input
                  type="checkbox"
                  checked={notificationPreferences[key]}
                  onChange={(event) => updateNotificationPreferences({ [key]: event.target.checked })}
                  disabled={key === 'email'}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-cyan-500 disabled:opacity-40"
                />
                <span>
                  <span className="block font-semibold text-slate-200">{label}</span>
                  <span className="mt-0.5 block text-[11px] text-slate-500">{description}</span>
                </span>
              </label>
            ))}
          </div>
        </div>
      )}

      <div className="glass-panel space-y-3 p-4">
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-5">
          <label className="relative md:col-span-2">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              className={`${inputClass} pl-9`}
              placeholder="Search by title or description..."
            />
          </label>

          <label className="relative">
            <select
              value={typeFilter}
              onChange={(event) => {
                setTypeFilter(event.target.value as NotificationType | 'All');
                setPage(1);
              }}
              className={`${inputClass} appearance-none pr-8 text-xs`}
            >
              <option value="All">All types</option>
              {presentTypes.map((type) => (
                <option key={type} value={type}>
                  {getNotificationTypeMeta(type).label}
                </option>
              ))}
            </select>
            <ChevronDown size={13} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-500" />
          </label>

          <label className="relative">
            <select
              value={priorityFilter}
              onChange={(event) => {
                setPriorityFilter(event.target.value as NotificationPriority | 'All');
                setPage(1);
              }}
              className={`${inputClass} appearance-none pr-8 text-xs`}
            >
              <option value="All">All priorities</option>
              <option value="Critical">Critical</option>
              <option value="High">High</option>
              <option value="Medium">Medium</option>
              <option value="Low">Low</option>
            </select>
            <ChevronDown size={13} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-500" />
          </label>

          <label className="relative">
            <select
              value={dateRange}
              onChange={(event) => {
                setDateRange(event.target.value as NotificationFilters['dateRange']);
                setPage(1);
              }}
              className={`${inputClass} appearance-none pr-8 text-xs`}
            >
              <option value="All">Any time</option>
              <option value="Today">Today</option>
              <option value="ThisWeek">This week</option>
            </select>
            <ChevronDown size={13} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-500" />
          </label>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => {
              setUnreadOnly((value) => !value);
              setPage(1);
            }}
            className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
              unreadOnly
                ? 'border-cyan-400/50 bg-cyan-500/15 text-cyan-300'
                : 'border-white/10 text-slate-300 hover:bg-white/5'
            }`}
          >
            <Filter size={13} />
            Unread only
          </button>
          {hasActiveFilters && (
            <button
              type="button"
              onClick={resetFilters}
              className="text-[11px] font-semibold text-cyan-400 hover:text-cyan-300"
            >
              Clear filters
            </button>
          )}
        </div>
      </div>

      <div className="glass-panel overflow-hidden">
        {pageItems.length === 0 ? (
          <div className="flex min-h-52 flex-col items-center justify-center px-6 text-center">
            <Bell className="text-slate-500" size={26} />
            <h3 className="mt-3 font-semibold text-slate-200">No notifications</h3>
            <p className="mt-1 text-xs text-slate-500">
              {hasActiveFilters ? 'Try changing or clearing the current filters.' : "You're all caught up."}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-white/5">
            {pageItems.map((notification) => (
              <div key={notification.id} className="flex items-center">
                <div className="min-w-0 flex-1">
                  <NotificationListItem
                    notification={notification}
                    onOpen={handleOpen}
                    onClear={clearNotification}
                  />
                </div>
                {notification.priority && (
                  <span
                    className={`mr-4 hidden shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold sm:inline-block ${PRIORITY_CLASSES[notification.priority]}`}
                  >
                    {notification.priority}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-white/10 px-4 py-3">
            <span className="text-[11px] text-slate-500">
              Page {page} of {totalPages} &middot; {filtered.length} notification{filtered.length !== 1 ? 's' : ''}
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setPage((value) => Math.max(1, value - 1))}
                disabled={page <= 1}
                className="rounded-lg border border-white/10 p-1.5 text-slate-300 transition hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-30"
                aria-label="Previous page"
              >
                <ChevronLeft size={14} />
              </button>
              <button
                type="button"
                onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
                disabled={page >= totalPages}
                className="rounded-lg border border-white/10 p-1.5 text-slate-300 transition hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-30"
                aria-label="Next page"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
};
