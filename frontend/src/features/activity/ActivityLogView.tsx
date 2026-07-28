import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, AlertCircle, ArrowDownUp, CalendarDays, CheckCircle2, ChevronLeft,
  ChevronRight, Clock3, Download, ExternalLink, Filter, RefreshCw, Search,
  ShieldAlert, SlidersHorizontal, UserRound, X, XCircle
} from 'lucide-react';
import { useApp } from '../../store/AppContext';
import { downloadActivityCsv, fetchActivities } from './activityApi';
import { ActivityFilters, ActivityItem, EMPTY_ACTIVITY_FILTERS } from './activityTypes';

const MODULES = ['Projects', 'Tasks', 'Kanban', 'Project Chats', 'Attendance', 'Approvals', 'Calendar', 'AI Assistant', 'Profile', 'Permissions', 'Authentication', 'Activity Log'];
const ACTIONS = ['Created', 'Updated', 'Deleted', 'Assigned', 'Assigned/Reassigned', 'Status Changed', 'Priority Changed', 'Approved', 'Rejected', 'Commented', 'Mentioned', 'Uploaded Attachment', 'Deleted Attachment', 'Checked In', 'Checked Out', 'Permission Granted', 'Permission Revoked', 'Permission Expired', 'Login', 'Logout', 'Exported'];
const ENTITY_TYPES = ['Project', 'Task', 'Comment', 'User', 'Attendance Record', 'Approval', 'Permission'];
const STATUSES = ['Todo', 'In Progress', 'Review', 'Done', 'Approved', 'Rejected'];
const PRIORITIES = ['Low', 'Medium', 'High', 'Critical'];
const DATE_PRESETS: ActivityFilters['datePreset'][] = ['Today', 'Yesterday', 'Last 7 Days', 'Last 30 Days', 'Custom', 'All'];

interface Props { onNavigate?: (tab: string, id?: string) => void }

