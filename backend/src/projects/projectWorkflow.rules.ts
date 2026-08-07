import type { ProjectApprovalRequestType } from './projectApproval.types.js';

export interface ParticipantResolution {
  teamLeadId: string;
  memberIds: string[];
  error?: string;
}

export const resolveCreateParticipants = (
  actorId: string,
  actorRole: string,
  selectedTeamLeadId: string | undefined,
  selectedMemberIds: string[] = []
): ParticipantResolution => {
  if (actorRole !== 'Admin' && selectedTeamLeadId && selectedTeamLeadId !== actorId) {
    return {
      teamLeadId: actorId,
      memberIds: [],
      error: 'A project creator must be the Team Lead of their submitted project.'
    };
  }
  const teamLeadId = actorRole === 'Admin' ? selectedTeamLeadId || '' : actorId;
  if (!teamLeadId) {
    return { teamLeadId: '', memberIds: [], error: 'An Admin must choose a Team Lead.' };
  }
  return {
    teamLeadId,
    memberIds: Array.from(new Set([...selectedMemberIds, teamLeadId]))
  };
};

export const resolveUpdatedParticipants = (
  currentTeamLeadId: string,
  proposedTeamLeadId: string | undefined,
  proposedMemberIds: string[] | undefined
): { teamLeadId: string; memberIds?: string[]; error?: string } => {
  const teamLeadId = proposedTeamLeadId ?? currentTeamLeadId;
  if (proposedMemberIds === undefined) return { teamLeadId };
  if (!proposedMemberIds.includes(currentTeamLeadId) && teamLeadId === currentTeamLeadId) {
    return {
      teamLeadId,
      error: 'The current Team Lead cannot be removed from project members without assigning a replacement lead.'
    };
  }
  return {
    teamLeadId,
    memberIds: Array.from(new Set([...proposedMemberIds, teamLeadId]))
  };
};

export const validateProjectDecision = (
  decision: 'Approved' | 'Rejected',
  reason: string | null | undefined
): string | null =>
  decision === 'Rejected' && !reason?.trim() ? 'A rejection reason is required.' : null;

export const buildProjectDecisionMessage = (
  reviewerName: string,
  decision: 'Approved' | 'Rejected',
  actionLabel: string,
  projectName: string,
  reason?: string | null
): string =>
  `${reviewerName} ${decision === 'Approved' ? 'approved' : 'rejected'} your request to ` +
  `${actionLabel} "${projectName}".` +
  (decision === 'Rejected' ? ` Reason: ${reason?.trim() || ''}` : '');

export const projectDecisionEffect = (
  requestType: ProjectApprovalRequestType,
  decision: 'Approved' | 'Rejected'
): 'apply-proposed-edit' | 'discard-proposed-edit' | 'remove-rejected-creation' | 'execute-action' | 'none' => {
  if (decision === 'Rejected') {
    if (requestType === 'PROJECT_CREATE') return 'remove-rejected-creation';
    if (requestType === 'PROJECT_EDIT') return 'discard-proposed-edit';
    return 'none';
  }
  if (requestType === 'PROJECT_EDIT') return 'apply-proposed-edit';
  return 'execute-action';
};
