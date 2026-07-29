import React, { useEffect, useMemo, useState } from 'react';
import { GlassCard } from '../../components/common/GlassCard';
import { StatusBadge } from '../../components/common/StatusBadge';
import { useApp } from '../../store/AppContext';
import { Project, Task, User, UserRole } from '../../types';
import {
  Check,
  Briefcase,
  Building2,
  CheckCircle2,
  ChevronRight,
  Copy,
  FolderKanban,
  LayoutGrid,
  List,
  Mail,
  Search,
  ShieldCheck,
  Sparkles,
  UserRoundSearch,
  Users,
  X,
} from 'lucide-react';

type SortOption = 'name' | 'role' | 'recent';
type ViewMode = 'grid' | 'list';

const ROLE_LABELS: Record<UserRole, string> = {
  Admin: 'Administrator',
  Team_Lead: 'Team Lead',
  HR: 'HR',
  Team_Member: 'Team Member',
};

const ROLE_BADGE_CLASS: Record<UserRole, string> = {
  Admin: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  Team_Lead: 'bg-purple-500/15 text-purple-300 border-purple-500/30',
  HR: 'bg-pink-500/15 text-pink-300 border-pink-500/30',
  Team_Member: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
};

const ROLE_SORT_ORDER: Record<UserRole, number> = {
  Admin: 0,
  Team_Lead: 1,
  HR: 2,
  Team_Member: 3,
};

interface MemberInsights {
  activeProjects: Project[];
  leadProjects: Project[];
  activeTasks: Task[];
  completedTasks: Task[];
  overdueTasks: Task[];
}

const isTaskAssignedToUser = (task: Task, userId: string) =>
  task.assigneeId === userId || task.assigneeIds?.includes(userId) === true;

const getMemberInsights = (member: User, projects: Project[], tasks: Task[]): MemberInsights => {
  const projectMembership = projects.filter((project) =>
    project.memberIds.includes(member.id) || project.teamLeadId === member.id,
  );

  const leadProjects = projects.filter((project) => project.teamLeadId === member.id);
  const activeProjects = projectMembership.filter((project) => project.status === 'Active');
  const assignedTasks = tasks.filter((task) => isTaskAssignedToUser(task, member.id));
  const activeTasks = assignedTasks.filter((task) => task.status !== 'Done');
  const completedTasks = assignedTasks.filter((task) => task.status === 'Done');
  const overdueTasks = activeTasks.filter((task) => new Date(task.dueDate) < new Date());

  return {
    activeProjects,
    leadProjects,
    activeTasks,
    completedTasks,
    overdueTasks,
  };
};

const formatDate = (value?: string) => {
  if (!value) return 'Not available';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
};

const formatRole = (role: UserRole) => ROLE_LABELS[role] || role.replace('_', ' ');