export const ActivityLogView: React.FC<Props> = ({ onNavigate }) => {
  const { users, projects, tasks, currentRole } = useApp();
  const [filters, setFilters] = useState<ActivityFilters>({ ...EMPTY_ACTIVITY_FILTERS });
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [selected, setSelected] = useState<ActivityItem | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const result = await fetchActivities(filters, page);
      setItems(result.items); setTotal(result.total); setTotalPages(result.totalPages);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not load activity.');
    } finally { setLoading(false); }
  }, [filters, page, refreshKey]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setPage(1); }, [filters]);

  const activeChips = useMemo(() => {
    const chips: Array<{ key: keyof ActivityFilters; label: string }> = [];
    if (filters.datePreset !== 'All') chips.push({ key: 'datePreset', label: filters.datePreset });
    const labels: Array<[keyof ActivityFilters, string]> = [
      ['userId', users.find((u) => u.id === filters.userId)?.name || ''], ['userRole', filters.userRole],
      ['projectId', projects.find((p) => p.id === filters.projectId)?.title || ''],
      ['taskId', tasks.find((t) => t.id === filters.taskId)?.title || ''], ['module', filters.module],
      ['action', filters.action], ['entityType', filters.entityType], ['status', filters.status],
      ['priority', filters.priority], ['result', filters.result], ['source', filters.source]
    ];
    labels.forEach(([key, label]) => { if (label) chips.push({ key, label }); });
    if (filters.myActivityOnly) chips.push({ key: 'myActivityOnly', label: 'My activity' });
    if (filters.importantOnly) chips.push({ key: 'importantOnly', label: 'Important only' });
    return chips;
  }, [filters, users, projects, tasks]);

  const clearChip = (key: keyof ActivityFilters) => setFilters((previous) => ({
    ...previous,
    [key]: key === 'datePreset' ? 'All' : typeof previous[key] === 'boolean' ? false : ''
  }));

  const handleExport = async () => {
    setExporting(true); setError('');
    try { await downloadActivityCsv(filters); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Export failed.'); }
    finally { setExporting(false); }
  };

  return (
    <section data-activity-log className="flex h-[calc(100vh-7rem)] min-h-[560px] flex-col gap-3 overflow-hidden">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2"><Activity className="text-cyan-400" size={22} /><h1 className="text-xl font-bold text-white">Activity Log</h1></div>
          <p className="mt-1 text-xs text-slate-400">Immutable, role-scoped history of workspace changes and security events.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setFiltersOpen((open) => !open)} className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-slate-200 lg:hidden"><SlidersHorizontal size={15} /> Filters</button>
          <button onClick={() => setRefreshKey((key) => key + 1)} disabled={loading} className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-slate-200"><RefreshCw className={loading ? 'animate-spin' : ''} size={15} /> Refresh</button>
          {currentRole === 'Admin' && <button onClick={handleExport} disabled={exporting} className="glass-button-neon inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-bold disabled:opacity-50"><Download size={15} /> {exporting ? 'Exporting…' : 'CSV'}</button>}
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1 gap-3">
        <FilterPanel open={filtersOpen} filters={filters} setFilters={setFilters} users={users} projects={projects} tasks={tasks} onClose={() => setFiltersOpen(false)} />

        <div className="glass-panel flex min-w-0 flex-1 flex-col overflow-hidden border border-white/10">
          <div className="shrink-0 border-b border-white/10 p-3">
            <div className="flex items-center gap-2">
              <div className="relative min-w-0 flex-1"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" /><input value={filters.search} onChange={(event) => setFilters((f) => ({ ...f, search: event.target.value }))} placeholder="Search actor, project, task, description, ID, field or text…" className="w-full rounded-xl border border-white/10 bg-slate-950/50 py-2.5 pl-9 pr-3 text-xs text-slate-200 outline-none focus:border-cyan-500/40" /></div>
              <button onClick={() => setFilters((f) => ({ ...f, sort: f.sort === 'newest' ? 'oldest' : 'newest' }))} className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-white/10 px-3 py-2.5 text-xs text-slate-300"><ArrowDownUp size={14} /><span className="hidden sm:inline">{filters.sort === 'newest' ? 'Newest' : 'Oldest'}</span></button>
            </div>
            {activeChips.length > 0 && <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1">{activeChips.map((chip) => <button key={`${chip.key}-${chip.label}`} onClick={() => clearChip(chip.key)} className="inline-flex shrink-0 items-center gap-1 rounded-full border border-cyan-500/20 bg-cyan-500/10 px-2 py-1 text-[10px] text-cyan-200">{chip.label}<X size={10} /></button>)}<button onClick={() => setFilters({ ...EMPTY_ACTIVITY_FILTERS, datePreset: 'All' })} className="shrink-0 px-2 text-[10px] font-semibold text-rose-300">Clear all</button></div>}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {loading ? <FeedState icon={<RefreshCw className="animate-spin" />} title="Loading activity" message="Fetching the latest scoped audit events…" />
              : error ? <FeedState icon={<AlertCircle />} title="Activity unavailable" message={error} action={() => setRefreshKey((key) => key + 1)} />
              : items.length === 0 ? <FeedState icon={<Filter />} title="No matching activity" message="Try widening the date range or clearing some filters." />
              : <div className="divide-y divide-white/5">{items.map((item) => <ActivityRow key={item.id} item={item} onClick={() => setSelected(item)} />)}</div>}
          </div>

          <footer className="flex shrink-0 items-center justify-between border-t border-white/10 px-3 py-2 text-[11px] text-slate-400">
            <span>{total === 0 ? 'No events' : `${(page - 1) * 20 + 1}–${Math.min(page * 20, total)} of ${total}`}</span>
            <div className="flex items-center gap-2"><button aria-label="Previous page" disabled={page <= 1} onClick={() => setPage((value) => value - 1)} className="rounded-lg border border-white/10 p-1.5 disabled:opacity-30"><ChevronLeft size={14} /></button><span>Page {page} / {totalPages}</span><button aria-label="Next page" disabled={page >= totalPages} onClick={() => setPage((value) => value + 1)} className="rounded-lg border border-white/10 p-1.5 disabled:opacity-30"><ChevronRight size={14} /></button></div>
          </footer>
        </div>
      </div>
      {selected && <ActivityDetail item={selected} onClose={() => setSelected(null)} onNavigate={onNavigate} />}
    </section>
  );
};

