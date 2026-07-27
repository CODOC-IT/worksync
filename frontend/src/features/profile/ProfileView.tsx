import React, { useState, useRef, useEffect } from 'react';
import { useApp } from '../../store/AppContext';
import { StatusBadge } from '../../components/common/StatusBadge';
import { GlassCard } from '../../components/common/GlassCard';
import {
  Mail, Briefcase, Shield, Camera, Save, AlertCircle,
  CheckCircle2, Calendar, Flag, Users, Trophy, Loader2,
  FolderKanban, CheckSquare, Inbox, Star
} from 'lucide-react';

const getAuthHeaders = (): Record<string, string> => {
  const token = localStorage.getItem('worksync_auth_token');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
};

const safeParseJSON = async (res: Response): Promise<Record<string, any>> => {
  const body = await res.text();
  try {
    return JSON.parse(body);
  } catch {
    return { success: false, message: `Unexpected response (${res.status})` };
  }
};

function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0].toUpperCase())
    .join('');
}

interface DeadlineItem {
  id: string;
  title: string;
  dueDate: string;
  type: 'task' | 'milestone';
  projectName: string;
  projectId: string;
  taskId?: string;
}

type ProfileTab ='tasks' | 'projects' | 'led' | 'deadlines' | 'account';

const TABS: { id: ProfileTab; label: string; icon: React.ElementType }[] = [
 
  { id: 'tasks', label: 'My Tasks', icon: CheckSquare },
  { id: 'projects', label: 'My Projects', icon: FolderKanban },
  { id: 'led', label: 'Projects Led', icon: Trophy },
  { id: 'deadlines', label: 'Upcoming Deadlines', icon: Calendar },
  { id: 'account', label: 'Account', icon: Shield },
];