export const TeamMembersView: React.FC = () => {
  const { users, tasks, projects, currentRole } = useApp();

  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | UserRole>('all');
  const [sortBy, setSortBy] = useState<SortOption>('role');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [copiedEmail, setCopiedEmail] = useState<string | null>(null);

  const canInspectMembers = currentRole === 'Admin' || currentRole === 'HR';

  const members = useMemo(
    () =>
      users
        .filter((member) => {
          const query = searchQuery.trim().toLowerCase();
          const matchesQuery =
            !query ||
            member.name.toLowerCase().includes(query) ||
            member.email.toLowerCase().includes(query) ||
            member.department.toLowerCase().includes(query) ||
            member.title.toLowerCase().includes(query);

          const matchesRole = roleFilter === 'all' || member.role === roleFilter;
          return matchesQuery && matchesRole;
        })
        .sort((left, right) => {
          if (sortBy === 'role') {
            return ROLE_SORT_ORDER[left.role] - ROLE_SORT_ORDER[right.role] || left.name.localeCompare(right.name);
          }
          if (sortBy === 'recent') return (right.createdAt || '').localeCompare(left.createdAt || '');

          return left.name.localeCompare(right.name);
        }),
    [roleFilter, searchQuery, sortBy, tasks, users],
  );

  const selectedMember = useMemo(
    () => users.find((member) => member.id === selectedMemberId) ?? null,
    [selectedMemberId, users],
  );

  const selectedMemberInsights = useMemo(
    () => (selectedMember ? getMemberInsights(selectedMember, projects, tasks) : null),
    [projects, selectedMember, tasks],
  );

  useEffect(() => {
    if (!canInspectMembers) {
      setSelectedMemberId(null);
    }
  }, [canInspectMembers]);

  const totalMembers = users.length;
  const teamLeadCount = users.filter((member) => member.role === 'Team_Lead').length;
  const hrCount = users.filter((member) => member.role === 'HR').length;
  const teamMemberCount = users.filter((member) => member.role === 'Team_Member').length;

  const roleQuickFilters: Array<{ label: string; value: 'all' | UserRole; count: number }> = [
    { label: 'All', value: 'all', count: users.length },
    { label: 'Admin', value: 'Admin', count: users.filter((member) => member.role === 'Admin').length },
    { label: 'Team Leads', value: 'Team_Lead', count: users.filter((member) => member.role === 'Team_Lead').length },
    { label: 'HR', value: 'HR', count: users.filter((member) => member.role === 'HR').length },
    { label: 'Members', value: 'Team_Member', count: teamMemberCount },
  ];

  const handleCopyEmail = async (email: string) => {
    try {
      await navigator.clipboard.writeText(email);
      setCopiedEmail(email);
      window.setTimeout(() => {
        setCopiedEmail((current) => (current === email ? null : current));
      }, 1800);
    } catch {
      setCopiedEmail(null);
    }
  };

  return (
    <>
      <div className="mx-auto max-w-7xl space-y-6">
        <section className="glass-panel-glow border border-cyan-500/25 p-5 md:p-6">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
            <div className="max-w-3xl space-y-3">
              <div className="flex items-center gap-3">
                <div className="rounded-2xl border border-cyan-500/30 bg-cyan-500/10 p-3 text-cyan-300">
                  <Users size={24} />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2.5 py-1 text-[10px] font-mono uppercase tracking-[0.25em] text-cyan-300">
                      Member Directory
                    </span>
                  </div>
                  <h1 className="mt-3 text-2xl font-bold text-white md:text-[2rem]">Team directory and member contact overview.</h1>
                </div>
              </div>
              <p className="text-sm leading-6 text-slate-400">
                Review the team roster, role coverage, and member contact details in a cleaner directory view aligned with the rest of WorkSync.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:min-w-[32rem]">
              <GlassCard glowColor="cyan" hover3dTilt={false} className="cursor-default p-4 md:p-4.5">
                <div className="text-[11px] font-mono uppercase tracking-[0.18em] text-slate-500">Members</div>
                <div className="mt-2 text-2xl font-bold text-white">{totalMembers}</div>
              </GlassCard>
              <GlassCard glowColor="emerald" hover3dTilt={false} className="cursor-default p-4 md:p-4.5">
                <div className="text-[11px] font-mono uppercase tracking-[0.18em] text-slate-500">Showing</div>
                <div className="mt-2 text-2xl font-bold text-emerald-300">{members.length}</div>
              </GlassCard>
              <GlassCard glowColor="violet" hover3dTilt={false} className="cursor-default p-4 md:p-4.5">
                <div className="text-[11px] font-mono uppercase tracking-[0.18em] text-slate-500">Team Leads</div>
                <div className="mt-2 text-2xl font-bold text-purple-300">{teamLeadCount}</div>
              </GlassCard>
              <GlassCard glowColor="magenta" hover3dTilt={false} className="cursor-default p-4 md:p-4.5">
                <div className="text-[11px] font-mono uppercase tracking-[0.18em] text-slate-500">HR</div>
                <div className="mt-2 text-2xl font-bold text-fuchsia-300">{hrCount}</div>
              </GlassCard>
            </div>
          </div>
        </section>

        <section className="glass-panel border border-white/10 p-4 md:p-5">
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
              {roleQuickFilters.map((filter) => {
                const active = roleFilter === filter.value;
                return (
                  <button
                    key={filter.label}
                    type="button"
                    onClick={() => setRoleFilter(filter.value)}
                    className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                      active
                        ? 'border-cyan-500/40 bg-cyan-500/15 text-cyan-300'
                        : 'border-white/10 bg-white/5 text-slate-400 hover:border-white/20 hover:text-white'
                    }`}
                  >
                    {filter.label} <span className="ml-1 text-slate-500">{filter.count}</span>
                  </button>
                );
              })}
            </div>

            <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <div className="flex flex-1 flex-col gap-3 md:flex-row md:items-center">
                <label className="relative flex-1 min-w-[16rem]">
                  <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                  <input
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder="Search by name, email, department, or title"
                    className="w-full rounded-xl border border-white/10 bg-black/30 py-2.5 pl-10 pr-3 text-sm text-slate-200 placeholder:text-slate-500 focus:border-cyan-500/40 focus:outline-none"
                  />
                </label>

              </div>

              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
                <div className="flex items-center gap-1 rounded-xl border border-white/10 bg-black/30 p-1">
                  <button
                    type="button"
                    onClick={() => setViewMode('grid')}
                    className={`rounded-lg px-2.5 py-2 text-xs transition ${
                      viewMode === 'grid' ? 'bg-cyan-500/15 text-cyan-300' : 'text-slate-400 hover:text-white'
                    }`}
                    aria-label="Grid view"
                  >
                    <LayoutGrid size={15} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewMode('list')}
                    className={`rounded-lg px-2.5 py-2 text-xs transition ${
                      viewMode === 'list' ? 'bg-cyan-500/15 text-cyan-300' : 'text-slate-400 hover:text-white'
                    }`}
                    aria-label="List view"
                  >
                    <List size={15} />
                  </button>
                </div>

                <select
                  value={sortBy}
                  onChange={(event) => setSortBy(event.target.value as SortOption)}
                  className="rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-slate-300 focus:border-cyan-500/40 focus:outline-none"
                >
                  <option value="name">Sort: Name</option>
                  <option value="role">Sort: Role</option>
                  <option value="recent">Sort: Recently Added</option>
                </select>

                <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-400 sm:text-right">
                  Showing <span className="font-semibold text-white">{members.length}</span> of <span className="font-semibold text-white">{totalMembers}</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="glass-panel border border-white/10 xl:flex xl:h-[min(72vh,48rem)] xl:flex-col xl:overflow-hidden">
          <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
            <div>
              <h2 className="text-sm font-semibold text-white">Member roster</h2>
              <p className="mt-1 text-xs text-slate-400">
                {canInspectMembers
                  ? 'Select a member to inspect assignments, project participation, and role ownership in detail.'
                  : 'Browse the current team roster and general member information.'}
              </p>
            </div>
            {canInspectMembers && (
              <div className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 text-[11px] font-mono text-cyan-300">
                Admin / HR detail access enabled
              </div>
            )}
          </div>

          <div className="px-4 py-4 md:px-5 md:py-5 xl:min-h-0 xl:flex-1 xl:overflow-y-auto">
            {members.length === 0 ? (
              <div className="flex min-h-[16rem] flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-black/20 px-6 text-center">
                <UserRoundSearch size={28} className="text-slate-500" />
                <h3 className="mt-4 text-base font-semibold text-white">No members match the current filters.</h3>
                <p className="mt-2 max-w-md text-sm text-slate-400">
                  Adjust the search criteria or role filter to widen the roster view.
                </p>
              </div>
            ) : viewMode === 'grid' ? (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                {members.map((member) => {
                  const isClickable = canInspectMembers;

                  return (
                    <GlassCard
                      key={member.id}
                      glowColor={member.role === 'Admin' ? 'amber' : member.role === 'HR' ? 'magenta' : member.role === 'Team_Lead' ? 'violet' : 'cyan'}
                      hover3dTilt={false}
                      onClick={isClickable ? () => setSelectedMemberId(member.id) : undefined}
                      className={`h-full p-4 md:p-5 ${isClickable ? 'cursor-pointer' : 'cursor-default'}`}
                    >
                      <div className="flex h-full flex-col gap-4 rounded-[1.15rem] bg-gradient-to-b from-white/[0.02] to-transparent">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex min-w-0 items-start gap-3">
                            <img
                              src={member.avatar}
                              alt={member.name}
                              className="h-13 w-13 rounded-2xl border border-white/10 object-cover bg-white/5 md:h-14 md:w-14"
                            />
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <h3 className="truncate text-[15px] font-semibold text-white md:text-base">{member.name}</h3>
                              </div>
                              <p className="mt-1 truncate text-sm text-slate-400">{member.title}</p>
                              <div className="mt-2 flex flex-wrap items-center gap-2">
                                <div className="inline-flex max-w-full items-center gap-2 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-slate-400">
                                  <Building2 size={13} />
                                  <span className="truncate">{member.department}</span>
                                </div>
                              </div>
                            </div>
                          </div>

                          <span className={`whitespace-nowrap rounded-full border px-2.5 py-1 text-[10px] font-semibold leading-none ${ROLE_BADGE_CLASS[member.role]}`}>
                            {formatRole(member.role)}
                          </span>
                        </div>

                        <div className="grid gap-2.5 border-t border-white/10 pt-4 text-sm text-slate-300">
                          <div className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
                            <div className="flex min-w-0 items-center gap-2 truncate">
                            <Mail size={14} className="shrink-0 text-slate-500" />
                            <span className="truncate">{member.email}</span>
                            </div>
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                void handleCopyEmail(member.email);
                              }}
                              className="rounded-lg border border-white/10 bg-black/20 p-1.5 text-slate-400 transition hover:border-cyan-500/30 hover:text-cyan-300"
                              aria-label={`Copy ${member.name} email`}
                            >
                              {copiedEmail === member.email ? <Check size={13} /> : <Copy size={13} />}
                            </button>
                          </div>
                          <div className="flex items-center gap-2 truncate rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2.5 text-slate-400 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
                            <Users size={14} className="shrink-0 text-slate-500" />
                            <span className="truncate">Joined {formatDate(member.createdAt)}</span>
                          </div>
                        </div>

                        <div className="mt-auto flex items-center justify-end border-t border-white/10 pt-4 text-xs text-slate-400">
                          {isClickable ? (
                            <span className="inline-flex items-center gap-1 font-semibold text-cyan-300">
                              View details
                              <ChevronRight size={14} />
                            </span>
                          ) : (
                            <span className="text-slate-500">&nbsp;</span>
                          )}
                        </div>
                      </div>
                    </GlassCard>
                  );
                })}
              </div>
            ) : (
                <div className="space-y-3">
                {members.map((member) => {
                  const isClickable = canInspectMembers;

                  return (
                    <div
                      key={member.id}
                      onClick={isClickable ? () => setSelectedMemberId(member.id) : undefined}
                      className={`rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-4 transition ${
                        isClickable ? 'cursor-pointer hover:border-cyan-500/30 hover:bg-white/[0.06]' : 'cursor-default'
                      }`}
                    >
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                        <div className="flex min-w-0 items-center gap-4">
                          <img
                            src={member.avatar}
                            alt={member.name}
                            className="h-12 w-12 rounded-2xl border border-white/10 object-cover bg-white/5"
                          />
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <h3 className="truncate text-sm font-semibold text-white md:text-base">{member.name}</h3>
                              <span className={`whitespace-nowrap rounded-full border px-2.5 py-1 text-[10px] font-semibold leading-none ${ROLE_BADGE_CLASS[member.role]}`}>
                                {formatRole(member.role)}
                              </span>
                            </div>
                            <p className="mt-1 truncate text-sm text-slate-400">{member.title}</p>
                          </div>
                        </div>

                        <div className="grid gap-3 text-sm text-slate-300 md:grid-cols-[minmax(0,1.2fr)_minmax(0,0.9fr)_auto] md:items-center lg:min-w-[42rem]">
                          <div className="flex min-w-0 items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2.5">
                            <Mail size={14} className="shrink-0 text-slate-500" />
                            <span className="truncate">{member.email}</span>
                          </div>
                          <div className="flex min-w-0 items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-slate-400">
                            <Building2 size={14} className="shrink-0 text-slate-500" />
                            <span className="truncate">{member.department}</span>
                          </div>
                          <div className="flex items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                void handleCopyEmail(member.email);
                              }}
                              className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-300 transition hover:border-cyan-500/30 hover:text-cyan-300"
                            >
                              <span className="inline-flex items-center gap-1.5">
                                {copiedEmail === member.email ? <Check size={13} /> : <Copy size={13} />}
                                {copiedEmail === member.email ? 'Copied' : 'Copy email'}
                              </span>
                            </button>
                            {isClickable && (
                              <span className="inline-flex items-center gap-1 text-xs font-semibold text-cyan-300">
                                Details
                                <ChevronRight size={14} />
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      </div>

      {canInspectMembers && selectedMember && selectedMemberInsights && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-md"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSelectedMemberId(null);
          }}
        >
          <div className="glass-panel-glow flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden border border-cyan-500/25">
            <div className="border-b border-white/10 bg-gradient-to-r from-cyan-500/8 via-transparent to-purple-500/8 px-6 py-5">
              <div className="flex items-start justify-between gap-4">
              <div className="flex min-w-0 items-start gap-4">
                <img
                  src={selectedMember.avatar}
                  alt={selectedMember.name}
                  className="h-16 w-16 rounded-2xl border border-white/10 object-cover bg-white/5"
                />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-xl font-bold text-white">{selectedMember.name}</h2>
                    <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${ROLE_BADGE_CLASS[selectedMember.role]}`}>
                      {formatRole(selectedMember.role)}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-slate-400">{selectedMember.title}</p>
                  <p className="mt-2 max-w-2xl text-xs leading-5 text-slate-500">
                    Member overview covering project participation, leadership ownership, and active delivery workload.
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-400">
                    <span className="inline-flex items-center gap-1.5">
                      <Building2 size={13} />
                      {selectedMember.department}
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <Mail size={13} />
                      {selectedMember.email}
                    </span>
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setSelectedMemberId(null)}
                className="rounded-xl border border-white/10 bg-white/5 p-2 text-slate-400 transition hover:bg-white/10 hover:text-white"
                aria-label="Close member detail"
              >
                <X size={18} />
              </button>
            </div>
            </div>

            <div className="overflow-y-auto px-6 py-5">
              <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
                <GlassCard glowColor="cyan" hover3dTilt={false} className="cursor-default p-4">
                  <div className="text-xs font-mono text-slate-400">Active projects</div>
                  <div className="mt-2 text-2xl font-bold text-white">{selectedMemberInsights.activeProjects.length}</div>
                </GlassCard>
                <GlassCard glowColor="violet" hover3dTilt={false} className="cursor-default p-4">
                  <div className="text-xs font-mono text-slate-400">Projects leading</div>
                  <div className="mt-2 text-2xl font-bold text-purple-300">{selectedMemberInsights.leadProjects.length}</div>
                </GlassCard>
                <GlassCard glowColor="amber" hover3dTilt={false} className="cursor-default p-4">
                  <div className="text-xs font-mono text-slate-400">Open tasks</div>
                  <div className="mt-2 text-2xl font-bold text-amber-300">{selectedMemberInsights.activeTasks.length}</div>
                </GlassCard>
                <GlassCard glowColor="emerald" hover3dTilt={false} className="cursor-default p-4">
                  <div className="text-xs font-mono text-slate-400">Completed tasks</div>
                  <div className="mt-2 text-2xl font-bold text-emerald-300">{selectedMemberInsights.completedTasks.length}</div>
                </GlassCard>
              </div>

              <div className="mt-5 grid gap-5 xl:grid-cols-12">
                <div className="space-y-5 xl:col-span-5">
                  <div className="glass-panel border border-white/10 p-5">
                    <div className="flex items-center gap-2">
                      <ShieldCheck size={16} className="text-cyan-300" />
                      <h3 className="text-sm font-semibold text-white">Member summary</h3>
                    </div>
                    <div className="mt-4 space-y-3 text-sm text-slate-300">
                      <div className="flex items-center justify-between gap-4 rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2.5">
                        <span className="text-slate-400">Created in system</span>
                        <span className="font-medium text-white">{formatDate(selectedMember.createdAt)}</span>
                      </div>
                      <div className="flex items-center justify-between gap-4 rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2.5">
                        <span className="text-slate-400">Current role</span>
                        <span className="font-medium text-white">{formatRole(selectedMember.role)}</span>
                      </div>
                      <div className="flex items-center justify-between gap-4 rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2.5">
                        <span className="text-slate-400">Overdue work items</span>
                        <span className="font-medium text-white">{selectedMemberInsights.overdueTasks.length}</span>
                      </div>
                      <div className="flex items-center justify-between gap-4 rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2.5">
                        <span className="text-slate-400">Current workload</span>
                        <span className="font-medium text-white">{selectedMemberInsights.activeTasks.length} open tasks</span>
                      </div>
                    </div>
                  </div>

                  <div className="glass-panel border border-white/10 p-5">
                    <div className="flex items-center gap-2">
                      <FolderKanban size={16} className="text-purple-300" />
                      <h3 className="text-sm font-semibold text-white">Active project participation</h3>
                    </div>
                    <div className="mt-4 max-h-72 space-y-3 overflow-y-auto pr-1">
                      {selectedMemberInsights.activeProjects.length === 0 ? (
                        <p className="rounded-xl border border-dashed border-white/10 bg-black/20 px-4 py-5 text-sm text-slate-500">
                          No active projects are assigned to this member right now.
                        </p>
                      ) : (
                        selectedMemberInsights.activeProjects.map((project) => (
                          <div key={project.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <div className="text-sm font-semibold text-white">{project.title}</div>
                                <div className="mt-1 text-xs text-slate-400">{project.code}</div>
                              </div>
                              <StatusBadge status={project.status} size="sm" />
                            </div>
                            <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-400">
                              <span className="rounded-full border border-white/10 bg-black/20 px-2 py-1">
                                Deadline {formatDate(project.targetDate)}
                              </span>
                              <span className="rounded-full border border-white/10 bg-black/20 px-2 py-1">
                                {project.progress}% progress
                              </span>
                              {project.teamLeadId === selectedMember.id && (
                                <span className="rounded-full border border-purple-500/20 bg-purple-500/10 px-2 py-1 text-purple-300">
                                  Project lead
                                </span>
                              )}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>

                <div className="space-y-5 xl:col-span-7">
                  <div className="glass-panel border border-white/10 p-5">
                    <div className="flex items-center gap-2">
                      <Briefcase size={16} className="text-amber-300" />
                      <h3 className="text-sm font-semibold text-white">Current work items</h3>
                    </div>
                    <div className="mt-4 max-h-80 space-y-3 overflow-y-auto pr-1">
                      {selectedMemberInsights.activeTasks.length === 0 ? (
                        <p className="rounded-xl border border-dashed border-white/10 bg-black/20 px-4 py-5 text-sm text-slate-500">
                          No active tasks are currently assigned.
                        </p>
                      ) : (
                        selectedMemberInsights.activeTasks.map((task) => {
                          const project = projects.find((item) => item.id === task.projectId);
                          return (
                            <div key={task.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                                <div className="min-w-0">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="rounded-full border border-white/10 bg-black/20 px-2 py-1 text-[11px] font-mono text-slate-400">
                                      {task.taskNumber}
                                    </span>
                                    <StatusBadge status={task.status} size="sm" />
                                  </div>
                                  <h4 className="mt-2 text-sm font-semibold text-white">{task.title}</h4>
                                  <p className="mt-1 line-clamp-2 text-sm text-slate-400">{task.description}</p>
                                </div>

                                <div className="flex flex-wrap gap-2 text-xs">
                                  <span className="rounded-full border border-white/10 bg-black/20 px-2 py-1 text-slate-400">
                                    {project?.title || 'Unlinked project'}
                                  </span>
                                  <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-1 text-amber-300">
                                    Due {formatDate(task.dueDate)}
                                  </span>
                                  <span className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-2 py-1 text-cyan-300">
                                    {task.priority} priority
                                  </span>
                                </div>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>

                  <div className="grid gap-5 lg:grid-cols-2">
                    <div className="glass-panel border border-white/10 p-5">
                      <div className="flex items-center gap-2">
                        <Sparkles size={16} className="text-purple-300" />
                        <h3 className="text-sm font-semibold text-white">Projects led</h3>
                      </div>
                      <div className="mt-4 max-h-56 space-y-3 overflow-y-auto pr-1">
                        {selectedMemberInsights.leadProjects.length === 0 ? (
                          <p className="rounded-xl border border-dashed border-white/10 bg-black/20 px-4 py-5 text-sm text-slate-500">
                            This member is not leading any projects right now.
                          </p>
                        ) : (
                          selectedMemberInsights.leadProjects.map((project) => (
                            <div key={project.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                              <div className="text-sm font-semibold text-white">{project.title}</div>
                              <div className="mt-1 text-xs text-slate-400">{project.code}</div>
                              <div className="mt-3 flex items-center justify-between gap-3 text-xs text-slate-400">
                                <span>{project.memberIds.length} members</span>
                                <span>{project.progress}% progress</span>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>

                    <div className="glass-panel border border-white/10 p-5">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 size={16} className="text-emerald-300" />
                        <h3 className="text-sm font-semibold text-white">Completed delivery</h3>
                      </div>
                      <div className="mt-4 max-h-56 space-y-3 overflow-y-auto pr-1">
                        {selectedMemberInsights.completedTasks.length === 0 ? (
                          <p className="rounded-xl border border-dashed border-white/10 bg-black/20 px-4 py-5 text-sm text-slate-500">
                            No completed tasks are available for this member yet.
                          </p>
                        ) : (
                          selectedMemberInsights.completedTasks.slice(0, 8).map((task) => (
                            <div key={task.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                              <div className="flex items-center justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="truncate text-sm font-semibold text-white">{task.title}</div>
                                  <div className="mt-1 text-xs text-slate-400">{task.taskNumber}</div>
                                </div>
                                <StatusBadge status={task.status} size="sm" />
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