const FilterPanel: React.FC<any> = ({ open, filters, setFilters, users, projects, tasks, onClose }) => {
  const update = (key: keyof ActivityFilters, value: string | boolean) => setFilters((current: ActivityFilters) => ({ ...current, [key]: value }));
  return <aside className={`${open ? 'absolute inset-0 z-30 flex' : 'hidden'} glass-panel-glow w-full shrink-0 flex-col overflow-hidden border border-white/10 lg:static lg:flex lg:w-72`}>
    <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-4 py-3"><span className="flex items-center gap-2 text-sm font-bold text-white"><Filter size={15} className="text-cyan-400" /> Filters</span><button onClick={onClose} className="lg:hidden"><X size={17} /></button></div>
    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
      <FilterSelect label="Date range" value={filters.datePreset} onChange={(v) => update('datePreset', v)} options={DATE_PRESETS} />
      {filters.datePreset === 'Custom' && <div className="grid grid-cols-2 gap-2"><FilterInput type="date" label="From" value={filters.customFrom} onChange={(v) => update('customFrom', v)} /><FilterInput type="date" label="To" value={filters.customTo} onChange={(v) => update('customTo', v)} /></div>}
      <FilterSelect label="User/member" value={filters.userId} onChange={(v) => update('userId', v)} options={users.map((u: any) => ({ value: u.id, label: u.name }))} />
      <FilterSelect label="User role" value={filters.userRole} onChange={(v) => update('userRole', v)} options={['Admin', 'Team_Member', 'Team_Lead', 'HR']} />
      <FilterSelect label="Project" value={filters.projectId} onChange={(v) => { update('projectId', v); update('taskId', ''); }} options={projects.map((p: any) => ({ value: p.id, label: p.title }))} />
      <FilterSelect label="Task" value={filters.taskId} onChange={(v) => update('taskId', v)} options={tasks.filter((t: any) => !filters.projectId || t.projectId === filters.projectId).map((t: any) => ({ value: t.id, label: t.title }))} />
      <FilterSelect label="Module" value={filters.module} onChange={(v) => update('module', v)} options={MODULES} />
      <FilterSelect label="Action type" value={filters.action} onChange={(v) => update('action', v)} options={ACTIONS} />
      <FilterSelect label="Entity type" value={filters.entityType} onChange={(v) => update('entityType', v)} options={ENTITY_TYPES} />
      <div className="grid grid-cols-2 gap-2"><FilterSelect label="Status" value={filters.status} onChange={(v) => update('status', v)} options={STATUSES} /><FilterSelect label="Priority" value={filters.priority} onChange={(v) => update('priority', v)} options={PRIORITIES} /></div>
      <div className="grid grid-cols-2 gap-2"><FilterSelect label="Result" value={filters.result} onChange={(v) => update('result', v)} options={['Successful', 'Failed', 'Blocked']} /><FilterSelect label="Source" value={filters.source} onChange={(v) => update('source', v)} options={['Web', 'API', 'System']} /></div>
      <Toggle checked={filters.myActivityOnly} onChange={(v) => update('myActivityOnly', v)} label="My activity only" />
      <Toggle checked={filters.importantOnly} onChange={(v) => update('importantOnly', v)} label="Important activity only" />
    </div>
    <div className="shrink-0 border-t border-white/10 p-3"><button onClick={() => setFilters({ ...EMPTY_ACTIVITY_FILTERS, datePreset: 'All' })} className="w-full rounded-lg border border-rose-500/20 py-2 text-xs font-semibold text-rose-300">Clear all filters</button></div>
  </aside>;
};

const FilterSelect: React.FC<any> = ({ label, value, onChange, options }) => <label className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}<select value={value} onChange={(e) => onChange(e.target.value)} className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950/60 px-2.5 py-2 text-xs normal-case tracking-normal text-slate-200 outline-none"><option value="">All</option>{options.map((option: any) => { const value = typeof option === 'string' ? option : option.value; return <option key={value} value={value}>{typeof option === 'string' ? option.replaceAll('_', ' ') : option.label}</option>; })}</select></label>;
const FilterInput: React.FC<any> = ({ label, value, onChange, type }) => <label className="text-[10px] font-semibold uppercase text-slate-500">{label}<input type={type} value={value} onChange={(e) => onChange(e.target.value)} className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950/60 px-2 py-2 text-xs text-slate-200" /></label>;
const Toggle: React.FC<any> = ({ checked, onChange, label }) => <label className="flex cursor-pointer items-center justify-between rounded-lg border border-white/5 bg-white/[0.025] px-3 py-2 text-xs text-slate-300"><span>{label}</span><input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="accent-cyan-400" /></label>;

