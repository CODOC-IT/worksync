import React, { useEffect, useState } from 'react';
import { BarChart3, RefreshCw, Search, User as UserIcon, X } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  NotificationAnalyticsRow,
  UserNotificationAnalyticsRow,
  UserNotificationCategoryBreakdown
} from '../../types';
import {
  fetchNotificationAnalytics,
  fetchUserNotificationAnalytics,
  fetchUserNotificationAnalyticsDetail
} from './notificationApiClient';

const PAGE_SIZE = 10;

const readRateColor = (rate: number): string => {
  if (rate >= 70) return 'text-emerald-300';
  if (rate >= 40) return 'text-amber-300';
  return 'text-rose-300';
};

// Groups a user's per-type breakdown into one read/unread bar per category, for the drill-down
// chart -- the type-level detail is still shown as a plain list below the chart for anyone who
// wants the exact type names, but the chart itself reads better one bar per category.
const aggregateByCategory = (rows: UserNotificationCategoryBreakdown[]) => {
  const byCategory = new Map<string, { category: string; read: number; unread: number }>();
  rows.forEach((row) => {
    const entry = byCategory.get(row.category) || { category: row.category, read: 0, unread: 0 };
    entry.read += row.read;
    entry.unread += row.total - row.read;
    byCategory.set(row.category, entry);
  });
  return Array.from(byCategory.values()).sort((a, b) => b.read + b.unread - (a.read + a.unread));
};

