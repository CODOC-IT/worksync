import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Activity, AlertCircle, ArrowDownUp, CheckCircle2, ChevronLeft,
  ChevronRight, Download, ExternalLink, Filter, RefreshCw, Search,
  ShieldAlert, SlidersHorizontal, UserRound, X, XCircle,
  Building, Eye, Lock,
} from 'lucide-react';
import { useApp } from '../../store/AppContext';
import {
  downloadActivityCsv,
  downloadActivityPdf,
  fetchActivities,
  fetchActivity,
  fetchViewerScope,
} from './activityApi';
import {
  ActivityFilters,
  ActivityItem,
  DEFAULT_ACTIVITY_FILTERS,
  ViewerScope,
} from './activityTypes';

// ─── Per-role module whitelists ─────────────────────────────────────────────
// 'Settings' and 'HR' removed from module filter: Settings is internal admin-only
// and HR is attendance-scoped; neither is a useful filter option for end users.
const MEMBER_MODULES = ['Projects', 'Tasks', 'Kanban', 'Project Chats', 'Attendance', 'Approvals', 'Calendar', 'AI Assistant', 'Profile', 'Notifications'];
const LEAD_MODULES   = [...MEMBER_MODULES, 'Permissions'];
const ADMIN_MODULES  = ['Projects', 'Tasks', 'Kanban', 'Project Chats', 'Attendance', 'Approvals', 'Calendar', 'AI Assistant', 'Profile', 'Notifications', 'Permissions', 'Authentication', 'Activity Log', 'System'];

// Action lists. 'Rejected' is an actioncode (not a status field-change), so it lives here.
const MEMBER_ACTIONS = ['Created', 'Updated', 'Deleted', 'Assigned', 'Assigned/Reassigned', 'Status Changed', 'Priority Changed', 'Approved', 'Rejected', 'Commented', 'Mentioned', 'Uploaded Attachment', 'Deleted Attachment', 'Checked In', 'Checked Out', 'Preference Changed'];
const LEAD_ACTIONS   = [...MEMBER_ACTIONS, 'Permission Granted', 'Permission Revoked', 'Permission Expired'];
// Admin sees all actions including HR attendance and auth events
const ADMIN_ACTIONS  = ['Created', 'Updated', 'Deleted', 'Archived', 'Assigned', 'Assigned/Reassigned', 'Status Changed', 'Priority Changed', 'Approved', 'Rejected', 'Commented', 'Mentioned', 'Uploaded Attachment', 'Deleted Attachment', 'Attachment Deleted', 'Checked In', 'Checked Out', 'Break Started', 'Break Ended', 'Attendance Corrected', 'Leave Requested', 'Leave Approved', 'Leave Rejected', 'Permission Granted', 'Permission Revoked', 'Permission Expired', 'Login', 'Logout', 'Exported', 'Preference Changed'];

const DATE_PRESETS: ActivityFilters['datePreset'][] = ['Today', 'Yesterday', 'Last 7 Days', 'Last 30 Days', 'Custom'];
const RESULT_OPTIONS = ['Successful', 'Failed', 'Blocked'];

// ─── Scope banner descriptions ───────────────────────────────────────────────
const getScopeDescription = (
  scope: ViewerScope | null,
  activeTab: 'my-work' | 'hr' | 'lead',
): string => {
  if (!scope) return '';
  const { permanentRole, isActiveTeamLead, isActiveHR } = scope;
  if (permanentRole === 'Admin') return 'Showing organization-wide activity.';
  if (permanentRole === 'HR' || isActiveHR) {
    if (activeTab === 'lead') return 'Showing activity for projects you lead.';
    return 'Showing organization-wide activity (excluding Administrator actions).';
  }
  if (permanentRole === 'Team_Lead' || isActiveTeamLead) {
    return 'Showing your activity and activity for projects you lead.';
  }
  return 'Showing your activity.';
};

// ─── Tab types ───────────────────────────────────────────────────────────────
type ActivityTab = 'my-work' | 'hr' | 'lead';

interface Props { onNavigate?: (tab: string, id?: string) => void }

