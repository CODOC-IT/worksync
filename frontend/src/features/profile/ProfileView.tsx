import React, { useState } from 'react';
import { useApp } from '../../store/AppContext';
import { StatusBadge } from '../../components/common/StatusBadge';
import { GlassCard } from '../../components/common/GlassCard';
import { User, Shield, Briefcase, Mail, CheckSquare, FolderKanban, Clock, Sparkles } from 'lucide-react';

export const ProfileView: React.FC = () => {
  const { currentUser, currentRole, tasks, projects, attendanceRecords, savedPrompts } = useApp();
  const [profileTab, setProfileTab] = useState<'tasks' | 'projects' | 'attendance' | 'prompts'>('tasks');

  const myTasks = tasks.filter((t) => t.assigneeId === currentUser.id);
  const myProjects = projects.filter((p) => p.memberIds.includes(currentUser.id));
  const myAttendance = attendanceRecords.filter((a) => a.userId === currentUser.id);

  return (
    <div className="space-y-6">
      {/* Profile Header Banner */}
      <div className="glass-panel-glow p-6 space-y-6 border-cyan-500/30">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <img
              src={currentUser.avatar}
              alt={currentUser.name}
              className="w-16 h-16 rounded-2xl object-cover ring-2 ring-cyan-400 shadow-[0_0_20px_rgba(0,242,254,0.3)]"
            />
            <div>
              <div className="flex items-center gap-2 mb-1">
                <h1 className="text-xl font-extrabold text-white">{currentUser.name}</h1>
                <StatusBadge status={currentRole.replace('_', ' ')} size="sm" />
              </div>
              <div className="flex items-center gap-4 text-xs text-slate-300 font-mono">
                <span className="flex items-center gap-1"><Mail size={12} className="text-cyan-400" /> {currentUser.email}</span>
                <span className="flex items-center gap-1"><Briefcase size={12} className="text-purple-400" /> {currentUser.department}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Profile Navigation Tabs */}
        <div className="flex items-center gap-2 border-t border-white/10 pt-4 overflow-x-auto">
          {[
            { id: 'tasks', label: `My Assigned Tasks (${myTasks.length})` },
            { id: 'projects', label: `My Projects (${myProjects.length})` },
            { id: 'attendance', label: `My Attendance Log` },
            { id: 'prompts', label: `My Saved Prompts` }
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setProfileTab(tab.id as any)}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${
                profileTab === tab.id
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-[0_0_10px_rgba(0,242,254,0.2)]'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Profile Tab Contents */}
      {profileTab === 'tasks' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {myTasks.map((t) => (
            <GlassCard key={t.id} glowColor="violet">
              <div className="flex justify-between text-xs mb-2">
                <span className="font-mono text-purple-400 font-bold">{t.taskNumber}</span>
                <StatusBadge status={t.status} size="sm" />
              </div>
              <h3 className="text-xs font-bold text-white mb-1">{t.title}</h3>
              <span className="text-[10px] font-mono text-slate-400">Due {t.dueDate}</span>
            </GlassCard>
          ))}
        </div>
      )}

      {profileTab === 'projects' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {myProjects.map((p) => (
            <GlassCard key={p.id} glowColor="cyan">
              <span className="font-mono text-xs font-bold text-cyan-400 block mb-1">{p.code}</span>
              <h3 className="text-sm font-bold text-white mb-1">{p.title}</h3>
              <p className="text-xs text-slate-400 line-clamp-2">{p.description}</p>
            </GlassCard>
          ))}
        </div>
      )}

      {profileTab === 'attendance' && (
        <div className="glass-panel p-5 space-y-3">
          {myAttendance.map((a) => (
            <div key={a.id} className="p-3 rounded-xl bg-slate-900/60 border border-white/5 flex justify-between text-xs font-mono">
              <span className="text-cyan-300 font-bold">{a.date}</span>
              <span>Clock In: {a.checkIn}</span>
              <span>Clock Out: {a.checkOut || 'In Session'}</span>
              <StatusBadge status={a.status} size="sm" />
            </div>
          ))}
        </div>
      )}

      {profileTab === 'prompts' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {savedPrompts.map((sp) => (
            <GlassCard key={sp.id} glowColor="amber">
              <h3 className="text-xs font-bold text-white mb-1">{sp.title}</h3>
              <p className="text-xs text-slate-300 font-mono bg-slate-900 p-2 rounded">{sp.promptText}</p>
            </GlassCard>
          ))}
        </div>
      )}
    </div>
  );
};
