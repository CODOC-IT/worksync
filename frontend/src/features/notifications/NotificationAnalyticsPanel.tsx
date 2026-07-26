import React, { useEffect, useState } from 'react';
import { BarChart3, RefreshCw } from 'lucide-react';
import { NotificationAnalyticsRow } from '../../types';
import { fetchNotificationAnalytics } from './notificationApiClient';

// Admin-only delivery analytics — read rates / suppressed counts per notification type, backed
// by real DeliveryStatus/ReadAtUtc data (backend/src/notifications/notification.repository.ts's
// getDeliveryAnalytics). Calls the API client directly rather than going through AppContext:
// unlike every other notification action, this is pure reporting with no local-state
// counterpart and no "local fallback" story (if the API is unreachable, there is nothing
// meaningful to show instead of just an error/empty state).
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

  return (
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
  );
};
