import React, { useState } from 'react';
import { useApp } from '../../store/AppContext';
import { StatusBadge } from '../../components/common/StatusBadge';
import { GlassCard } from '../../components/common/GlassCard';
import {
  User, Shield, Briefcase, Mail, CheckSquare, FolderKanban,
  Clock, Sparkles, Github, Edit2, Save, X, Users,
  ClipboardList, BarChart2, Activity, Star
} from 'lucide-react';
import { UserRole } from '../../types';

// ─── Edit Profile Modal ──────────────────────────────────────────────────────
interface EditProfileModalProps {
  onClose: () => void;
}

const EditProfileModal: React.FC<EditProfileModalProps> = ({ onClose }) => {
  const { currentUser, updateCurrentUserProfile } = useApp();
  const [form, setForm] = useState({
    name: currentUser.name,
    email: currentUser.email,
    title: currentUser.title,
    department: currentUser.department,
    githubUsername: currentUser.githubUsername || '',
    status: currentUser.status as 'active' | 'away' | 'inactive',
  });

  const handleSave = () => {
    updateCurrentUserProfile(form);
    onClose();
  };

  const inputCls = 'w-full px-3 py-2 rounded-xl bg-black/40 border border-white/10 text-slate-100 text-xs font-mono focus:outline-none focus:border-cyan-500/60 focus:shadow-[0_0_10px_rgba(0,242,254,0.15)] transition-all';
  const labelCls = 'block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="glass-panel-glow border-cyan-500/30 w-full max-w-md p-6 space-y-5 animate-fadeIn">
        <div className="flex items-center justify-between pb-3 border-b border-white/10">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-cyan-500/20 text-cyan-400 border border-cyan-500/30">
              <Edit2 size={16} />
            </div>
            <h2 className="text-sm font-bold text-white">Edit My Profile</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Full Name</label>
            <input className={inputCls} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          </div>
          <div>
            <label className={labelCls}>Email</label>
            <input className={inputCls} value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
          </div>
          <div>
            <label className={labelCls}>Title / Position</label>
            <input className={inputCls} value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
          </div>
          <div>
            <label className={labelCls}>Department</label>
            <input className={inputCls} value={form.department} onChange={e => setForm(f => ({ ...f, department: e.target.value }))} />
          </div>
          <div>
            <label className={labelCls}>GitHub Username</label>
            <input className={inputCls} value={form.githubUsername} onChange={e => setForm(f => ({ ...f, githubUsername: e.target.value }))} placeholder="e.g. AbdulAzeemHashmi" />
          </div>
          <div>
            <label className={labelCls}>Status</label>
            <select
              className={inputCls}
              value={form.status}
              onChange={e => setForm(f => ({ ...f, status: e.target.value as typeof form.status }))}
            >
              <option value="active">Active</option>
              <option value="away">Away</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
        </div>

        <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-[10px] text-amber-300 font-mono">
          🔒 Role is managed by Admin and cannot be changed from your profile.
        </div>

        <div className="flex gap-3 pt-2">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl bg-white/5 border border-white/10 text-slate-300 text-xs font-bold hover:bg-white/10 transition-colors">
            Cancel
          </button>
          <button onClick={handleSave} className="flex-1 py-2.5 rounded-xl glass-button-neon text-xs font-bold flex items-center justify-center gap-1.5">
            <Save size={14} /> Save Changes
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── Role-specific stat badge ────────────────────────────────────────────────
const StatPill: React.FC<{ icon: React.ReactNode; label: string; value: string | number; color: string }> = ({ icon, label, value, color }) => (
  <div className={`flex flex-col items-center justify-center p-4 rounded-2xl bg-gradient-to-br ${color} border border-white/10`}>
    <div className="mb-2 opacity-80">{icon}</div>
    <span className="text-xl font-extrabold text-white">{value}</span>
    <span className="text-[10px] text-slate-400 font-mono tracking-wide mt-0.5">{label}</span>
  </div>
);

// ─── Main ProfileView ────────────────────────────────────────────────────────
export const ProfileView: React.FC = () => {
  const { currentUser, currentRole, tasks, projects, attendanceRecords, savedPrompts, users, hrRequests } = useApp();
  const [editOpen, setEditOpen] = useState(false);

  // Determine visible tabs per role
  type TabId = 'tasks' | 'projects' | 'attendance' | 'prompts' | 'my-team' | 'hr-requests';
  const allTabs: { id: TabId; label: string; roles: UserRole[] | 'all' }[] = [
    { id: 'tasks',       label: 'My Tasks',        roles: 'all' },
    { id: 'projects',    label: 'My Projects',      roles: 'all' },
    { id: 'attendance',  label: 'Attendance Log',   roles: 'all' },
    { id: 'prompts',     label: 'Saved Prompts',    roles: 'all' },
    { id: 'my-team',     label: 'My Team',          roles: ['Team_Lead'] },
    { id: 'hr-requests', label: 'HR Requests',      roles: ['HR'] },
  ];

  const visibleTabs = allTabs.filter(
    (t) => t.roles === 'all' || (t.roles as UserRole[]).includes(currentRole)
  );

  const [activeTab, setActiveTab] = useState<TabId>('tasks');

  // Data
  const myTasks = tasks.filter((t) => t.assigneeId === currentUser.id);
  const myProjects = projects.filter((p) => p.memberIds.includes(currentUser.id));
  const myAttendance = attendanceRecords.filter((a) => a.userId === currentUser.id);
  const myTeam = currentRole === 'Team_Lead'
    ? users.filter((u) => u.id !== currentUser.id && myProjects.some((p) => p.memberIds.includes(u.id)))
    : [];
  const myHrRequests = hrRequests.filter((r) => r.userId === currentUser.id);

  // Admin quick stats
  const activeUsers = users.filter((u) => u.status === 'active').length;
  const activeTasks = tasks.filter((t) => t.status !== 'Done').length;
  const activeProjects = projects.filter((p) => p.status === 'Active').length;

  const roleGradient: Record<UserRole, string> = {
    Admin: 'from-amber-500/20 to-orange-600/20 border-amber-500/40',
    Team_Lead: 'from-purple-500/20 to-violet-600/20 border-purple-500/40',
    HR: 'from-pink-500/20 to-rose-600/20 border-pink-500/40',
    Team_Member: 'from-cyan-500/20 to-sky-600/20 border-cyan-500/40',
  };

  const roleBadgeColor: Record<UserRole, string> = {
    Admin: 'text-amber-300',
    Team_Lead: 'text-purple-300',
    HR: 'text-pink-300',
    Team_Member: 'text-cyan-300',
  };

  return (
    <>
      {editOpen && <EditProfileModal onClose={() => setEditOpen(false)} />}

      <div className="space-y-6 max-w-5xl mx-auto">

        {/* ── Profile Hero Card ── */}
        <div className={`glass-panel-glow p-6 border ${roleGradient[currentRole]}`}>
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-5">
            {/* Avatar + Info */}
            <div className="flex items-center gap-5">
              <div className="relative">
                <img
                  src={currentUser.avatar}
                  alt={currentUser.name}
                  className="w-20 h-20 rounded-2xl object-cover ring-2 ring-cyan-400/60 shadow-[0_0_25px_rgba(0,242,254,0.25)]"
                />
                <span className={`absolute -bottom-2 -right-2 w-5 h-5 rounded-full border-2 border-[#090a0f] ${currentUser.status === 'active' ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]' : currentUser.status === 'away' ? 'bg-amber-400' : 'bg-slate-500'}`} />
              </div>

              <div className="space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-xl font-extrabold text-white">{currentUser.name}</h1>
                  {currentRole === 'Admin' && (
                    <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/20 border border-amber-500/40 text-amber-300 text-[10px] font-bold">
                      <Star size={10} /> ADMIN
                    </span>
                  )}
                  <StatusBadge status={currentUser.status} size="sm" />
                </div>
                <p className={`text-sm font-semibold ${roleBadgeColor[currentRole]}`}>{currentUser.title}</p>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-400 font-mono">
                  <span className="flex items-center gap-1"><Mail size={11} className="text-cyan-400" /> {currentUser.email}</span>
                  <span className="flex items-center gap-1"><Briefcase size={11} className="text-purple-400" /> {currentUser.department}</span>
                  {currentUser.githubUsername && (
                    <a
                      href={`https://github.com/${currentUser.githubUsername}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-slate-300 hover:text-white transition-colors"
                    >
                      <Github size={11} className="text-slate-400" /> @{currentUser.githubUsername}
                    </a>
                  )}
                </div>
                <div className="flex items-center gap-1 text-[10px] font-mono text-slate-500">
                  <Shield size={10} className="text-cyan-500" /> Role: <span className={`font-bold ${roleBadgeColor[currentRole]}`}>{currentRole.replace('_', ' ')}</span>
                </div>
              </div>
            </div>

            {/* Edit Button */}
            <button
              onClick={() => setEditOpen(true)}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl glass-button-neon text-xs font-bold shrink-0"
            >
              <Edit2 size={14} /> Edit Profile
            </button>
          </div>

          {/* ── Admin Quick Stats ── */}
          {currentRole === 'Admin' && (
            <div className="mt-6 pt-5 border-t border-white/10">
              <p className="text-[10px] text-amber-400 font-bold tracking-widest mb-3 flex items-center gap-1.5">
                <BarChart2 size={12} /> SYSTEM OVERVIEW (Admin Only)
              </p>
              <div className="grid grid-cols-3 gap-3">
                <StatPill icon={<Users size={20} className="text-cyan-400" />} label="Active Users" value={activeUsers} color="from-cyan-500/10 to-sky-600/10" />
                <StatPill icon={<CheckSquare size={20} className="text-purple-400" />} label="Open Tasks" value={activeTasks} color="from-purple-500/10 to-violet-600/10" />
                <StatPill icon={<FolderKanban size={20} className="text-emerald-400" />} label="Active Projects" value={activeProjects} color="from-emerald-500/10 to-teal-600/10" />
              </div>
            </div>
          )}

          {/* ── Tab Navigation ── */}
          <div className="flex items-center gap-2 border-t border-white/10 mt-5 pt-4 overflow-x-auto">
            {visibleTabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${
                  activeTab === tab.id
                    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-[0_0_10px_rgba(0,242,254,0.2)]'
                    : 'text-slate-400 hover:text-slate-200 border border-transparent'
                }`}
              >
                {tab.label}
                {tab.id === 'tasks' && ` (${myTasks.length})`}
                {tab.id === 'projects' && ` (${myProjects.length})`}
                {tab.id === 'my-team' && ` (${myTeam.length})`}
                {tab.id === 'hr-requests' && ` (${myHrRequests.length})`}
              </button>
            ))}
          </div>
        </div>

        {/* ── Tab Content ── */}

        {activeTab === 'tasks' && (
          <div>
            {myTasks.length === 0 ? (
              <div className="glass-panel p-10 text-center text-slate-500 text-sm">No tasks assigned yet.</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {myTasks.map((t) => (
                  <GlassCard key={t.id} glowColor="violet">
                    <div className="flex justify-between text-xs mb-2">
                      <span className="font-mono text-purple-400 font-bold">{t.taskNumber}</span>
                      <StatusBadge status={t.status} size="sm" />
                    </div>
                    <h3 className="text-xs font-bold text-white mb-1.5 line-clamp-2">{t.title}</h3>
                    <div className="flex items-center justify-between text-[10px] font-mono text-slate-400">
                      <span className="flex items-center gap-1"><Clock size={9} /> Due {t.dueDate}</span>
                      <StatusBadge status={t.priority} size="sm" />
                    </div>
                  </GlassCard>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'projects' && (
          <div>
            {myProjects.length === 0 ? (
              <div className="glass-panel p-10 text-center text-slate-500 text-sm">No projects found.</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {myProjects.map((p) => (
                  <GlassCard key={p.id} glowColor="cyan">
                    <span className="font-mono text-xs font-bold text-cyan-400 block mb-1">{p.code}</span>
                    <h3 className="text-sm font-bold text-white mb-1.5">{p.title}</h3>
                    <p className="text-xs text-slate-400 line-clamp-2 mb-3">{p.description}</p>
                    <div className="flex items-center justify-between">
                      <StatusBadge status={p.status} size="sm" />
                      <div className="w-20 h-1.5 rounded-full bg-white/10">
                        <div className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-purple-500" style={{ width: `${p.progress}%` }} />
                      </div>
                    </div>
                  </GlassCard>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'attendance' && (
          <div className="glass-panel p-5 space-y-3">
            {myAttendance.length === 0 ? (
              <p className="text-center text-slate-500 text-sm py-6">No attendance records found.</p>
            ) : myAttendance.map((a) => (
              <div key={a.id} className="p-3 rounded-xl bg-slate-900/60 border border-white/5 flex flex-wrap items-center justify-between gap-2 text-xs font-mono">
                <span className="text-cyan-300 font-bold">{a.date}</span>
                <span className="text-slate-300">In: <span className="text-white font-bold">{a.checkIn}</span></span>
                <span className="text-slate-300">Out: <span className="text-white font-bold">{a.checkOut || '—'}</span></span>
                <span className="text-slate-300">Hours: <span className="text-white font-bold">{a.totalHours}h</span></span>
                <StatusBadge status={a.status} size="sm" />
              </div>
            ))}
          </div>
        )}

        {activeTab === 'prompts' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {savedPrompts.length === 0 ? (
              <div className="glass-panel p-10 text-center text-slate-500 text-sm col-span-2">No saved prompts.</div>
            ) : savedPrompts.map((sp) => (
              <GlassCard key={sp.id} glowColor="amber">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <h3 className="text-xs font-bold text-white">{sp.title}</h3>
                  <span className="text-[10px] font-mono text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20 whitespace-nowrap">{sp.category}</span>
                </div>
                <p className="text-xs text-slate-300 font-mono bg-slate-900/60 p-2.5 rounded-lg leading-relaxed">{sp.promptText}</p>
              </GlassCard>
            ))}
          </div>
        )}

        {/* ── Team Lead: My Team Tab ── */}
        {activeTab === 'my-team' && currentRole === 'Team_Lead' && (
          <div className="glass-panel p-5 space-y-4">
            <div className="flex items-center gap-2 pb-3 border-b border-white/10">
              <Users size={16} className="text-purple-400" />
              <span className="text-sm font-bold text-white">Members in My Projects</span>
            </div>
            {myTeam.length === 0 ? (
              <p className="text-sm text-slate-500 text-center py-6">No team members found in your projects.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {myTeam.map((member) => {
                  const memberTasks = tasks.filter((t) => t.assigneeId === member.id && t.status !== 'Done');
                  return (
                    <div key={member.id} className="flex items-center gap-3 p-3 rounded-xl bg-slate-900/50 border border-white/5 hover:border-purple-500/30 transition-colors">
                      <img src={member.avatar} alt={member.name} className="w-10 h-10 rounded-xl object-cover ring-1 ring-purple-400/40" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold text-white truncate">{member.name}</p>
                        <p className="text-[10px] text-slate-400 truncate">{member.title} · {member.department}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-xs font-bold text-purple-300">{memberTasks.length}</p>
                        <p className="text-[10px] text-slate-500">open tasks</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── HR: My HR Requests Tab ── */}
        {activeTab === 'hr-requests' && currentRole === 'HR' && (
          <div className="glass-panel p-5 space-y-4">
            <div className="flex items-center gap-2 pb-3 border-b border-white/10">
              <ClipboardList size={16} className="text-pink-400" />
              <span className="text-sm font-bold text-white">My HR Requests</span>
            </div>
            {myHrRequests.length === 0 ? (
              <p className="text-sm text-slate-500 text-center py-6">No HR requests found.</p>
            ) : myHrRequests.map((req) => (
              <div key={req.id} className="p-3.5 rounded-xl bg-slate-900/60 border border-white/5 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-pink-300">{req.type.replace('_', ' ')}</span>
                  <StatusBadge status={req.status} size="sm" />
                </div>
                <p className="text-xs text-slate-300">{req.reason}</p>
                <p className="text-[10px] font-mono text-slate-500">Submitted: {req.submittedAt}</p>
              </div>
            ))}
          </div>
        )}

      </div>
    </>
  );
};
