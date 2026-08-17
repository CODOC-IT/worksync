import React from 'react';
import { Plus } from 'lucide-react';
import type { User } from '../../types';
import type { DraftTeam } from './teamBuilderRules';

interface TeamBuilderProps {
  teams: DraftTeam[];
  onChange: (teams: DraftTeam[]) => void;
  // Both pools already exclude Admin/HR and inactive accounts -- callers compute this the same
  // way ProjectsView.tsx's own teamLeads/assignableMembers filters always have.
  teamLeads: User[];
  assignableMembers: User[];
  error?: string;
}

// Controlled multi-team builder: one or more teams, each with a name, description, Team Lead, and
// member checklist. A person selected on one team is disabled (can't also be picked) on every
// other team's Lead dropdown or Member checklist -- the team-to-team exclusion rule (req. 1A).
// Extracted out of ProjectsView.tsx's create form so ApprovalsInboxView.tsx's Change Setup editor
// (Admin editing a proposed project's team structure before approval) can reuse the exact same
// UI/exclusion logic instead of a second, potentially-drifting copy.
export const TeamBuilder: React.FC<TeamBuilderProps> = ({ teams, onChange, teamLeads, assignableMembers, error }) => {
  const addTeam = () => {
    const id = `draft-${Date.now()}-${teams.length}`;
    onChange([...teams, { id, name: '', description: '', leadId: '', memberIds: [] }]);
  };

  const removeTeam = (teamId: string) => {
    onChange(teams.filter((team) => team.id !== teamId));
  };

  const updateTeamField = (teamId: string, field: 'name' | 'description', value: string) => {
    onChange(teams.map((team) => (team.id === teamId ? { ...team, [field]: value } : team)));
  };

  const toggleTeamMember = (teamId: string, userId: string) => {
    onChange(teams.map((team) => {
      if (team.id !== teamId) return team;
      const memberIds = team.memberIds.includes(userId)
        ? team.memberIds.filter((id) => id !== userId)
        : [...team.memberIds, userId];
      return { ...team, memberIds };
    }));
  };

  const setTeamLead = (teamId: string, userId: string) => {
    onChange(teams.map((team) => {
      if (team.id !== teamId) return team;
      const memberIds = userId && !team.memberIds.includes(userId)
        ? [...team.memberIds, userId]
        : team.memberIds;
      return { ...team, leadId: userId, memberIds };
    }));
  };

  return (
    <div className="space-y-3">
      {teams.map((team) => (
        <div key={team.id} className="rounded-lg border border-cyan-500/20 bg-black/30 p-3">
          <div className="flex items-center gap-2 mb-2">
            <input
              placeholder="Team name"
              value={team.name}
              onChange={(e) => updateTeamField(team.id, 'name', e.target.value)}
              className="flex-1 px-2 py-1.5 rounded-lg bg-black/40 border border-white/10 text-slate-100 focus:outline-none focus:border-cyan-500/50 text-sm"
            />
            <button
              type="button"
              onClick={() => removeTeam(team.id)}
              className="text-rose-400 hover:text-rose-300 text-[11px] font-semibold"
            >
              Remove
            </button>
          </div>
          <textarea
            placeholder="Team description (purpose / scope)"
            value={team.description}
            onChange={(e) => updateTeamField(team.id, 'description', e.target.value)}
            rows={2}
            className="w-full px-2 py-1.5 rounded-lg bg-black/40 border border-white/10 text-slate-100 focus:outline-none focus:border-cyan-500/50 text-sm mb-2"
          />
          <select
            value={team.leadId}
            onChange={(e) => setTeamLead(team.id, e.target.value)}
            className="w-full px-2 py-1.5 rounded-lg bg-black/40 border border-white/10 text-slate-100 focus:outline-none focus:border-cyan-500/50 text-sm mb-2"
          >
            <option value="">Select Team Lead...</option>
            {teamLeads.map((u) => (
              <option key={u.id} value={u.id} disabled={teams.some((t) => t.id !== team.id && t.memberIds.includes(u.id))}>
                {u.name}
              </option>
            ))}
          </select>
          <div className="grid grid-cols-2 gap-1 max-h-32 overflow-y-auto p-1.5 rounded-lg bg-black/20 border border-white/10">
            {assignableMembers.map((u) => (
              <label key={u.id} className="flex items-center gap-2 text-slate-300 cursor-pointer text-sm">
                <input
                  type="checkbox"
                  checked={team.memberIds.includes(u.id)}
                  onChange={() => toggleTeamMember(team.id, u.id)}
                  disabled={
                    u.id === team.leadId ||
                    teams.some((t) => t.id !== team.id && t.memberIds.includes(u.id))
                  }
                  className="accent-cyan-500"
                />
                {u.name}
              </label>
            ))}
          </div>
        </div>
      ))}
      <button
        type="button"
        onClick={addTeam}
        className="w-full rounded-lg border border-dashed border-cyan-500/40 py-2 text-cyan-300 hover:text-cyan-200 text-sm font-semibold flex items-center justify-center gap-1"
      >
        <Plus size={14} /> Add team
      </button>
      {error && <p className="text-rose-400 mt-1 text-sm">{error}</p>}
    </div>
  );
};