const ActivityRow: React.FC<{ item: ActivityItem; onClick: () => void }> = ({ item, onClick }) => {
  const ResultIcon = item.result === 'Successful' ? CheckCircle2 : item.result === 'Failed' ? XCircle : ShieldAlert;
  return <button onClick={onClick} className="group flex w-full items-start gap-3 px-3 py-3 text-left transition hover:bg-white/[0.035] sm:px-4">
    <div className="relative shrink-0">{item.actor.avatar ? <img src={item.actor.avatar} alt="" className="h-9 w-9 rounded-xl object-cover ring-1 ring-white/10" /> : <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-cyan-500/10 text-cyan-300"><UserRound size={16} /></span>}{item.isNew && <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border-2 border-slate-950 bg-cyan-400" />}</div>
    <div className="min-w-0 flex-1"><p className="line-clamp-2 text-xs leading-5 text-slate-200 sm:text-sm"><strong className="text-white">{item.actor.name}</strong>{' '}{item.description.replace(new RegExp(`^${item.actor.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*`, 'i'), '')}</p><div className="mt-1.5 flex flex-wrap items-center gap-1.5"><Badge label={item.module} tone="cyan" /><Badge label={item.action} tone="neutral" />{item.changes.slice(0, 1).map((change) => <span key={change.field} className="hidden text-[10px] text-slate-500 sm:inline">{change.previousValue ?? '—'} → <span className="text-slate-300">{change.newValue ?? '—'}</span></span>)}</div></div>
    <div className="flex shrink-0 flex-col items-end gap-1 text-[10px] text-slate-500"><span title={new Date(item.timestamp).toLocaleString()}>{relativeTime(item.timestamp)}</span><ResultIcon size={14} className={item.result === 'Successful' ? 'text-emerald-400' : item.result === 'Failed' ? 'text-rose-400' : 'text-amber-400'} />{item.important && <ShieldAlert size={13} className="text-amber-400" />}</div>
  </button>;
};

const ActivityDetail: React.FC<{ item: ActivityItem; onClose: () => void; onNavigate?: Props['onNavigate'] }> = ({ item, onClose, onNavigate }) => <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
  <aside className="flex h-full w-full max-w-xl flex-col overflow-hidden border-l border-cyan-500/20 bg-slate-950/95 shadow-2xl">
    <header className="flex shrink-0 items-start justify-between border-b border-white/10 p-5"><div><div className="mb-2 flex flex-wrap gap-2"><Badge label={item.module} tone="cyan" /><Badge label={item.action} tone="neutral" /><Badge label={item.result} tone={item.result === 'Successful' ? 'success' : item.result === 'Failed' ? 'danger' : 'warning'} /></div><h2 className="text-lg font-bold text-white">Activity details</h2><p className="mt-1 text-xs text-slate-500">Event #{item.id}</p></div><button onClick={onClose} className="rounded-lg border border-white/10 p-2 text-slate-400"><X size={17} /></button></header>
    <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
      <section><p className="text-sm leading-6 text-slate-200">{item.description}</p>{item.reason && <div className="mt-3 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3"><p className="text-[10px] font-bold uppercase text-amber-400">Reason / comment</p><p className="mt-1 whitespace-pre-wrap text-xs text-slate-300">{item.reason}</p></div>}</section>
      <section className="grid grid-cols-2 gap-3"><Detail label="Acting user" value={`${item.actor.name} (${item.actor.role.replaceAll('_', ' ')})`} /><Detail label="Email" value={item.actor.email || 'Not recorded'} /><Detail label="Date and exact time" value={new Date(item.timestamp).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'long' })} /><Detail label="Source" value={item.source} /><Detail label="Entity" value={`${item.entityType} · ${item.entityName}`} /><Detail label="Entity ID" value={item.entityId} />{item.affectedUser && <Detail label="Affected user" value={item.affectedUser.name} />}{item.ipAddress && <Detail label="IP address" value={item.ipAddress} />}</section>
      {(item.project || item.task) && <section><SectionTitle>Related records</SectionTitle><div className="space-y-2">{item.project && <Related label="Project" name={item.project.name} onClick={() => onNavigate?.('projects', item.project!.id)} />}{item.task && <Related label="Task" name={item.task.name} onClick={() => onNavigate?.('tasks', item.task!.id)} />}</div></section>}
      <section><SectionTitle>Field changes</SectionTitle>{item.changes.length === 0 ? <p className="rounded-xl border border-white/5 p-3 text-xs text-slate-500">No field-level changes were recorded for this event.</p> : <div className="overflow-x-auto rounded-xl border border-white/10"><table className="w-full min-w-[420px] text-left text-xs"><thead className="bg-white/5 text-[10px] uppercase text-slate-500"><tr><th className="p-3">Field</th><th className="p-3">Previous value</th><th className="p-3">New value</th></tr></thead><tbody className="divide-y divide-white/5">{item.changes.map((change) => <tr key={change.field}><td className="p-3 font-semibold text-slate-200">{change.field}</td><td className="max-w-44 whitespace-pre-wrap break-words p-3 text-rose-300">{change.previousValue ?? '—'}</td><td className="max-w-44 whitespace-pre-wrap break-words p-3 text-emerald-300">{change.newValue ?? '—'}</td></tr>)}</tbody></table></div>}</section>
      {Object.keys(item.metadata).length > 0 && <section><SectionTitle>Additional context</SectionTitle><div className="grid grid-cols-2 gap-2">{Object.entries(item.metadata).map(([key, value]) => <Detail key={key} label={key.replace(/([A-Z])/g, ' $1')} value={typeof value === 'object' ? JSON.stringify(value) : String(value)} />)}</div></section>}
      <section className="rounded-xl border border-white/5 bg-black/20 p-3 font-mono text-[10px] text-slate-500"><p>Event ID: {item.id}</p><p className="mt-1 break-all">Correlation ID: {item.correlationId}</p><p className="mt-1">Stored UTC: {item.timestamp}</p></section>
    </div>
  </aside>