// Admin-only delivery analytics. Two panels:
//  1. Org-wide, per-TYPE breakdown (unchanged from before) — read rates/suppressed counts across
//     every notification type this organization has sent.
//  2. Per-USER breakdown (new) — searchable/sortable/paginated list of who's actually seeing and
//     reading notifications, with a per-user drill-down showing which category they read the most
//     of (their "interest").
// Calls the API client directly rather than going through AppContext: unlike every other
// notification action, this is pure reporting with no local-state counterpart and no "local
// fallback" story (if the API is unreachable, there is nothing meaningful to show instead of
// just an error/empty state).
export const NotificationAnalyticsPanel: React.FC = () => {
  const [rows, setRows] = useState<NotificationAnalyticsRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = () => {
    setLoading(true);
    setError(null);
    fetchNotificationAnalytics()
      .then((data) => setRows(data))
      .catch((err) => setError(err.message || 'Failed to load analytics.'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totalDelivered = rows?.reduce((sum, row) => sum + row.delivered, 0) ?? 0;
  const totalRead = rows?.reduce((sum, row) => sum + row.read, 0) ?? 0;
  const overallReadRate = totalDelivered > 0 ? Math.round((totalRead / totalDelivered) * 1000) / 10 : 0;

  // --- Per-user analytics state ---
  const [userRows, setUserRows] = useState<UserNotificationAnalyticsRow[] | null>(null);
  const [userTotal, setUserTotal] = useState(0);
  const [userError, setUserError] = useState<string | null>(null);
  const [userLoading, setUserLoading] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'total' | 'readRate' | 'name'>('total');
  const [page, setPage] = useState(1);

  const [selectedUser, setSelectedUser] = useState<UserNotificationAnalyticsRow | null>(null);
  const [detailRows, setDetailRows] = useState<UserNotificationCategoryBreakdown[] | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Debounced so typing a name doesn't fire a server round-trip on every keystroke.
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const loadUsers = () => {
    setUserLoading(true);
    setUserError(null);
    fetchUserNotificationAnalytics({ search: search || undefined, page, pageSize: PAGE_SIZE, sortBy })
      .then(({ items, total }) => {
        setUserRows(items);
        setUserTotal(total);
      })
      .catch((err) => setUserError(err.message || 'Failed to load per-user analytics.'))
      .finally(() => setUserLoading(false));
  };

  useEffect(() => {
    loadUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, sortBy, page]);

  const openUser = (user: UserNotificationAnalyticsRow) => {
    setSelectedUser(user);
    setDetailRows(null);
    setDetailError(null);
    setDetailLoading(true);
    fetchUserNotificationAnalyticsDetail(user.userId)
      .then(setDetailRows)
      .catch((err) => setDetailError(err.message || 'Failed to load this user’s breakdown.'))
      .finally(() => setDetailLoading(false));
  };

  const totalPages = Math.max(1, Math.ceil(userTotal / PAGE_SIZE));

  return (
    <div className="space-y-4">
      <div className="glass-panel-glow space-y-3 p-5">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-bold text-white">
            <BarChart3 size={15} className="text-cyan-400" />
            Notification Delivery Analytics
          </h2>
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1.5 text-[11px] font-semibold text-slate-300 transition hover:bg-white/5 disabled:opacity-50"
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
        <p className="text-xs text-slate-400">
          Read rates and suppressed counts across every notification type this organization has sent. Requires a
          live database connection (see docs/Notification_Module_Guide.md Section 10).
        </p>

        {error && (
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-300">{error}</div>
        )}

        {!error && rows && rows.length === 0 && (
          <div className="py-8 text-center text-xs text-slate-500">No notifications have been sent yet.</div>
        )}

        {!error && rows && rows.length > 0 && (
          <>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              <div className="rounded-xl border border-white/10 bg-slate-950/40 p-3 text-center">
                <div className="text-lg font-bold text-white">{rows.reduce((sum, row) => sum + row.total, 0)}</div>
                <div className="text-[10px] uppercase tracking-wide text-slate-500">Total sent</div>
              </div>
              <div className="rounded-xl border border-white/10 bg-slate-950/40 p-3 text-center">
                <div className="text-lg font-bold text-white">{totalDelivered}</div>
                <div className="text-[10px] uppercase tracking-wide text-slate-500">Delivered</div>
              </div>
              <div className="rounded-xl border border-white/10 bg-slate-950/40 p-3 text-center">
                <div className="text-lg font-bold text-white">
                  {rows.reduce((sum, row) => sum + row.suppressed, 0)}
                </div>
                <div className="text-[10px] uppercase tracking-wide text-slate-500">Suppressed</div>
              </div>
              <div className="rounded-xl border border-white/10 bg-slate-950/40 p-3 text-center">
                <div className="text-lg font-bold text-cyan-300">{overallReadRate}%</div>
                <div className="text-[10px] uppercase tracking-wide text-slate-500">Read rate</div>
              </div>
            </div>

            <div className="overflow-x-auto rounded-xl border border-white/10">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950/60 text-[10px] uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2 font-semibold">Type</th>
                    <th className="px-3 py-2 font-semibold">Category</th>
                    <th className="px-3 py-2 text-right font-semibold">Total</th>
                    <th className="px-3 py-2 text-right font-semibold">Delivered</th>
                    <th className="px-3 py-2 text-right font-semibold">Suppressed</th>
                    <th className="px-3 py-2 text-right font-semibold">Read</th>
                    <th className="px-3 py-2 text-right font-semibold">Read Rate</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {rows.map((row) => (
                    <tr key={row.type}>
                      <td className="px-3 py-2 font-medium text-slate-200">{row.type}</td>
                      <td className="px-3 py-2 text-slate-400">{row.category}</td>
                      <td className="px-3 py-2 text-right text-slate-300">{row.total}</td>
                      <td className="px-3 py-2 text-right text-slate-300">{row.delivered}</td>
                      <td className="px-3 py-2 text-right text-amber-300">{row.suppressed}</td>
                      <td className="px-3 py-2 text-right text-slate-300">{row.read}</td>
                      <td className="px-3 py-2 text-right font-semibold text-cyan-300">{row.readRate}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      <div className="glass-panel-glow space-y-3 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-bold text-white">
            <UserIcon size={15} className="text-cyan-400" />
            Per-User Notification Analytics
          </h2>
          <button
            type="button"
            onClick={loadUsers}
            disabled={userLoading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1.5 text-[11px] font-semibold text-slate-300 transition hover:bg-white/5 disabled:opacity-50"
          >
            <RefreshCw size={12} className={userLoading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
        <p className="text-xs text-slate-400">
          Who's actually seeing and reading notifications. Search for a specific person, sort by read rate to
          find who's disengaged, or open a row to see which category they read the most of.
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1">
            <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Search by name or email…"
              className="w-full rounded-lg border border-white/10 bg-slate-950/40 py-1.5 pl-8 pr-2.5 text-xs text-slate-200 placeholder:text-slate-500 focus:border-cyan-400/50 focus:outline-none"
            />
          </div>
          <select
            value={sortBy}
            onChange={(event) => {
              setSortBy(event.target.value as typeof sortBy);
              setPage(1);
            }}
            className="rounded-lg border border-white/10 bg-slate-950/40 px-2.5 py-1.5 text-xs text-slate-300 focus:border-cyan-400/50 focus:outline-none"
          >
            <option value="total">Sort: Most notified</option>
            <option value="readRate">Sort: Lowest read rate</option>
            <option value="name">Sort: Name (A-Z)</option>
          </select>
        </div>

        {userError && (
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-300">
            {userError}
          </div>
        )}

        {!userError && userRows && userRows.length === 0 && (
          <div className="py-8 text-center text-xs text-slate-500">
            {search ? `No users match "${search}".` : 'No notifications have been sent to any user yet.'}
          </div>
        )}

        {!userError && userRows && userRows.length > 0 && (
          <>
            <div className="overflow-x-auto rounded-xl border border-white/10">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950/60 text-[10px] uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2 font-semibold">User</th>
                    <th className="px-3 py-2 text-right font-semibold">Received</th>
                    <th className="px-3 py-2 text-right font-semibold">Read</th>
                    <th className="px-3 py-2 text-right font-semibold">Read Rate</th>
                    <th className="px-3 py-2 font-semibold">Top Interest</th>
                    <th className="px-3 py-2 font-semibold">Last Read</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {userRows.map((user) => (
                    <tr
                      key={user.userId}
                      onClick={() => openUser(user)}
                      className="cursor-pointer transition hover:bg-white/5"
                    >
                      <td className="px-3 py-2">
                        <div className="font-medium text-slate-200">{user.name}</div>
                        <div className="text-[10px] text-slate-500">{user.email}</div>
                      </td>
                      <td className="px-3 py-2 text-right text-slate-300">{user.totalReceived}</td>
                      <td className="px-3 py-2 text-right text-slate-300">{user.totalRead}</td>
                      <td className={`px-3 py-2 text-right font-semibold ${readRateColor(user.readRate)}`}>
                        {user.readRate}%
                      </td>
                      <td className="px-3 py-2 text-slate-400">{user.topInterest || '—'}</td>
                      <td className="px-3 py-2 text-slate-500">
                        {user.lastReadAt ? new Date(user.lastReadAt).toLocaleDateString() : 'Never'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between text-[11px] text-slate-500">
              <span>
                {userTotal} user{userTotal === 1 ? '' : 's'} total
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="rounded-lg border border-white/10 px-2 py-1 font-semibold text-slate-300 transition hover:bg-white/5 disabled:opacity-30"
                >
                  Prev
                </button>
                <span>
                  Page {page} / {totalPages}
                </span>
                <button
                  type="button"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  className="rounded-lg border border-white/10 px-2 py-1 font-semibold text-slate-300 transition hover:bg-white/5 disabled:opacity-30"
                >
                  Next
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {selectedUser && (
        <div
          className="fixed inset-0 z-50 flex items-stretch justify-end bg-black/50"
          onClick={() => setSelectedUser(null)}
        >
          <div
            className="glass-panel-glow h-full w-full max-w-md space-y-4 overflow-y-auto p-5"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-white">{selectedUser.name}</h3>
                <p className="text-[11px] text-slate-500">{selectedUser.email}</p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedUser(null)}
                className="rounded-lg border border-white/10 p-1.5 text-slate-400 transition hover:bg-white/5"
              >
                <X size={14} />
              </button>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-xl border border-white/10 bg-slate-950/40 p-3 text-center">
                <div className="text-base font-bold text-white">{selectedUser.totalReceived}</div>
                <div className="text-[10px] uppercase tracking-wide text-slate-500">Received</div>
              </div>
              <div className="rounded-xl border border-white/10 bg-slate-950/40 p-3 text-center">
                <div className="text-base font-bold text-white">{selectedUser.totalRead}</div>
                <div className="text-[10px] uppercase tracking-wide text-slate-500">Read</div>
              </div>
              <div className="rounded-xl border border-white/10 bg-slate-950/40 p-3 text-center">
                <div className={`text-base font-bold ${readRateColor(selectedUser.readRate)}`}>
                  {selectedUser.readRate}%
                </div>
                <div className="text-[10px] uppercase tracking-wide text-slate-500">Read rate</div>
              </div>
            </div>

            <div>
              <h4 className="mb-2 text-xs font-semibold text-slate-300">Interest by category</h4>

              {detailLoading && <div className="py-6 text-center text-xs text-slate-500">Loading…</div>}
              {detailError && (
                <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-300">
                  {detailError}
                </div>
              )}
              {!detailLoading && !detailError && detailRows && detailRows.length === 0 && (
                <div className="py-6 text-center text-xs text-slate-500">
                  This user hasn't received any notifications yet.
                </div>
              )}
              {!detailLoading && !detailError && detailRows && detailRows.length > 0 && (
                <>
                  <div className="h-56 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={aggregateByCategory(detailRows)}
                        layout="vertical"
                        margin={{ top: 4, right: 16, bottom: 4, left: 8 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" horizontal={false} />
                        <XAxis type="number" allowDecimals={false} tick={{ fontSize: 10, fill: '#94a3b8' }} />
                        <YAxis
                          type="category"
                          dataKey="category"
                          width={88}
                          tick={{ fontSize: 10, fill: '#cbd5e1' }}
                        />
                        <Tooltip
                          contentStyle={{
                            background: '#0f172a',
                            border: '1px solid rgba(255,255,255,0.1)',
                            borderRadius: 8,
                            fontSize: 11
                          }}
                          labelStyle={{ color: '#e2e8f0' }}
                        />
                        <Bar dataKey="read" name="Read" stackId="a" fill="#22d3ee" radius={[0, 0, 0, 0]} />
                        <Bar dataKey="unread" name="Unread" stackId="a" fill="#334155" radius={[0, 4, 4, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>

                  <div className="mt-3 space-y-1.5">
                    {detailRows.map((row) => (
                      <div
                        key={row.type}
                        className="flex items-center justify-between rounded-lg border border-white/5 bg-slate-950/30 px-2.5 py-1.5 text-[11px]"
                      >
                        <span className="text-slate-300">{row.type}</span>
                        <span className="text-slate-500">
                          {row.read}/{row.total} ·{' '}
                          <span className={readRateColor(row.readRate)}>{row.readRate}%</span>
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