export const ActivityLogView: React.FC<Props> = ({ onNavigate }) => {
  const { users, projects, tasks, currentRole, currentUser } = useApp();

  // ── Authoritative scope from the backend ────────────────────────────────
  const [scope, setScope] = useState<ViewerScope | null>(null);
  const [scopeLoading, setScopeLoading] = useState(true);
  const [scopeError, setScopeError] = useState('');

  const isAdmin = currentRole === 'Admin';
  // In this system a user's permanent DB role is Team_Member even when they lead a project.
  // The backend grants isActiveTeamLead via project-membership rows (memberrolecode='TeamLead').
  // We fall back to currentRole === 'Team_Lead' for legacy compatibility.
  const isTeamLead = !!(scope?.isActiveTeamLead) || currentRole === 'Team_Lead';
  const isHR = currentRole === 'HR';

  // ── Active tab state ─────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<ActivityTab>('my-work');

  // ── Filter / pagination state ────────────────────────────────────────────
  const [filters, setFilters] = useState<ActivityFilters>({ ...DEFAULT_ACTIVITY_FILTERS });
  const [searchInput, setSearchInput] = useState('');
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [selected, setSelected] = useState<ActivityItem | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [detailRefreshKey, setDetailRefreshKey] = useState(0);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [exporting, setExporting] = useState<'csv' | 'pdf' | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const roleRef = useRef(currentRole);

  // ── Visible project/task lists (scoped to authorized access) ────────────
  const userProjectIds = useMemo(() => {
    if (isAdmin) return projects.map((p) => p.id);
    if (isTeamLead) {
      const led = projects.filter((p) => p.teamLeadId === currentUser.id).map((p) => p.id);
      const member = projects.filter((p) => p.memberIds?.includes(currentUser.id)).map((p) => p.id);
      return [...new Set([...led, ...member])];
    }
    return projects.filter((p) => p.memberIds?.includes(currentUser.id)).map((p) => p.id);
  }, [projects, currentRole, currentUser.id, isAdmin, isTeamLead]);

  const accessibleProjects = useMemo(
    () => projects.filter((p) => userProjectIds.includes(p.id)),
    [projects, userProjectIds],
  );

  const ledProjects = useMemo(
    () => projects.filter((p) => p.teamLeadId === currentUser.id),
    [projects, currentUser.id],
  );

  const accessibleUsers = useMemo(() => {
    if (isAdmin || isHR) return users;
    if (isTeamLead) {
      const ids = new Set(ledProjects.flatMap((p) => [...(p.memberIds || []), p.teamLeadId].filter(Boolean)));
      return users.filter((u) => ids.has(u.id) || u.id === currentUser.id);
    }
    return users.filter((u) => u.id === currentUser.id);
  }, [users, currentRole, currentUser.id, isAdmin, isHR, isTeamLead, ledProjects]);

  const accessibleTasks = useMemo(() => {
    if (isAdmin) return tasks;
    return tasks.filter((t) => userProjectIds.includes(t.projectId));
  }, [tasks, userProjectIds, isAdmin]);

  // ── Fetch authoritative scope from the backend on mount / role change ────
  useEffect(() => {
    const controller = new AbortController();
    setScopeLoading(true);
    setScopeError('');
    fetchViewerScope(controller.signal)
      .then((s) => {
        if (!controller.signal.aborted) {
          setScope(s);
          setScopeLoading(false);
        }
      })
      .catch((err) => {
        if (controller.signal.aborted || err?.name === 'AbortError') return;
        setScopeError(err instanceof Error ? err.message : 'Could not verify your activity permissions.');
        setScopeLoading(false);
      });
    return () => controller.abort();
  }, [currentRole]);

  // ── Reset everything when role changes ───────────────────────────────────
  useEffect(() => {
    if (roleRef.current !== currentRole) {
      roleRef.current = currentRole;
      setScope(null);
      setItems([]);
      setSelected(null);
      setDetailError('');
      setSearchInput('');
      setPage(1);
      setTotal(0);
      setTotalPages(1);
      setFilters({ ...DEFAULT_ACTIVITY_FILTERS });
      setActiveTab('my-work');
    }
  }, [currentRole]);

  // ── Derive display info from authoritative scope ─────────────────────────
  // Declared early so activeFiltersForRole can reference them.
  const showHRTab    = !!(scope?.isActiveHR);
  const showLeadTab  = !!(scope?.isActiveTeamLead);
  const canExport    = !!(scope?.canExport);
  const scopeIsAdmin = scope?.permanentRole === 'Admin';
  const scopeDescription = getScopeDescription(scope, activeTab);

  // ── Build request filters based on active tab ────────────────────────────
  const activeFiltersForRole = useMemo((): ActivityFilters => {
    const f = { ...filters };

    // Led Project Activity tab: backend visibility covers it via RBAC, send no extra flags
    if (showLeadTab && activeTab === 'lead') {
      return { ...f, myActivityOnly: false, hrActivityOnly: false };
    }
    // Admin or HR: org-wide (backend enforces the Admin-actor exclusion for HR)
    if (scope?.permanentRole === 'Admin' || scope?.isActiveHR) {
      return { ...f, myActivityOnly: false, hrActivityOnly: false };
    }
    // My Work Activity (default): restrict to the viewer's own events
    return { ...f, myActivityOnly: true, hrActivityOnly: false };
  }, [filters, scope, showLeadTab, activeTab]);

  // ── Debounced search ─────────────────────────────────────────────────────
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setFilters((current) => current.search === searchInput ? current : { ...current, search: searchInput });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  // ── Load activity ────────────────────────────────────────────────────────
  const load = useCallback(async (signal?: AbortSignal) => {
    if (scopeLoading) return;
    setLoading(true);
    setError('');
    try {
      const result = await fetchActivities(activeFiltersForRole, page, 20, signal);
      if (signal?.aborted) return;
      setItems(result.items);
      setTotal(result.total);
      setTotalPages(result.totalPages);
    } catch (reason) {
      if (signal?.aborted || (reason instanceof Error && reason.name === 'AbortError')) return;
      setError(reason instanceof Error ? reason.message : 'Could not load activity.');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [activeFiltersForRole, page, refreshKey, scopeLoading]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  useEffect(() => { setPage(1); }, [activeFiltersForRole]);

  // ── Detail drawer fetch ──────────────────────────────────────────────────
  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController();
    setDetailLoading(true);
    setDetailError('');
    fetchActivity(selected.id, controller.signal)
      .then((item) => { if (!controller.signal.aborted) setSelected(item); })
      .catch((reason) => {
        if (controller.signal.aborted || reason?.name === 'AbortError') return;
        setDetailError(reason instanceof Error ? reason.message : 'Could not load activity details.');
      })
      .finally(() => { if (!controller.signal.aborted) setDetailLoading(false); });
    return () => controller.abort();
  }, [selected?.id, detailRefreshKey]);

  useEffect(() => {
    if (!selected) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setSelected(null); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selected]);

  // ── Chip helpers ─────────────────────────────────────────────────────────
  const activeChips = useMemo(() => {
    const chips: Array<{ key: keyof ActivityFilters; label: string }> = [];
    const customRange = [filters.customFrom, filters.customTo].filter(Boolean).join(' → ');
    // Only show date chip when it differs from the default — avoids persistent noise.
    if (filters.datePreset !== 'Last 30 Days') {
      chips.push({
        key: 'datePreset',
        label: filters.datePreset === 'Custom' && customRange ? `Custom: ${customRange}` : filters.datePreset,
      });
    }
    const labels: Array<[keyof ActivityFilters, string]> = [
      ['search',    filters.search    ? `"${filters.search}"` : ''],
      ['userId',    users.find((u) => u.id === filters.userId)?.name || ''],
      ['userRole',  filters.userRole  ? `Role: ${filters.userRole.replace('_', ' ')}` : ''],
      ['projectId', accessibleProjects.find((p) => p.id === filters.projectId)?.title || ''],
      ['taskId',    accessibleTasks.find((t) => t.id === filters.taskId)?.title || ''],
      ['module',    filters.module    ? `Module: ${filters.module}` : ''],
      ['action',    filters.action    ? `Action: ${filters.action}` : ''],
      ['result',    filters.result    ? `Outcome: ${filters.result}` : ''],
    ];
    labels.forEach(([key, label]) => { if (label) chips.push({ key, label }); });
    if (filters.myActivityOnly) chips.push({ key: 'myActivityOnly', label: 'My activity only' });
    if (filters.importantOnly)  chips.push({ key: 'importantOnly',  label: 'Important only' });
    return chips;
  }, [filters, users, accessibleProjects, accessibleTasks]);

  const clearChip = (key: keyof ActivityFilters) => {
    if (key === 'search') setSearchInput('');
    setFilters((prev) => {
      if (key === 'datePreset') return { ...prev, datePreset: 'Last 30 Days', customFrom: '', customTo: '' };
      return { ...prev, [key]: typeof prev[key] === 'boolean' ? false : '' };
    });
  };

  const clearAllFilters = () => { setSearchInput(''); setFilters({ ...DEFAULT_ACTIVITY_FILTERS }); setPage(1); };

  const changeTab = (tab: ActivityTab) => {
    setActiveTab(tab);
    setFilters((f) => ({ ...f, module: '', action: '', status: '', myActivityOnly: false, hrActivityOnly: false }));
    setPage(1);
  };

  const handleExport = async (format: 'csv' | 'pdf') => {
    setExporting(format);
    setError('');
    try {
      if (format === 'csv') await downloadActivityCsv(activeFiltersForRole);
      else await downloadActivityPdf(activeFiltersForRole);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : `${format.toUpperCase()} export failed.`);
    } finally {
      setExporting(null);
    }
  };

  // ── Loading: never show admin/HR/lead controls until scope is confirmed ──
  if (scopeLoading) {
    return (
      <section data-activity-log className="flex h-[calc(100vh-7rem)] min-h-[560px] flex-col items-center justify-center gap-3">
        <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-cyan-500 via-purple-600 to-pink-500 p-0.5">
          <div className="w-full h-full bg-slate-950 rounded-[14px] flex items-center justify-center">
            <Activity size={22} className="text-cyan-400 animate-pulse" />
          </div>
        </div>
        <p className="text-sm text-slate-400">Verifying your activity permissions...</p>
      </section>
    );
  }

  if (scopeError) {
    return (
      <section data-activity-log className="flex h-[calc(100vh-7rem)] min-h-[560px] flex-col items-center justify-center gap-4 p-8">
        <Lock size={28} className="text-rose-400" />
        <h2 className="text-base font-bold text-white">Activity permissions unavailable</h2>
        <p className="text-xs text-slate-400 max-w-sm text-center">{scopeError}</p>
        <button
          onClick={() => { setScopeLoading(true); setScopeError(''); }}
          className="px-4 py-2 rounded-xl glass-button-neon text-xs font-bold"
        >
          Retry
        </button>
      </section>
    );
  }

  // ── Compute available modules/actions for the current role + tab ─────────
  const availableModules = (scope?.permanentRole === 'Admin' || scope?.isActiveHR) ? ADMIN_MODULES
    : (scope?.isActiveTeamLead) ? LEAD_MODULES
    : MEMBER_MODULES;

  const availableActions = (scope?.permanentRole === 'Admin' || scope?.isActiveHR) ? ADMIN_ACTIONS
    : (scope?.isActiveTeamLead) ? LEAD_ACTIONS
    : MEMBER_ACTIONS;

  return (
    <section data-activity-log className="flex h-[calc(100vh-7rem)] min-h-[560px] flex-col gap-3 overflow-hidden">
      {/* ── Header ── */}
      <header className="flex shrink-0 flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Activity className="text-cyan-400" size={22} />
            <h1 className="text-xl font-bold text-white">Activity Log</h1>
          </div>
          {scopeDescription && (
            <p className="mt-1 text-xs text-slate-400">{scopeDescription}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setFiltersOpen((open) => !open)}
            className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-slate-200 lg:hidden"
          >
            <SlidersHorizontal size={15} /> Filters
          </button>
          <button
            onClick={() => setRefreshKey((k) => k + 1)}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-slate-200"
          >
            <RefreshCw className={loading ? 'animate-spin' : ''} size={15} /> Refresh
          </button>
          {canExport && (
            <>
              <button
                onClick={() => handleExport('csv')}
                disabled={exporting !== null}
                className="glass-button-neon inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-bold disabled:opacity-50"
              >
                <Download size={15} /> {exporting === 'csv' ? 'Exporting...' : 'CSV'}
              </button>
              <button
                onClick={() => handleExport('pdf')}
                disabled={exporting !== null}
                className="glass-button inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-slate-200 disabled:opacity-50"
              >
                <Download size={15} /> {exporting === 'pdf' ? 'Exporting...' : 'PDF'}
              </button>
            </>
          )}
        </div>
      </header>

      {/* ── Role-based tabs (only shown when user is also a Team Lead, not for plain HR) ── */}
      {showLeadTab && !scopeIsAdmin && (
        <div className="flex gap-1 rounded-xl border border-white/10 bg-white/5 p-1 shrink-0">
          <button
            onClick={() => changeTab('my-work')}
            className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${activeTab === 'my-work' ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30' : 'text-slate-400 hover:text-slate-200'}`}
          >
            <UserRound size={14} /> My Work Activity
          </button>
          {showLeadTab && (
            <button
              onClick={() => changeTab('lead')}
              className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${activeTab === 'lead' ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30' : 'text-slate-400 hover:text-slate-200'}`}
            >
              <Eye size={14} /> Led Project Activity
            </button>
          )}
        </div>
      )}

      {/* ── Scope banner ── */}
      {(isTeamLead || showLeadTab) && activeTab !== 'hr' && ledProjects.length > 0 && (
        <div className="flex items-center gap-2 rounded-xl border border-cyan-500/20 bg-cyan-500/5 px-4 py-2 shrink-0">
          <Eye size={14} className="text-cyan-400 shrink-0" />
          <p className="text-xs text-cyan-200">
            {activeTab === 'lead'
              ? `Showing activity for ${ledProjects.length} project${ledProjects.length > 1 ? 's' : ''} you lead.`
              : `Includes events from ${ledProjects.length} project${ledProjects.length > 1 ? 's' : ''} you lead.`}
          </p>
        </div>
      )}

      {/* ── Main layout: filter panel + feed ── */}
      <div className="relative flex min-h-0 flex-1 gap-3">
        <FilterPanel
          open={filtersOpen}
          filters={filters}
          setFilters={setFilters}
          users={accessibleUsers}
          projects={accessibleProjects}
          tasks={accessibleTasks}
          ledProjects={ledProjects}
          availableModules={availableModules}
          availableActions={availableActions}
          activeTab={activeTab}
          isAdmin={scopeIsAdmin || !!(scope?.isActiveHR)}
          showLeadTab={showLeadTab}
          onClose={() => setFiltersOpen(false)}
          onClear={clearAllFilters}
        />

        <div className="glass-panel flex min-w-0 flex-1 flex-col overflow-hidden border border-white/10">
          {/* Search + sort bar */}
          <div className="shrink-0 border-b border-white/10 p-3">
            <div className="flex items-center gap-2">
              <div className="relative min-w-0 flex-1">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder="Search actor, project, task, description, ID, field or text..."
                  className="w-full rounded-xl border border-white/10 bg-slate-950/50 py-2.5 pl-9 pr-3 text-xs text-slate-200 outline-none focus:border-cyan-500/40"
                />
              </div>
              <button
                onClick={() => setFilters((f) => ({ ...f, sort: f.sort === 'newest' ? 'oldest' : 'newest' }))}
                className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-white/10 px-3 py-2.5 text-xs text-slate-300"
              >
                <ArrowDownUp size={14} />
                <span className="hidden sm:inline">{filters.sort === 'newest' ? 'Newest' : 'Oldest'}</span>
              </button>
            </div>
            {activeChips.length > 0 && (
              <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1">
                {activeChips.map((chip) => (
                  <button
                    key={`${chip.key}-${chip.label}`}
                    onClick={() => clearChip(chip.key)}
                    className="inline-flex shrink-0 items-center gap-1 rounded-full border border-cyan-500/20 bg-cyan-500/10 px-2 py-1 text-[10px] text-cyan-200"
                  >
                    {chip.label}<X size={10} />
                  </button>
                ))}
                <button onClick={clearAllFilters} className="shrink-0 px-2 text-[10px] font-semibold text-rose-300">
                  Clear all
                </button>
              </div>
            )}
          </div>

          {/* Feed */}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {loading ? (
              <FeedState icon={<RefreshCw className="animate-spin" />} title="Loading activity" message="Fetching the latest scoped audit events..." />
            ) : error ? (
              <FeedState icon={<AlertCircle />} title="Activity unavailable" message={error} action={() => setRefreshKey((k) => k + 1)} />
            ) : items.length === 0 ? (
              <FeedState icon={<Filter />} title="No matching activity" message={activeChips.length === 0 ? 'No activity recorded in this scope yet.' : 'Try widening the date range or clearing some filters.'} />
            ) : (
              <div className="divide-y divide-white/5">
                {items.map((item) => (
                  <ActivityRow key={item.id} item={item} onClick={() => { setDetailError(''); setSelected(item); }} />
                ))}
              </div>
            )}
          </div>

          {/* Pagination */}
          <footer className="flex shrink-0 items-center justify-between border-t border-white/10 px-3 py-2 text-[11px] text-slate-400">
            <span>{total === 0 ? 'No events' : `${(page - 1) * 20 + 1}–${Math.min(page * 20, total)} of ${total}`}</span>
            <div className="flex items-center gap-2">
              <button aria-label="Previous page" disabled={page <= 1} onClick={() => setPage((v) => v - 1)} className="rounded-lg border border-white/10 p-1.5 disabled:opacity-30">
                <ChevronLeft size={14} />
              </button>
              <span>Page {page} / {totalPages}</span>
              <button aria-label="Next page" disabled={page >= totalPages} onClick={() => setPage((v) => v + 1)} className="rounded-lg border border-white/10 p-1.5 disabled:opacity-30">
                <ChevronRight size={14} />
              </button>
            </div>
          </footer>
        </div>
      </div>

      <AnimatePresence>
        {selected && (
          <ActivityDetail
            item={selected}
            loading={detailLoading}
            error={detailError}
            onRetry={() => setDetailRefreshKey((k) => k + 1)}
            onClose={() => setSelected(null)}
            onNavigate={onNavigate}
          />
        )}
      </AnimatePresence>
    </section>
  );
};

// ─── Filter Panel ─────────────────────────────────────────────────────────────
// Simplified to the filters that actually matter. Removed: entity type, source,
// changed-field, has-attachments, has-mentions, failed/blocked toggle, status
// (status was broken — it matched field-change records, not the action code),
// priority. 'Rejected'/'Approved' are action codes — use Action type filter.
interface FilterPanelProps {
  open: boolean;
  filters: ActivityFilters;
  setFilters: React.Dispatch<React.SetStateAction<ActivityFilters>>;
  users: Array<{ id: string; name: string; role?: string }>;
  projects: Array<{ id: string; title: string }>;
  tasks: Array<{ id: string; title: string; projectId: string }>;
  ledProjects: Array<{ id: string; title: string }>;
  availableModules: string[];
  availableActions: string[];
  activeTab: ActivityTab;
  isAdmin: boolean;
  showLeadTab: boolean;
  onClose: () => void;
  onClear: () => void;
}

const FilterPanel: React.FC<FilterPanelProps> = ({
  open, filters, setFilters, users, projects, tasks, ledProjects,
  availableModules, availableActions, activeTab, isAdmin,
  showLeadTab, onClose, onClear,
}) => {
  const update = (key: keyof ActivityFilters, value: string | boolean) =>
    setFilters((current) => ({ ...current, [key]: value }));

  const isLeadTab = activeTab === 'lead';

  // Filter users by selected role for clean cascading UX
  const filteredUsers = useMemo(() => {
    if (!filters.userRole) return users;
    return users.filter((u) => u.role === filters.userRole);
  }, [users, filters.userRole]);

  return (
    <aside
      className={`${open ? 'absolute inset-0 z-30 flex' : 'hidden'} glass-panel-glow w-full shrink-0 flex-col overflow-hidden border border-white/10 lg:static lg:flex lg:w-64`}
    >
      <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-4 py-3">
        <span className="flex items-center gap-2 text-sm font-bold text-white">
          <Filter size={15} className="text-cyan-400" /> Filters
        </span>
        <button onClick={onClose} className="lg:hidden"><X size={17} /></button>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">

        {/* 1. Date range — always present */}
        <FilterSelect
          label="Date range"
          value={filters.datePreset}
          onChange={(v) => update('datePreset', v || 'Last 30 Days')}
          options={DATE_PRESETS}
          includeNoneOption={false}
        />
        {filters.datePreset === 'Custom' && (
          <div className="grid grid-cols-2 gap-2">
            <FilterInput type="date" label="From" value={filters.customFrom} onChange={(v) => update('customFrom', v)} />
            <FilterInput type="date" label="To"   value={filters.customTo}   onChange={(v) => update('customTo', v)} />
          </div>
        )}

        {/* 2. Cascading User Role -> User selection */}
        {isAdmin ? (
          <>
            <FilterSelect
              label="User role"
              value={filters.userRole}
              onChange={(v) => {
                setFilters((curr) => {
                  const nextUser = v && curr.userId && users.find((u) => u.id === curr.userId)?.role !== v ? '' : curr.userId;
                  return { ...curr, userRole: v, userId: nextUser };
                });
              }}
              options={['Admin', 'HR', 'Team_Member']}
            />
            <FilterSelect
              label="User"
              value={filters.userId}
              onChange={(v) => update('userId', v)}
              options={filteredUsers.map((u) => ({ value: u.id, label: u.name }))}
            />
          </>
        ) : isLeadTab ? (
          <FilterSelect
            label="Project member"
            value={filters.userId}
            onChange={(v) => update('userId', v)}
            options={users.map((u) => ({ value: u.id, label: u.name }))}
          />
        ) : null}

        {/* 3. Project — cascading parent for Task filter below */}
        <FilterSelect
          label={isLeadTab ? 'Led project' : 'Project'}
          value={filters.projectId}
          onChange={(v) => { update('projectId', v); update('taskId', ''); }}
          options={
            isLeadTab
              ? ledProjects.map((p) => ({ value: p.id, label: p.title }))
              : projects.map((p) => ({
                  value: p.id,
                  label: ledProjects.some((lp) => lp.id === p.id) ? `${p.title} ★` : p.title,
                }))
          }
        />

        {/* 4. Task — only shown once a project is selected (cascading) */}
        {filters.projectId && (
          <FilterSelect
            label="Task"
            value={filters.taskId}
            onChange={(v) => update('taskId', v)}
            options={tasks
              .filter((t) => t.projectId === filters.projectId)
              .map((t) => ({ value: t.id, label: t.title }))}
          />
        )}

        {/* 5. Action type — most important filter. 'Rejected', 'Approved', 'Archived'
            are actioncodes stored in audit.auditevents.actioncode. Selecting
            'Rejected' here correctly filters a.actioncode = 'Rejected'. */}
        <FilterSelect
          label="Action type"
          value={filters.action}
          onChange={(v) => update('action', v)}
          options={availableActions}
        />

        {/* 6. Module — admin/HR only (Settings and HR removed per UX request) */}
        {isAdmin && (
          <FilterSelect
            label="Module"
            value={filters.module}
            onChange={(v) => update('module', v)}
            options={availableModules}
          />
        )}

        {/* 7. Outcome — admin/HR only */}
        {isAdmin && (
          <FilterSelect
            label="Outcome"
            value={filters.result}
            onChange={(v) => update('result', v)}
            options={RESULT_OPTIONS}
          />
        )}

        {/* 8. Quick toggles */}
        <div className="border-t border-white/5 pt-2 space-y-2">
          <Toggle
            checked={filters.myActivityOnly}
            onChange={(v) => update('myActivityOnly', v)}
            label="My activity only"
          />
          {isAdmin && (
            <Toggle
              checked={filters.importantOnly}
              onChange={(v) => update('importantOnly', v)}
              label="Important activity only"
            />
          )}
        </div>

      </div>

      <div className="shrink-0 border-t border-white/10 p-3">
        <button onClick={onClear} className="w-full rounded-lg border border-rose-500/20 py-2 text-xs font-semibold text-rose-300">
          Clear all filters
        </button>
      </div>
    </aside>
  );
};

// ─── Reusable filter controls ─────────────────────────────────────────────────
const FilterSelect: React.FC<{
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string } | string>;
  includeNoneOption?: boolean;
  emptyOptionLabel?: string;
}> = ({ label, value, onChange, options, includeNoneOption = true, emptyOptionLabel = 'All' }) => (
  <label className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500">
    {label}
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950/60 px-2.5 py-2 text-xs normal-case tracking-normal text-slate-200 outline-none"
    >
      {includeNoneOption && <option value="">{emptyOptionLabel}</option>}
      {options.map((option) => {
        const optValue = typeof option === 'string' ? option : option.value;
        const optLabel = typeof option === 'string' ? option.replaceAll('_', ' ') : option.label;
        return <option key={optValue} value={optValue}>{optLabel}</option>;
      })}
    </select>
  </label>
);

const FilterInput: React.FC<{
  label: string; value: string; onChange: (value: string) => void; type: string;
}> = ({ label, value, onChange, type }) => (
  <label className="text-[10px] font-semibold uppercase text-slate-500">
    {label}
    <input type={type} value={value} onChange={(e) => onChange(e.target.value)}
      className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950/60 px-2 py-2 text-xs text-slate-200" />
  </label>
);

const Toggle: React.FC<{ checked: boolean; onChange: (checked: boolean) => void; label: string }> = ({ checked, onChange, label }) => (
  <label className="flex cursor-pointer items-center justify-between rounded-lg border border-white/5 bg-white/[0.025] px-3 py-2 text-xs text-slate-300">
    <span>{label}</span>
    <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="accent-cyan-400" />
  </label>
);

// ─── Feed row ─────────────────────────────────────────────────────────────────
const ActivityRow: React.FC<{ item: ActivityItem; onClick: () => void }> = ({ item, onClick }) => {
  const ResultIcon = item.result === 'Successful' ? CheckCircle2 : item.result === 'Failed' ? XCircle : ShieldAlert;
  return (
    <button onClick={onClick} className="group flex w-full items-start gap-3 px-3 py-3 text-left transition hover:bg-white/[0.035] sm:px-4">
      <div className="relative shrink-0">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-cyan-500/10 text-[10px] font-bold text-cyan-300">
          {item.actor.name.split(/\s+/).filter(Boolean).slice(0, 2).map((s: string) => s[0]?.toUpperCase()).join('') || 'U'}
        </span>
        {item.isNew && <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border-2 border-slate-950 bg-cyan-400" />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-xs leading-5 text-slate-200 sm:text-sm">
          <strong className="text-white">{item.actor.name}</strong>{' '}
          {item.description.replace(new RegExp(`^${item.actor.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*`, 'i'), '')}
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <Badge label={item.module} tone="cyan" />
          <Badge label={item.action} tone="neutral" />
          {item.changes.slice(0, 1).map((change) => (
            <span key={change.field} className="hidden text-[10px] text-slate-500 sm:inline">
              {change.previousValue ?? '—'} → <span className="text-slate-300">{change.newValue ?? '—'}</span>
            </span>
          ))}
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1 text-[10px] text-slate-500">
        <span title={new Date(item.timestamp).toLocaleString()}>{relativeTime(item.timestamp)}</span>
        <ResultIcon size={14} className={item.result === 'Successful' ? 'text-emerald-400' : item.result === 'Failed' ? 'text-rose-400' : 'text-amber-400'} />
        {item.important && <ShieldAlert size={13} className="text-amber-400" />}
      </div>
    </button>
  );
};

// ─── Detail drawer ────────────────────────────────────────────────────────────
const ActivityDetail: React.FC<{
  item: ActivityItem; loading: boolean; error: string;
  onRetry: () => void; onClose: () => void; onNavigate?: Props['onNavigate'];
}> = ({ item, loading, error, onRetry, onClose, onNavigate }) => (
  <motion.div
    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
    className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm"
    onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
  >
    <motion.aside
      initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
      transition={{ type: 'spring', damping: 30, stiffness: 300 }}
      className="flex h-full w-full max-w-xl flex-col overflow-hidden border-l border-cyan-500/20 bg-slate-950/95 shadow-2xl"
    >
      <header className="flex shrink-0 items-start justify-between border-b border-white/10 p-5">
        <div>
          <div className="mb-2 flex flex-wrap gap-2">
            <Badge label={item.module} tone="cyan" />
            <Badge label={item.action} tone="neutral" />
            <Badge label={item.result} tone={item.result === 'Successful' ? 'success' : item.result === 'Failed' ? 'danger' : 'warning'} />
          </div>
          <h2 className="text-lg font-bold text-white">Activity details</h2>
          <p className="mt-1 text-xs text-slate-500">Event #{item.id}</p>
        </div>
        <button onClick={onClose} className="rounded-lg border border-white/10 p-2 text-slate-400"><X size={17} /></button>
      </header>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
        {loading && (
          <div className="flex items-center gap-2 rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-3 text-xs text-cyan-200" role="status">
            <RefreshCw size={14} className="animate-spin" /> Verifying the latest event details...
          </div>
        )}
        {error && (
          <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-3 text-xs text-rose-200">
            <div className="flex items-start gap-2"><AlertCircle size={14} className="mt-0.5 shrink-0" /><p>{error}</p></div>
            <button onClick={onRetry} className="mt-2 font-semibold text-cyan-300 hover:underline">Retry detail request</button>
          </div>
        )}
        <section>
          <p className="text-sm leading-6 text-slate-200">{item.description}</p>
          {item.reason && (
            <div className="mt-3 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3">
              <p className="text-[10px] font-bold uppercase text-amber-400">Reason / comment</p>
              <p className="mt-1 whitespace-pre-wrap text-xs text-slate-300">{item.reason}</p>
            </div>
          )}
        </section>
        <section className="grid grid-cols-2 gap-3">
          <Detail label="Acting user"       value={`${item.actor.name} (${item.actor.role.replaceAll('_', ' ')})`} />
          <Detail label="Email"             value={item.actor.email || 'Not recorded'} />
          <Detail label="Date and time"     value={new Date(item.timestamp).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'long' })} />
          <Detail label="Source"            value={item.source} />
          <Detail label="Entity"            value={`${item.entityType} · ${item.entityName}`} />
          <Detail label="Entity ID"         value={item.entityId} />
          {item.affectedUser && <Detail label="Affected user" value={item.affectedUser.name} />}
          {item.ipAddress    && <Detail label="IP address"    value={item.ipAddress} />}
        </section>
        {(item.project || item.task) && (
          <section>
            <SectionTitle>Related records</SectionTitle>
            <div className="space-y-2">
              {item.project && <Related label="Project" name={item.project.name} onClick={() => onNavigate?.('projects', item.project!.id)} />}
              {item.task    && <Related label="Task"    name={item.task.name}    onClick={() => onNavigate?.('tasks',    item.task!.id)} />}
            </div>
          </section>
        )}
        <section>
          <SectionTitle>Field changes</SectionTitle>
          {item.changes.length === 0
            ? <p className="rounded-xl border border-white/5 p-3 text-xs text-slate-500">No field-level changes were recorded.</p>
            : (
              <div className="overflow-x-auto rounded-xl border border-white/10">
                <table className="w-full min-w-[420px] text-left text-xs">
                  <thead className="bg-white/5 text-[10px] uppercase text-slate-500">
                    <tr><th className="p-3">Field</th><th className="p-3">Previous</th><th className="p-3">New</th></tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {item.changes.map((change) => (
                      <tr key={change.field}>
                        <td className="p-3 font-semibold text-slate-200">{change.field}</td>
                        <td className="max-w-44 whitespace-pre-wrap break-words p-3 text-rose-300">{change.previousValue ?? '—'}</td>
                        <td className="max-w-44 whitespace-pre-wrap break-words p-3 text-emerald-300">{change.newValue ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
        </section>
        {Object.keys(item.metadata).length > 0 && (
          <section>
            <SectionTitle>Additional context</SectionTitle>
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(item.metadata).map(([key, value]) => (
                <Detail key={key} label={key.replace(/([A-Z])/g, ' $1')} value={typeof value === 'object' ? JSON.stringify(value) : String(value)} />
              ))}
            </div>
          </section>
        )}
        <section className="rounded-xl border border-white/5 bg-black/20 p-3 font-mono text-[10px] text-slate-500">
          <p>Event ID: {item.id}</p>
          <p className="mt-1 break-all">Correlation ID: {item.correlationId}</p>
          <p className="mt-1">Stored UTC: {item.timestamp}</p>
        </section>
      </div>
    </motion.aside>
  </motion.div>
);

// ─── Small presentational components ─────────────────────────────────────────
const Badge: React.FC<{ label: string; tone: 'cyan' | 'neutral' | 'success' | 'danger' | 'warning' }> = ({ label, tone }) => (
  <span className={`rounded-full border px-2 py-0.5 text-[9px] font-bold ${
    tone === 'cyan'    ? 'border-cyan-500/20 bg-cyan-500/10 text-cyan-300'
    : tone === 'success' ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300'
    : tone === 'danger'  ? 'border-rose-500/20 bg-rose-500/10 text-rose-300'
    : tone === 'warning' ? 'border-amber-500/20 bg-amber-500/10 text-amber-300'
    : 'border-white/10 bg-white/5 text-slate-300'}`}>{label}</span>
);

const Detail: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="min-w-0 rounded-xl border border-white/5 bg-white/[0.025] p-3">
    <p className="text-[9px] font-bold uppercase tracking-wide text-slate-500">{label}</p>
    <p className="mt-1 break-words text-xs text-slate-200">{value}</p>
  </div>
);

const Related: React.FC<{ label: string; name: string; onClick: () => void }> = ({ label, name, onClick }) => (
  <button onClick={onClick} className="flex w-full items-center justify-between rounded-xl border border-white/5 bg-white/[0.025] p-3 text-left">
    <span>
      <span className="block text-[9px] uppercase text-slate-500">{label}</span>
      <span className="text-xs font-semibold text-slate-200">{name}</span>
    </span>
    <ExternalLink size={14} className="text-cyan-400" />
  </button>
);

const SectionTitle: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <h3 className="mb-2 text-[10px] font-bold uppercase tracking-wider text-cyan-400">{children}</h3>
);

const FeedState: React.FC<{
  icon: React.ReactNode; title: string; message: string; action?: () => void;
}> = ({ icon, title, message, action }) => (
  <div className="flex h-full min-h-64 flex-col items-center justify-center p-8 text-center">
    <div className="mb-3 text-cyan-400">{icon}</div>
    <h3 className="text-sm font-bold text-slate-200">{title}</h3>
    <p className="mt-1 max-w-sm text-xs text-slate-500">{message}</p>
    {action && (
      <button onClick={action} className="mt-4 rounded-lg border border-cyan-500/20 px-3 py-2 text-xs text-cyan-300">Try again</button>
    )}
  </div>
);

const relativeTime = (timestamp: string) => {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(timestamp).getTime()) / 1000));
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};