</div>;

const Badge: React.FC<{ label: string; tone: 'cyan' | 'neutral' | 'success' | 'danger' | 'warning' }> = ({ label, tone }) => <span className={`rounded-full border px-2 py-0.5 text-[9px] font-bold ${tone === 'cyan' ? 'border-cyan-500/20 bg-cyan-500/10 text-cyan-300' : tone === 'success' ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300' : tone === 'danger' ? 'border-rose-500/20 bg-rose-500/10 text-rose-300' : tone === 'warning' ? 'border-amber-500/20 bg-amber-500/10 text-amber-300' : 'border-white/10 bg-white/5 text-slate-300'}`}>{label}</span>;
const Detail: React.FC<{ label: string; value: string }> = ({ label, value }) => <div className="min-w-0 rounded-xl border border-white/5 bg-white/[0.025] p-3"><p className="text-[9px] font-bold uppercase tracking-wide text-slate-500">{label}</p><p className="mt-1 break-words text-xs text-slate-200">{value}</p></div>;
const Related: React.FC<{ label: string; name: string; onClick: () => void }> = ({ label, name, onClick }) => <button onClick={onClick} className="flex w-full items-center justify-between rounded-xl border border-white/5 bg-white/[0.025] p-3 text-left"><span><span className="block text-[9px] uppercase text-slate-500">{label}</span><span className="text-xs font-semibold text-slate-200">{name}</span></span><ExternalLink size={14} className="text-cyan-400" /></button>;
const SectionTitle: React.FC<{ children: React.ReactNode }> = ({ children }) => <h3 className="mb-2 text-[10px] font-bold uppercase tracking-wider text-cyan-400">{children}</h3>;
const FeedState: React.FC<{ icon: React.ReactNode; title: string; message: string; action?: () => void }> = ({ icon, title, message, action }) => <div className="flex h-full min-h-64 flex-col items-center justify-center p-8 text-center"><div className="mb-3 text-cyan-400">{icon}</div><h3 className="text-sm font-bold text-slate-200">{title}</h3><p className="mt-1 max-w-sm text-xs text-slate-500">{message}</p>{action && <button onClick={action} className="mt-4 rounded-lg border border-cyan-500/20 px-3 py-2 text-xs text-cyan-300">Try again</button>}</div>;
const relativeTime = (timestamp: string) => { const seconds = Math.max(0, Math.floor((Date.now() - new Date(timestamp).getTime()) / 1000)); if (seconds < 60) return 'just now'; if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`; if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`; return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); };
