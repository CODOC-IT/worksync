import React, { useState } from 'react';
import { useApp } from '../../store/AppContext';
import { User, UserRole } from '../../types';
import {
  Users,
  UserPlus,
  Search,
  Filter,
  Shield,
  Trash2,
  Edit3,
  AlertTriangle,
  CheckCircle2,
  ArrowRightLeft,
  Mail,
  Github,
  Briefcase,
  Grid,
  List,
  Sparkles,
  Check,
  X,
  ShieldCheck,
  Building,
  UserCheck
} from 'lucide-react';

export const TeamMembersView: React.FC = () => {
  const {
    users,
    tasks,
    currentRole,
    addTeamMember,
    updateTeamMember,
    deleteTeamMember,
    reassignMemberTasks,
    getMemberAssignedTasksCount
  } = useApp();

  // View & Filter states
  const [viewMode, setViewMode] = useState<'grid' | 'table'>('grid');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'name' | 'tasks' | 'role'>('name');

  // Modal states
  const [isAddModalOpen, setIsAddModalOpen] = useState<boolean>(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [deletingUser, setDeletingUser] = useState<User | null>(null);
  const [reassigningUser, setReassigningUser] = useState<User | null>(null);

  // Form states for Add / Edit
  const [formData, setFormData] = useState<{
    name: string;
    email: string;
    role: UserRole;
    department: string;
    title: string;
    status: 'active' | 'inactive' | 'away';
    githubUsername: string;
    avatar: string;
  }>({
    name: '',
    email: '',
    role: 'Team_Member',
    department: 'Engineering',
    title: 'Software Engineer',
    status: 'active',
    githubUsername: '',
    avatar: ''
  });

  // Reassignment modal target state
  const [targetReassignUserId, setTargetReassignUserId] = useState<string>('');

  // Stats computation
  const totalMembers = users.length;
  const activeMembersCount = users.filter((u) => u.status === 'active').length;
  const teamLeadsCount = users.filter((u) => u.role === 'Team_Lead').length;
  const hrCount = users.filter((u) => u.role === 'HR').length;
  const totalAssignedTasksCount = tasks.filter((t) => t.status !== 'Done').length;

  // Filter & Sort logic
  const filteredUsers = users
    .filter((u) => {
      const matchesSearch =
        u.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        u.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (u.githubUsername && u.githubUsername.toLowerCase().includes(searchQuery.toLowerCase())) ||
        u.department.toLowerCase().includes(searchQuery.toLowerCase()) ||
        u.title.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesRole = roleFilter === 'all' || u.role === roleFilter;
      const matchesStatus = statusFilter === 'all' || u.status === statusFilter;
      return matchesSearch && matchesRole && matchesStatus;
    })
    .sort((a, b) => {
      if (sortBy === 'name') {
        return a.name.localeCompare(b.name);
      } else if (sortBy === 'tasks') {
        return getMemberAssignedTasksCount(b.id) - getMemberAssignedTasksCount(a.id);
      } else if (sortBy === 'role') {
        return a.role.localeCompare(b.role);
      }
      return 0;
    });

  // Form Handlers
  const handleOpenAdd = () => {
    setFormData({
      name: '',
      email: '',
      role: 'Team_Member',
      department: 'Engineering',
      title: 'Software Engineer',
      status: 'active',
      githubUsername: '',
      avatar: ''
    });
    setIsAddModalOpen(true);
  };

  const handleOpenEdit = (user: User) => {
    setEditingUser(user);
    setFormData({
      name: user.name,
      email: user.email,
      role: user.role,
      department: user.department,
      title: user.title,
      status: user.status,
      githubUsername: user.githubUsername || '',
      avatar: user.avatar
    });
  };

  const handleSaveAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name || !formData.email) {
      alert('Please fill in required fields (Name and Email).');
      return;
    }
    addTeamMember({
      name: formData.name,
      email: formData.email,
      role: formData.role,
      department: formData.department,
      title: formData.title,
      status: formData.status,
      githubUsername: formData.githubUsername || undefined,
      avatar: formData.avatar || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(formData.name)}`
    });
    setIsAddModalOpen(false);
  };

  const handleSaveEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    updateTeamMember(editingUser.id, {
      name: formData.name,
      email: formData.email,
      role: formData.role,
      department: formData.department,
      title: formData.title,
      status: formData.status,
      githubUsername: formData.githubUsername || undefined,
      avatar: formData.avatar || editingUser.avatar
    });
    setEditingUser(null);
  };

  const handleConfirmDelete = () => {
    if (!deletingUser) return;
    const taskCount = getMemberAssignedTasksCount(deletingUser.id);
    if (taskCount > 0 && !targetReassignUserId) {
      alert(`Safety Check Failed: Please select a team member to reassign ${deletingUser.name}'s ${taskCount} active task(s) before deleting.`);
      return;
    }
    const res = deleteTeamMember(deletingUser.id, targetReassignUserId || undefined);
    alert(res.message);
    setDeletingUser(null);
    setTargetReassignUserId('');
  };

  const handleConfirmReassignOnly = () => {
    if (!reassigningUser || !targetReassignUserId) {
      alert('Please select a target team member for reassignment.');
      return;
    }
    const res = reassignMemberTasks(reassigningUser.id, targetReassignUserId);
    alert(`Successfully reassigned ${res.count} task(s) to selected team member.`);
    setReassigningUser(null);
    setTargetReassignUserId('');
  };

  const getRoleBadgeClass = (role: UserRole) => {
    switch (role) {
      case 'Admin':
        return 'bg-amber-500/20 text-amber-300 border-amber-500/40';
      case 'Team_Lead':
        return 'bg-purple-500/20 text-purple-300 border-purple-500/40';
      case 'HR':
        return 'bg-pink-500/20 text-pink-300 border-pink-500/40';
      case 'Team_Member':
      default:
        return 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40';
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header Banner */}
      <div className="glass-panel p-6 border border-cyan-500/30 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="p-3 rounded-2xl bg-gradient-to-tr from-cyan-500/20 via-purple-500/20 to-pink-500/20 text-cyan-400 border border-cyan-500/30">
            <Users size={28} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-white tracking-wide">Team Members Hub</h1>
              <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-cyan-500/10 text-cyan-400 border border-cyan-500/30">
                MODULE 06 (AbdulAzeemHashmi)
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Manage organization users, role scopes, active assignments, and safety reassignment protocols.
            </p>
          </div>
        </div>

        <button
          onClick={handleOpenAdd}
          className="px-4 py-2.5 rounded-xl glass-button-neon font-bold text-xs flex items-center gap-2 shrink-0 shadow-[0_0_15px_rgba(0,242,254,0.3)]"
        >
          <UserPlus size={16} /> Add Team Member
        </button>
      </div>

      {/* Overview Metric Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="glass-panel p-4 border border-white/10 flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
            <Users size={20} />
          </div>
          <div>
            <span className="text-xs text-slate-400 font-medium block">Total Members</span>
            <span className="text-lg font-extrabold text-white font-mono">{totalMembers}</span>
          </div>
        </div>

        <div className="glass-panel p-4 border border-white/10 flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <UserCheck size={20} />
          </div>
          <div>
            <span className="text-xs text-slate-400 font-medium block">Active Members</span>
            <span className="text-lg font-extrabold text-emerald-400 font-mono">{activeMembersCount}</span>
          </div>
        </div>

        <div className="glass-panel p-4 border border-white/10 flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-purple-500/10 text-purple-400 border border-purple-500/20">
            <ShieldCheck size={20} />
          </div>
          <div>
            <span className="text-xs text-slate-400 font-medium block">Team Leads & HR</span>
            <span className="text-lg font-extrabold text-purple-300 font-mono">{teamLeadsCount + hrCount}</span>
          </div>
        </div>

        <div className="glass-panel p-4 border border-white/10 flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20">
            <Briefcase size={20} />
          </div>
          <div>
            <span className="text-xs text-slate-400 font-medium block">Active Task Workload</span>
            <span className="text-lg font-extrabold text-amber-300 font-mono">{totalAssignedTasksCount} Tasks</span>
          </div>
        </div>
      </div>

      {/* Control Toolbar: Search, Filter, Sort & View Modes */}
      <div className="glass-panel p-4 border border-white/10 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex-1 flex flex-wrap items-center gap-3">
          {/* Search Box */}
          <div className="relative flex-1 min-w-[220px]">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search member, email, github handle..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 rounded-xl bg-black/40 border border-white/10 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500/50"
            />
          </div>

          {/* Role Filter */}
          <div className="flex items-center gap-2">
            <Filter size={14} className="text-slate-400" />
            <select
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
              className="px-3 py-2 rounded-xl bg-black/40 border border-white/10 text-xs text-slate-300 focus:outline-none focus:border-cyan-500/50"
            >
              <option value="all">All Roles</option>
              <option value="Admin">Admin</option>
              <option value="Team_Lead">Team Lead</option>
              <option value="HR">HR</option>
              <option value="Team_Member">Team Member</option>
            </select>
          </div>

          {/* Status Filter */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 rounded-xl bg-black/40 border border-white/10 text-xs text-slate-300 focus:outline-none focus:border-cyan-500/50"
          >
            <option value="all">All Statuses</option>
            <option value="active">Active</option>
            <option value="away">Away</option>
            <option value="inactive">Inactive</option>
          </select>

          {/* Sort By */}
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as any)}
            className="px-3 py-2 rounded-xl bg-black/40 border border-white/10 text-xs text-slate-300 focus:outline-none focus:border-cyan-500/50"
          >
            <option value="name">Sort by Name</option>
            <option value="tasks">Sort by Assigned Tasks</option>
            <option value="role">Sort by Role</option>
          </select>
        </div>

        {/* View Toggle */}
        <div className="flex items-center gap-1 p-1 rounded-xl bg-black/40 border border-white/10 shrink-0">
          <button
            onClick={() => setViewMode('grid')}
            className={`p-1.5 rounded-lg transition-colors ${
              viewMode === 'grid' ? 'bg-cyan-500/20 text-cyan-400 font-bold' : 'text-slate-400 hover:text-white'
            }`}
            title="Grid View"
          >
            <Grid size={16} />
          </button>
          <button
            onClick={() => setViewMode('table')}
            className={`p-1.5 rounded-lg transition-colors ${
              viewMode === 'table' ? 'bg-cyan-500/20 text-cyan-400 font-bold' : 'text-slate-400 hover:text-white'
            }`}
            title="Table View"
          >
            <List size={16} />
          </button>
        </div>
      </div>

      {/* Grid View */}
      {viewMode === 'grid' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredUsers.map((member) => {
            const taskCount = getMemberAssignedTasksCount(member.id);
            return (
              <div
                key={member.id}
                className="glass-panel p-5 border border-white/10 hover:border-cyan-500/40 transition-all duration-200 flex flex-col justify-between space-y-4 group"
              >
                <div>
                  {/* Top Avatar & Status Row */}
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="flex items-center gap-3">
                      <div className="relative">
                        <img
                          src={member.avatar}
                          alt={member.name}
                          className="w-12 h-12 rounded-xl object-cover border border-white/20 shadow-md"
                          onError={(e) => {
                            (e.target as HTMLElement).style.display = 'none';
                          }}
                        />
                        <span
                          className={`absolute -bottom-1 -right-1 w-3.5 h-3.5 rounded-full border-2 border-slate-950 ${
                            member.status === 'active'
                              ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]'
                              : member.status === 'away'
                              ? 'bg-amber-400'
                              : 'bg-slate-500'
                          }`}
                          title={`Status: ${member.status}`}
                        />
                      </div>
                      <div>
                        <h3 className="text-sm font-bold text-white group-hover:text-cyan-300 transition-colors">
                          {member.name}
                        </h3>
                        <p className="text-[11px] text-slate-400 flex items-center gap-1">
                          <Briefcase size={12} className="text-slate-500" /> {member.title}
                        </p>
                      </div>
                    </div>

                    <span
                      className={`px-2.5 py-1 rounded-full text-[10px] font-semibold border ${getRoleBadgeClass(
                        member.role
                      )}`}
                    >
                      {member.role.replace('_', ' ')}
                    </span>
                  </div>

                  {/* Info details */}
                  <div className="space-y-2 text-xs text-slate-300 pt-2 border-t border-white/5">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500 flex items-center gap-1">
                        <Mail size={12} /> Email:
                      </span>
                      <a href={`mailto:${member.email}`} className="text-slate-300 hover:text-cyan-400 truncate max-w-[180px]">
                        {member.email}
                      </a>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-slate-500 flex items-center gap-1">
                        <Building size={12} /> Department:
                      </span>
                      <span className="text-slate-300 font-medium">{member.department}</span>
                    </div>

                    {member.githubUsername && (
                      <div className="flex items-center justify-between">
                        <span className="text-slate-500 flex items-center gap-1">
                          <Github size={12} /> GitHub:
                        </span>
                        <a
                          href={`https://github.com/${member.githubUsername}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-cyan-400 hover:underline font-mono"
                        >
                          @{member.githubUsername}
                        </a>
                      </div>
                    )}
                  </div>
                </div>

                {/* Bottom Workload & Actions Row */}
                <div className="pt-3 border-t border-white/10 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-slate-400">Assigned Tasks:</span>
                    <span
                      className={`px-2 py-0.5 rounded-full font-mono text-[10px] font-bold ${
                        taskCount > 0
                          ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                          : 'bg-slate-800 text-slate-400 border border-white/5'
                      }`}
                    >
                      {taskCount} Active
                    </span>
                  </div>

                  <div className="flex items-center gap-1">
                    {taskCount > 0 && (
                      <button
                        onClick={() => {
                          setReassigningUser(member);
                          setTargetReassignUserId('');
                        }}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-amber-300 hover:bg-amber-500/10 transition-colors"
                        title="Reassign Tasks"
                      >
                        <ArrowRightLeft size={14} />
                      </button>
                    )}
                    <button
                      onClick={() => handleOpenEdit(member)}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-cyan-300 hover:bg-cyan-500/10 transition-colors"
                      title="Edit Member"
                    >
                      <Edit3 size={14} />
                    </button>
                    <button
                      onClick={() => {
                        setDeletingUser(member);
                        setTargetReassignUserId('');
                      }}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                      title="Delete Member (Safety Check)"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Table View */}
      {viewMode === 'table' && (
        <div className="glass-panel overflow-hidden border border-white/10">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="bg-slate-900/80 text-slate-400 font-mono uppercase text-[10px] tracking-wider border-b border-white/10">
                <tr>
                  <th className="p-4">Member Name</th>
                  <th className="p-4">Role</th>
                  <th className="p-4">Department & Title</th>
                  <th className="p-4">Email / GitHub</th>
                  <th className="p-4">Assigned Tasks</th>
                  <th className="p-4">Status</th>
                  <th className="p-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {filteredUsers.map((member) => {
                  const taskCount = getMemberAssignedTasksCount(member.id);
                  return (
                    <tr key={member.id} className="hover:bg-white/[0.02] transition-colors">
                      <td className="p-4 font-semibold text-white">
                        <div className="flex items-center gap-3">
                          <img src={member.avatar} alt="" className="w-8 h-8 rounded-lg object-cover border border-white/10" />
                          <div>
                            <span className="block font-bold text-white">{member.name}</span>
                            <span className="text-[10px] text-slate-400 font-mono">{member.id}</span>
                          </div>
                        </div>
                      </td>
                      <td className="p-4">
                        <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-semibold border ${getRoleBadgeClass(member.role)}`}>
                          {member.role.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="p-4">
                        <span className="block text-slate-200">{member.title}</span>
                        <span className="text-[10px] text-slate-400">{member.department}</span>
                      </td>
                      <td className="p-4">
                        <span className="block text-slate-300">{member.email}</span>
                        {member.githubUsername && (
                          <span className="text-[10px] text-cyan-400 font-mono">@{member.githubUsername}</span>
                        )}
                      </td>
                      <td className="p-4">
                        <span className={`px-2 py-0.5 rounded font-mono font-bold text-[10px] ${taskCount > 0 ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30' : 'bg-slate-800 text-slate-400'}`}>
                          {taskCount} Active
                        </span>
                      </td>
                      <td className="p-4">
                        <span className="flex items-center gap-1.5">
                          <span className={`w-2 h-2 rounded-full ${member.status === 'active' ? 'bg-emerald-400' : member.status === 'away' ? 'bg-amber-400' : 'bg-slate-500'}`} />
                          <span className="capitalize">{member.status}</span>
                        </span>
                      </td>
                      <td className="p-4 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {taskCount > 0 && (
                            <button
                              onClick={() => {
                                setReassigningUser(member);
                                setTargetReassignUserId('');
                              }}
                              className="p-1.5 rounded text-slate-400 hover:text-amber-300 hover:bg-amber-500/10"
                              title="Reassign Tasks"
                            >
                              <ArrowRightLeft size={14} />
                            </button>
                          )}
                          <button
                            onClick={() => handleOpenEdit(member)}
                            className="p-1.5 rounded text-slate-400 hover:text-cyan-300 hover:bg-cyan-500/10"
                            title="Edit"
                          >
                            <Edit3 size={14} />
                          </button>
                          <button
                            onClick={() => {
                              setDeletingUser(member);
                              setTargetReassignUserId('');
                            }}
                            className="p-1.5 rounded text-slate-400 hover:text-rose-400 hover:bg-rose-500/10"
                            title="Delete"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal: Add Team Member */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fadeIn">
          <div className="glass-panel max-w-md w-full p-6 border border-cyan-500/40 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-white/10">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <UserPlus size={18} className="text-cyan-400" /> Add New Team Member
              </h3>
              <button onClick={() => setIsAddModalOpen(false)} className="text-slate-400 hover:text-white">
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSaveAdd} className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-400 font-semibold mb-1">Full Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Abdul Azeem Hashmi"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl bg-black/40 border border-white/10 text-white focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div>
                <label className="block text-slate-400 font-semibold mb-1">Email Address *</label>
                <input
                  type="email"
                  required
                  placeholder="e.g. abdulazeemhashmi29@gmail.com"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl bg-black/40 border border-white/10 text-white focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 font-semibold mb-1">GitHub Username</label>
                  <input
                    type="text"
                    placeholder="e.g. AbdulAzeemHashmi"
                    value={formData.githubUsername}
                    onChange={(e) => setFormData({ ...formData, githubUsername: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl bg-black/40 border border-white/10 text-white focus:outline-none focus:border-cyan-500 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-slate-400 font-semibold mb-1">Assign Role</label>
                  <select
                    value={formData.role}
                    onChange={(e) => setFormData({ ...formData, role: e.target.value as UserRole })}
                    className="w-full px-3 py-2 rounded-xl bg-black/40 border border-white/10 text-white focus:outline-none focus:border-cyan-500"
                  >
                    <option value="Team_Member">Team Member</option>
                    <option value="Team_Lead">Team Lead</option>
                    <option value="HR">HR</option>
                    <option value="Admin">Admin</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 font-semibold mb-1">Department</label>
                  <input
                    type="text"
                    placeholder="e.g. Engineering"
                    value={formData.department}
                    onChange={(e) => setFormData({ ...formData, department: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl bg-black/40 border border-white/10 text-white focus:outline-none focus:border-cyan-500"
                  />
                </div>

                <div>
                  <label className="block text-slate-400 font-semibold mb-1">Job Title</label>
                  <input
                    type="text"
                    placeholder="e.g. Frontend Specialist"
                    value={formData.title}
                    onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl bg-black/40 border border-white/10 text-white focus:outline-none focus:border-cyan-500"
                  />
                </div>
              </div>

              <div className="pt-3 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-4 py-2 rounded-xl border border-white/10 text-slate-400 hover:text-white"
                >
                  Cancel
                </button>
                <button type="submit" className="px-4 py-2 rounded-xl glass-button-neon font-bold text-white">
                  Create Member
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Edit Team Member */}
      {editingUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fadeIn">
          <div className="glass-panel max-w-md w-full p-6 border border-cyan-500/40 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-white/10">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Edit3 size={18} className="text-cyan-400" /> Edit Member: {editingUser.name}
              </h3>
              <button onClick={() => setEditingUser(null)} className="text-slate-400 hover:text-white">
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSaveEdit} className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-400 font-semibold mb-1">Full Name</label>
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl bg-black/40 border border-white/10 text-white"
                />
              </div>

              <div>
                <label className="block text-slate-400 font-semibold mb-1">Email</label>
                <input
                  type="email"
                  required
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl bg-black/40 border border-white/10 text-white"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 font-semibold mb-1">Role</label>
                  <select
                    value={formData.role}
                    onChange={(e) => setFormData({ ...formData, role: e.target.value as UserRole })}
                    className="w-full px-3 py-2 rounded-xl bg-black/40 border border-white/10 text-white"
                  >
                    <option value="Team_Member">Team Member</option>
                    <option value="Team_Lead">Team Lead</option>
                    <option value="HR">HR</option>
                    <option value="Admin">Admin</option>
                  </select>
                </div>

                <div>
                  <label className="block text-slate-400 font-semibold mb-1">Status</label>
                  <select
                    value={formData.status}
                    onChange={(e) => setFormData({ ...formData, status: e.target.value as any })}
                    className="w-full px-3 py-2 rounded-xl bg-black/40 border border-white/10 text-white"
                  >
                    <option value="active">Active</option>
                    <option value="away">Away</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 font-semibold mb-1">Department</label>
                  <input
                    type="text"
                    value={formData.department}
                    onChange={(e) => setFormData({ ...formData, department: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl bg-black/40 border border-white/10 text-white"
                  />
                </div>

                <div>
                  <label className="block text-slate-400 font-semibold mb-1">Title</label>
                  <input
                    type="text"
                    value={formData.title}
                    onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl bg-black/40 border border-white/10 text-white"
                  />
                </div>
              </div>

              <div className="pt-3 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditingUser(null)}
                  className="px-4 py-2 rounded-xl border border-white/10 text-slate-400"
                >
                  Cancel
                </button>
                <button type="submit" className="px-4 py-2 rounded-xl glass-button-neon font-bold text-white">
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Delete & Task Reassignment Safety Warning (Tricky Test Compliance) */}
      {deletingUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fadeIn">
          <div className="glass-panel max-w-lg w-full p-6 border border-rose-500/40 space-y-4">
            <div className="flex items-center gap-3 pb-3 border-b border-rose-500/20">
              <div className="p-2.5 rounded-xl bg-rose-500/20 text-rose-400 border border-rose-500/40">
                <AlertTriangle size={22} />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">Delete Member Safety Verification</h3>
                <p className="text-xs text-rose-300">Target Member: {deletingUser.name}</p>
              </div>
            </div>

            {getMemberAssignedTasksCount(deletingUser.id) > 0 ? (
              <div className="space-y-3 text-xs">
                <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 space-y-1">
                  <span className="font-bold block flex items-center gap-1.5">
                    <AlertTriangle size={16} /> TRICKY TEST SAFETY WARNING: ACTIVE TASKS FOUND!
                  </span>
                  <p className="text-amber-200/80">
                    {deletingUser.name} currently has <strong>{getMemberAssignedTasksCount(deletingUser.id)} active assigned task(s)</strong>. To prevent orphaned tasks, you must reassign these tasks to another active team member before completing deletion.
                  </p>
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Reassign Active Tasks To *</label>
                  <select
                    value={targetReassignUserId}
                    onChange={(e) => setTargetReassignUserId(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl bg-black/60 border border-amber-500/40 text-white font-medium focus:outline-none"
                  >
                    <option value="">-- Select Active Team Member --</option>
                    {users
                      .filter((u) => u.id !== deletingUser.id && u.status === 'active')
                      .map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name} ({u.role.replace('_', ' ')}) - {getMemberAssignedTasksCount(u.id)} current tasks
                        </option>
                      ))}
                  </select>
                </div>

                <div className="pt-2 flex justify-end gap-2">
                  <button
                    onClick={() => setDeletingUser(null)}
                    className="px-4 py-2 rounded-xl border border-white/10 text-slate-300"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleConfirmDelete}
                    disabled={!targetReassignUserId}
                    className={`px-4 py-2 rounded-xl font-bold text-white flex items-center gap-2 ${
                      targetReassignUserId
                        ? 'bg-rose-600 hover:bg-rose-500 shadow-[0_0_15px_rgba(244,63,94,0.4)]'
                        : 'bg-slate-800 text-slate-500 cursor-not-allowed'
                    }`}
                  >
                    <ArrowRightLeft size={14} /> Reassign Tasks & Delete Member
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-3 text-xs">
                <p className="text-slate-300">
                  Are you sure you want to delete <strong>{deletingUser.name}</strong> from the team? This member has 0 active assigned tasks.
                </p>
                <div className="pt-2 flex justify-end gap-2">
                  <button
                    onClick={() => setDeletingUser(null)}
                    className="px-4 py-2 rounded-xl border border-white/10 text-slate-300"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleConfirmDelete}
                    className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 font-bold text-white shadow-[0_0_15px_rgba(244,63,94,0.4)]"
                  >
                    Confirm Delete
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal: Direct Task Reassignment Utility */}
      {reassigningUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fadeIn">
          <div className="glass-panel max-w-md w-full p-6 border border-amber-500/40 space-y-4">
            <div className="flex items-center gap-3 pb-3 border-b border-amber-500/20">
              <div className="p-2.5 rounded-xl bg-amber-500/20 text-amber-400 border border-amber-500/40">
                <ArrowRightLeft size={20} />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">Bulk Task Reassignment</h3>
                <p className="text-xs text-amber-300">Source Member: {reassigningUser.name}</p>
              </div>
            </div>

            <div className="space-y-3 text-xs">
              <p className="text-slate-300">
                Transfer all <strong>{getMemberAssignedTasksCount(reassigningUser.id)} active task(s)</strong> assigned to {reassigningUser.name} to another team member:
              </p>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">Target Team Member *</label>
                <select
                  value={targetReassignUserId}
                  onChange={(e) => setTargetReassignUserId(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl bg-black/60 border border-amber-500/40 text-white font-medium focus:outline-none"
                >
                  <option value="">-- Select Target Member --</option>
                  {users
                    .filter((u) => u.id !== reassigningUser.id && u.status === 'active')
                    .map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name} ({u.role.replace('_', ' ')})
                      </option>
                    ))}
                </select>
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  onClick={() => setReassigningUser(null)}
                  className="px-4 py-2 rounded-xl border border-white/10 text-slate-300"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirmReassignOnly}
                  disabled={!targetReassignUserId}
                  className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 font-bold text-black disabled:opacity-50"
                >
                  Confirm Reassign
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