export const ProfileView: React.FC = () => {
  const { currentUser, tasks, projects, updateCurrentUser } = useApp();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [activeTab, setActiveTab] = useState<ProfileTab>('tasks');

  const [nameInput, setNameInput] = useState(currentUser.name);
  const [nameLoading, setNameLoading] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [nameSuccess, setNameSuccess] = useState<string | null>(null);

  const [avatarLoading, setAvatarLoading] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [avatarSuccess, setAvatarSuccess] = useState<string | null>(null);

  useEffect(() => {
    setNameInput(currentUser.name);
  }, [currentUser.name]);

  const myTasks = tasks.filter((t) => t.assigneeId === currentUser.id);
  const myProjects = projects.filter(
    (p) => p.memberIds.includes(currentUser.id) || p.teamLeadId === currentUser.id
  );
  const projectsLed = projects.filter((p) => p.teamLeadId === currentUser.id);

  const getProjectName = (projectId: string): string => {
    const p = projects.find((proj) => proj.id === projectId);
    return p ? p.title : 'Unknown Project';
  };

  const upcomingDeadlines: DeadlineItem[] = [
    ...myTasks
      .filter((t) => t.status !== 'Done' && t.dueDate)
      .map((t) => ({
        id: `task-${t.id}`,
        title: t.title,
        dueDate: t.dueDate,
        type: 'task' as const,
        projectName: getProjectName(t.projectId),
        projectId: t.projectId,
        taskId: t.id,
      })),
    ...myProjects.flatMap((p) =>
      (p.milestones || [])
        .filter((m) => !m.completed)
        .map((m) => ({
          id: `ms-${m.id}`,
          title: m.title,
          dueDate: m.dueDate,
          type: 'milestone' as const,
          projectName: p.title,
          projectId: p.id,
        }))
    ),
  ].sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());

  const daysUntil = (dateStr: string): string => {
    const now = new Date();
    const target = new Date(dateStr);
    const diff = Math.ceil((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    if (diff < 0) return `${Math.abs(diff)}d overdue`;
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Tomorrow';
    return `${diff}d left`;
  };

  const handleDisplayNameSave = async () => {
    const sanitized = nameInput.replace(/<[^>]*>/g, '').trim();
    if (sanitized.length < 2) {
      setNameError('Display name must be at least 2 characters.');
      return;
    }
    if (sanitized.length > 100) {
      setNameError('Display name must not exceed 100 characters.');
      return;
    }
    setNameLoading(true);
    setNameError(null);
    setNameSuccess(null);

    try {
      const res = await fetch('/api/auth/profile/display-name', {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({ name: sanitized }),
      });
      const data = await safeParseJSON(res);
      if (!res.ok || !data.success) {
        console.error('[Profile] Display name update failed:', data.message || res.status);
        throw new Error('Something went wrong.');
      }
      updateCurrentUser({ name: sanitized });
      setNameSuccess('Display name updated successfully.');
    } catch (err: any) {
      setNameError(err.message === 'Something went wrong.' ? err.message : 'Couldn\'t update your display name. Please try again.');
    } finally {
      setNameLoading(false);
    }
  };

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setAvatarError('Please select a valid image file.');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setAvatarError('Image must be smaller than 2 MB.');
      return;
    }

    setAvatarLoading(true);
    setAvatarError(null);
    setAvatarSuccess(null);

    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error('Failed to read file.'));
        reader.readAsDataURL(file);
      });

      const res = await fetch('/api/auth/profile/avatar', {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({ avatar: base64 }),
      });
      const data = await safeParseJSON(res);
      if (!res.ok || !data.success) {
        console.error('[Profile] Avatar update failed:', data.message || res.status);
        throw new Error('Something went wrong.');
      }
      updateCurrentUser({ avatar: base64 });
      setAvatarSuccess('Profile picture updated successfully.');
    } catch (err: any) {
      setAvatarError(err.message === 'Something went wrong.' ? err.message : 'Couldn\'t update your profile picture. Please try again.');
    } finally {
      setAvatarLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  /* ───────── Avatar Component ───────── */
  const AvatarImage = ({ size = 'lg' }: { size?: 'lg' | 'md' }) => {
    const dimensions = size === 'lg' ? 'w-28 h-28' : 'w-20 h-20';
    const initials = getInitials(currentUser.name);
    const containerClass = `${dimensions} rounded-full overflow-hidden ring-2 ring-cyan-400/60 shadow-[0_0_24px_rgba(0,242,254,0.2)] shrink-0`;

    const hasAvatar = currentUser.avatar && !currentUser.avatar.includes('unsplash');
    if (hasAvatar) {
      return (
        <div className={containerClass}>
          <img
            src={currentUser.avatar}
            alt={currentUser.name}
            className="w-full h-full object-cover"
          />
        </div>
      );
    }
    return (
      <div className={`${containerClass} bg-gradient-to-br from-cyan-600/40 to-purple-600/40 flex items-center justify-center`}>
        <span className="text-2xl font-bold text-white/80 select-none" style={size === 'md' ? { fontSize: '1.1rem' } : undefined}>
          {initials || '?'}
        </span>
      </div>
    );
  };

  /* ───────── Empty State ───────── */
  const EmptyState = ({ icon: Icon, title, message }: { icon: React.ElementType; title: string; message: string }) => (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="p-4 rounded-full bg-slate-800/60 mb-4">
        <Icon size={28} className="text-slate-500" />
      </div>
      <p className="text-sm font-semibold text-slate-300 mb-1">{title}</p>
      <p className="text-xs text-slate-500 max-w-xs">{message}</p>
    </div>
  );

  /* ───────── Section Header ───────── */
  const SectionHeader = ({ icon: Icon, label, count }: { icon: React.ElementType; label: string; count?: number }) => (
    <div className="flex items-center gap-2.5 mb-5">
      <div className="p-2 rounded-lg bg-slate-800/80">
        <Icon size={16} className="text-cyan-400" />
      </div>
      <h2 className="text-sm font-bold text-white">
        {label}{count !== undefined ? ` (${count})` : ''}
      </h2>
    </div>
  );

  /* ───────── Tab Navigation ───────── */
  const renderTabNav = () => (
    <div className="flex items-center gap-2 overflow-x-auto pb-1">
      {TABS.map((tab) => {
        const Icon = tab.icon;
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all duration-200 shrink-0 ${
              isActive
                ? 'bg-cyan-500/15 text-cyan-300 shadow-[inset_0_0_0_1px_rgba(0,242,254,0.25)]'
                : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.04]'
            }`}
          >
            <Icon size={15} className={isActive ? 'text-cyan-300' : 'text-slate-400'} />
            {tab.label}
          </button>
        );
      })}
    </div>
  );

  /* ───────── My Tasks Tab ───────── */
  const renderMyTasks = () => (
    <div>
      <SectionHeader icon={CheckSquare} label="My Tasks" count={myTasks.length} />
      {myTasks.length === 0 ? (
        <EmptyState icon={Inbox} title="No assigned tasks yet" message="Tasks assigned to you will appear here." />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {myTasks.map((t) => (
            <GlassCard key={t.id} glowColor="violet">
              <div className="flex items-start justify-between gap-2 mb-2.5">
                <span className="font-mono text-[11px] text-purple-400 font-bold shrink-0">{t.taskNumber}</span>
                <StatusBadge status={t.status} size="sm" />
              </div>
              <h3 className="text-sm font-bold text-white mb-2 leading-snug">{t.title}</h3>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] font-mono text-slate-400">
                <span className="flex items-center gap-1.5">
                  <Flag size={12} className="text-fuchsia-400" />
                  {t.priority}
                </span>
                <span className="flex items-center gap-1.5">
                  <Calendar size={12} className="text-slate-500" />
                  {t.dueDate}
                </span>
              </div>
              <div className="mt-2.5 pt-2.5 border-t border-white/5">
                <span className="text-[11px] font-mono text-cyan-400">{getProjectName(t.projectId)}</span>
              </div>
            </GlassCard>
          ))}
        </div>
      )}
    </div>
  );

  /* ───────── My Projects Tab ───────── */
  const renderMyProjects = () => (
    <div>
      <SectionHeader icon={FolderKanban} label="My Projects" count={myProjects.length} />
      {myProjects.length === 0 ? (
        <EmptyState icon={FolderKanban} title="No projects yet" message="Projects you belong to will appear here." />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {myProjects.map((p) => (
            <GlassCard key={p.id} glowColor="cyan">
              <div className="flex items-start justify-between gap-2 mb-2.5">
                <span className="font-mono text-[11px] text-cyan-400 font-bold shrink-0">{p.code}</span>
                <StatusBadge status={p.status} size="sm" />
              </div>
              <h3 className="text-sm font-bold text-white mb-1.5">{p.title}</h3>
              <p className="text-[11px] text-slate-400 line-clamp-2 mb-3 leading-relaxed">{p.description}</p>
              <div className="flex items-center gap-2 text-[11px] font-mono text-slate-500 flex-wrap pt-2.5 border-t border-white/5">
                <span>{p.startDate} → {p.targetDate}</span>
                {p.teamLeadId === currentUser.id && (
                  <span className="text-amber-400 flex items-center gap-1">
                    <Trophy size={11} /> Lead
                  </span>
                )}
              </div>
            </GlassCard>
          ))}
        </div>
      )}
    </div>
  );

  /* ───────── Projects Led Tab ───────── */
  const renderProjectsLed = () => (
    <div>
      <SectionHeader icon={Trophy} label="Projects Led" count={projectsLed.length} />
      {projectsLed.length === 0 ? (
        <EmptyState icon={Star} title="Not leading any projects" message="Projects where you are the team lead will appear here." />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {projectsLed.map((p) => (
            <GlassCard key={p.id} glowColor="amber">
              <div className="flex items-start justify-between gap-2 mb-2.5">
                <span className="font-mono text-[11px] text-amber-400 font-bold shrink-0">{p.code}</span>
                <StatusBadge status={p.status} size="sm" />
              </div>
              <h3 className="text-sm font-bold text-white mb-1.5">{p.title}</h3>
              <p className="text-[11px] text-slate-400 line-clamp-2 mb-3 leading-relaxed">{p.description}</p>
              <div className="flex items-center gap-2 text-[11px] font-mono text-slate-500 flex-wrap pt-2.5 border-t border-white/5">
                <Users size={12} className="text-cyan-400 shrink-0" />
                <span>{p.memberIds.length} member{p.memberIds.length !== 1 ? 's' : ''}</span>
                <span className="text-slate-600">|</span>
                <span>{p.startDate} → {p.targetDate}</span>
              </div>
            </GlassCard>
          ))}
        </div>
      )}
    </div>
  );

  /* ───────── Upcoming Deadlines Tab ───────── */
  const renderUpcomingDeadlines = () => (
    <div>
      <SectionHeader icon={Calendar} label="Upcoming Deadlines" count={upcomingDeadlines.length} />
      {upcomingDeadlines.length === 0 ? (
        <EmptyState icon={Calendar} title="No upcoming deadlines" message="Deadlines from your tasks and projects will appear here." />
      ) : (
        <div className="space-y-2.5">
          {upcomingDeadlines.map((dl) => {
            const dayLabel = daysUntil(dl.dueDate);
            const isOverdue = dayLabel.includes('overdue');
            return (
              <div
                key={dl.id}
                className={`p-4 rounded-xl bg-slate-800/40 border flex items-start justify-between gap-4 ${
                  isOverdue ? 'border-rose-500/25' : 'border-white/5'
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2.5 mb-1">
                    <span className={`text-[11px] font-mono font-bold px-2 py-0.5 rounded-full ${
                      isOverdue
                        ? 'bg-rose-500/15 text-rose-400'
                        : 'bg-fuchsia-500/15 text-fuchsia-400'
                    }`}>
                      {dl.type === 'task' ? 'Task' : 'Milestone'}
                    </span>
                    <span className="text-[11px] font-mono text-cyan-400 truncate">{dl.projectName}</span>
                  </div>
                  <h3 className="text-sm font-bold text-white truncate">{dl.title}</h3>
                </div>
                <span className={`text-[11px] font-mono shrink-0 font-bold mt-1 ${
                  isOverdue ? 'text-rose-400' : dayLabel === 'Today' ? 'text-amber-400' : 'text-emerald-400'
                }`}>
                  {dl.dueDate}
                  <span className="block text-right">{dayLabel}</span>
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  /* ───────── Account Tab ───────── */
  const renderAccount = () => (
    <div className="max-w-lg space-y-8">
      {/* Change Display Name */}
      <div className="glass-panel p-6 border border-white/5">
        <h3 className="text-sm font-bold text-white mb-1">Change Display Name</h3>
        <p className="text-[11px] text-slate-500 mb-4">Update the name shown on your profile.</p>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={nameInput}
            onChange={(e) => {
              setNameInput(e.target.value);
              setNameError(null);
              setNameSuccess(null);
            }}
            className="flex-1 bg-slate-900/80 border border-white/10 rounded-lg px-3.5 py-2 text-sm text-white outline-none focus:border-cyan-500/50 transition-colors"
            placeholder="Enter new display name"
          />
        </div>
        <div className="mt-3 flex items-center gap-3">
          <button
            onClick={handleDisplayNameSave}
            disabled={nameLoading || !nameInput.trim()}
            className="px-4 py-2 rounded-lg glass-button-neon text-xs font-semibold flex items-center gap-1.5 disabled:opacity-40 transition-all"
          >
            {nameLoading ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
            Save Changes
          </button>
          {nameSuccess && (
            <span className="text-[11px] text-emerald-400 flex items-center gap-1">
              <CheckCircle2 size={12} /> {nameSuccess}
            </span>
          )}
        </div>
        {nameError && (
          <p className="text-[11px] text-rose-400 mt-2 flex items-center gap-1">
            <AlertCircle size={12} /> {nameError}
          </p>
        )}
      </div>

      {/* Divider */}
      <div className="border-t border-white/5" />

      {/* Profile Picture */}
      <div className="glass-panel p-6 border border-white/5">
        <h3 className="text-sm font-bold text-white mb-1">Profile Picture</h3>
        <p className="text-[11px] text-slate-500 mb-5">Upload a photo to personalise your profile.</p>
        <div className="flex items-center gap-5">
          <div
            className="relative cursor-pointer group"
            onClick={() => { if (!avatarLoading) fileInputRef.current?.click(); }}
          >
            <AvatarImage size="md" />
            <div className="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
              <Camera size={20} className="text-white" />
            </div>
            {avatarLoading && (
              <div className="absolute inset-0 rounded-full bg-black/60 flex items-center justify-center">
                <Loader2 size={22} className="text-cyan-400 animate-spin" />
              </div>
            )}
          </div>
          <div>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={avatarLoading}
              className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-white/10 text-xs font-semibold flex items-center gap-1.5 disabled:opacity-40 transition-all"
            >
              {avatarLoading ? <Loader2 size={13} className="animate-spin" /> : <Camera size={13} />}
              {avatarLoading ? 'Uploading...' : 'Upload New Picture'}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleAvatarChange}
            />
            {avatarSuccess && (
              <p className="text-[11px] text-emerald-400 mt-2 flex items-center gap-1">
                <CheckCircle2 size={12} /> {avatarSuccess}
              </p>
            )}
            {avatarError && (
              <p className="text-[11px] text-rose-400 mt-2 flex items-center gap-1">
                <AlertCircle size={12} /> {avatarError}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  /* ───────── Render ───────── */
  const renderTabContent = () => {
    switch (activeTab) {
      case 'tasks': return renderMyTasks();
      case 'projects': return renderMyProjects();
      case 'led': return renderProjectsLed();
      case 'deadlines': return renderUpcomingDeadlines();
      case 'account': return renderAccount();
      default: return null;
    }
  };

  return (
    <div className="space-y-8">
      {/* Hero Section */}
      <div className="glass-panel-glow p-6 sm:p-8 border-cyan-500/30">
        <div className="flex flex-col sm:flex-row items-center gap-6 sm:gap-8">
          <AvatarImage size="lg" />
          <div className="min-w-0 text-center sm:text-left">
            <div className="flex items-center justify-center sm:justify-start gap-2.5 mb-2 flex-wrap">
              <h1 className="text-2xl font-extrabold text-white">{currentUser.name}</h1>
              <StatusBadge status={currentUser.role.replace('_', ' ')} size="sm" />
            </div>
            <div className="flex flex-col sm:flex-row items-center sm:items-center gap-x-5 gap-y-1 text-sm text-slate-400 font-mono mt-1">
              <span className="flex items-center gap-1.5">
                <Mail size={14} className="text-cyan-400 shrink-0" />
                {currentUser.email}
              </span>
              <span className="hidden sm:inline text-slate-600">|</span>
              <span className="flex items-center gap-1.5">
                <Briefcase size={14} className="text-purple-400 shrink-0" />
                {currentUser.department}
              </span>
              {currentUser.title && (
                <>
                  <span className="hidden sm:inline text-slate-600">|</span>
                  <span className="flex items-center gap-1.5">
                    <Shield size={14} className="text-amber-400 shrink-0" />
                    {currentUser.title}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Tabs & Content */}
      <div className="glass-panel p-4 sm:p-5 border border-white/5 space-y-5">
        {renderTabNav()}
        <div className="border-t border-white/5" />
        {renderTabContent()}
      </div>
    </div>
  );
};
