// Pure copy-building for the multi-team project notifications. Extracted from project.service.ts
// so every team event's wording can be unit-tested without a database — the same "pure functions in
// a colocated module" convention as projectApprovalRejectionCopy.ts and tasks/taskEditCopy.ts.
//
// One module for all of them because §12 of the team-workflow spec makes consistency the point:
// every team event names the actor, the team and the project the same way, puts the short line in
// `message` and everything else in `detail`/`metadata`, and never leaks an internal id. Keeping the
// templates side by side here is what makes a drift between them visible.
//
// Vocabulary, fixed for every template below: Admin / Team Lead / Team Member / Project / Team /
// Task / Subtask / Approval Request / Rejection Reason. "Team Lead" always means the per-project,
// per-team designation (work.TeamMembers.IsLead) — never an account role.

export interface TeamRef {
  name: string;
  /** The team's own responsibility/description. Optional: legacy single-team projects have none. */
  description?: string;
}

/** A task/subtask that still needs an owner after a membership change. */
export interface AffectedTaskRef {
  title: string;
  isSubtask: boolean;
}

// At most this many task titles are listed in an expanded body before it switches to a count. Long
// enough to be actionable ("which tasks?"), short enough that the expanded view stays readable.
const MAX_LISTED_TASKS = 5;

export const formatTeamTimestamp = (date: Date): string => {
  const datePart = date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  const timePart = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  return `${datePart}, ${timePart}`;
};

/** "3 tasks" / "1 task" — the countable unit every reassignment template shares. */
export const pluralizeTasks = (count: number): string => `${count} ${count === 1 ? 'task' : 'tasks'}`;

// "• API Integration" / "• Fix login (subtask)", capped, with a "...and N more" tail. Shared by
// every template that has to show *which* work is affected.
const taskLines = (tasks: AffectedTaskRef[]): string[] => {
  const shown = tasks.slice(0, MAX_LISTED_TASKS);
  const lines = shown.map((task) => `• ${task.title}${task.isSubtask ? ' (subtask)' : ''}`);
  if (tasks.length > shown.length) lines.push(`• …and ${tasks.length - shown.length} more`);
  return lines;
};

export interface TeamNotificationCopy {
  title: string;
  /** Compact preview: actor, action, target, short context. Never carries a reason or a field list. */
  message: string;
  /** Expanded body — only rendered when the recipient opens the notification. */
  detail: string;
  metadata: Record<string, string>;
}

// --- Project creation ------------------------------------------------------------------------
// §2/§3: on creation the reader needs to know which *team* they landed in and in what capacity —
// "added you to the project" alone is what the pre-team copy said, and it is exactly the
// distinction a multi-team project makes meaningful.

export interface TeamAssignmentInput {
  actorName: string;
  projectName: string;
  team: TeamRef;
  /** Present only where the event is a proposal being approved rather than a direct creation. */
  approvedFromProposalBy?: string;
}

export const buildTeamLeadAssignmentCopy = (input: TeamAssignmentInput): TeamNotificationCopy => {
  const { actorName, projectName, team } = input;
  return {
    title: 'Assigned as Team Lead',
    message: `${actorName} assigned you as Team Lead of the "${team.name}" in project "${projectName}".`,
    detail: [
      `${actorName} assigned you as the Team Lead of the "${team.name}" in project "${projectName}".`,
      ...(team.description ? ['', `Team Responsibility: ${team.description}`] : []),
      '',
      'As Team Lead you assign this team\'s tasks to its members, and review their edit requests.'
    ].join('\n'),
    metadata: {
      project: projectName,
      team: team.name,
      role: 'Team Lead',
      assignedBy: actorName,
      ...(team.description ? { teamResponsibility: team.description } : {}),
      ...(input.approvedFromProposalBy ? { approvedBy: input.approvedFromProposalBy } : {})
    }
  };
};

export const buildTeamMemberAddedCopy = (input: TeamAssignmentInput): TeamNotificationCopy => {
  const { actorName, projectName, team } = input;
  return {
    title: 'Added to a Team',
    message: `${actorName} added you to the "${team.name}" in project "${projectName}".`,
    detail: [
      `${actorName} added you to the "${team.name}" in project "${projectName}".`,
      ...(team.description ? ['', `Team Responsibility: ${team.description}`] : [])
    ].join('\n'),
    metadata: {
      project: projectName,
      team: team.name,
      role: 'Team Member',
      addedBy: actorName,
      ...(team.description ? { teamResponsibility: team.description } : {}),
      ...(input.approvedFromProposalBy ? { approvedBy: input.approvedFromProposalBy } : {})
    }
  };
};

// --- Membership changes that strand work -----------------------------------------------------
// §4/§6: the member's own Team Lead — not the project's first lead, and not every lead — is told
// what work just lost its owner, because they are the only person who can reassign it.

export interface StrandedWorkInput {
  actorName: string;
  memberName: string;
  projectName: string;
  team: TeamRef;
  tasks: AffectedTaskRef[];
}

/** §4 — Admin removed a member who still holds active work; their Team Lead must reassign it. */
export const buildRemovalReassignmentCopy = (input: StrandedWorkInput): TeamNotificationCopy => {
  const { actorName, memberName, projectName, team, tasks } = input;
  const count = pluralizeTasks(tasks.length);
  return {
    title: 'Reassignment Needed',
    message: `${actorName} removed ${memberName} from project "${projectName}". ${memberName} still ` +
      `has ${count} that require reassignment.`,
    detail: [
      `${actorName} removed ${memberName} from project "${projectName}".`,
      '',
      `${memberName} was a member of the "${team.name}", which you lead. The following ${count} ` +
        'assigned to them are still open and need to be reassigned to another member of your team:',
      ...taskLines(tasks),
      '',
      'Until they are reassigned or completed, this work has no owner.'
    ].join('\n'),
    metadata: {
      project: projectName,
      team: team.name,
      removedMember: memberName,
      removedBy: actorName,
      tasksNeedingReassignment: String(tasks.length),
      action: 'Reassign the listed tasks to a member of your team'
    }
  };
};

/** §6 — Admin moved a member out of this team; work they held for it must be reassigned. */
export interface TeamMoveInput extends StrandedWorkInput {
  fromTeam: TeamRef;
  toTeam: TeamRef;
}

export const buildMoveReassignmentCopy = (input: TeamMoveInput): TeamNotificationCopy => {
  const { actorName, memberName, projectName, fromTeam, toTeam, tasks } = input;
  const count = pluralizeTasks(tasks.length);
  return {
    title: 'Reassignment Needed',
    message: `${memberName} has been moved from your team. ${count} assigned to them require reassignment.`,
    detail: [
      `${actorName} moved ${memberName} from the "${fromTeam.name}" to the "${toTeam.name}" in project ` +
        `"${projectName}".`,
      '',
      `${memberName} can no longer work on the "${fromTeam.name}"'s tasks. The following ${count} ` +
        'still assigned to them need to be reassigned to another member of your team:',
      ...taskLines(tasks),
      ''
    ].join('\n'),
    metadata: {
      project: projectName,
      team: fromTeam.name,
      movedMember: memberName,
      movedTo: toTeam.name,
      movedBy: actorName,
      tasksNeedingReassignment: String(tasks.length),
      action: 'Reassign the listed tasks to a member of your team'
    }
  };
};

/** §6 — the moved member's own notification. Both ends of the move, so they can tell which of
 *  their current tasks they keep; `team`/`tasks` are the previous Lead's concern, not theirs. */
export const buildMemberMovedCopy = (
  input: Omit<TeamMoveInput, 'tasks' | 'memberName' | 'team'>
): TeamNotificationCopy => {
  const { actorName, projectName, fromTeam, toTeam } = input;
  return {
    title: 'Moved to a New Team',
    message: `${actorName} moved you from the "${fromTeam.name}" to the "${toTeam.name}" in project ` +
      `"${projectName}".`,
    detail: [
      `${actorName} moved you from the "${fromTeam.name}" to the "${toTeam.name}" in project "${projectName}".`,
      ...(toTeam.description ? ['', `Team Responsibility: ${toTeam.description}`] : []),
      '',
      `You now work on the "${toTeam.name}"'s tasks only. Any work still assigned to you from the ` +
        `"${fromTeam.name}" will be reassigned by that team's Lead.`
    ].join('\n'),
    metadata: {
      project: projectName,
      previousTeam: fromTeam.name,
      newTeam: toTeam.name,
      movedBy: actorName,
      ...(toTeam.description ? { teamResponsibility: toTeam.description } : {})
    }
  };
};

// --- Team Lead replacement (§5) ---------------------------------------------------------------

export interface TeamLeadChangeInput {
  actorName: string;
  projectName: string;
  team: TeamRef;
  outgoingLeadName: string;
  newLeadName: string;
  /** Tasks automatically moved from the outgoing lead to the incoming one. */
  reassignedTasks: AffectedTaskRef[];
}

/** Sent to the lead being replaced — names their successor, per §5's example wording. */
export const buildOutgoingLeadCopy = (input: TeamLeadChangeInput): TeamNotificationCopy => {
  const { actorName, projectName, team, newLeadName, reassignedTasks } = input;
  return {
    title: 'Team Lead Changed',
    message: `${actorName} changed the Team Lead of the "${team.name}" in "${projectName}" to ${newLeadName}.`,
    detail: [
      `${actorName} changed the Team Lead of the "${team.name}" in project "${projectName}" to ${newLeadName}.`,
      '',
      'You are no longer the Team Lead of this team.',
      ...(reassignedTasks.length > 0
        ? [
            '',
            `${pluralizeTasks(reassignedTasks.length)} assigned to you as Team Lead ` +
              `${reassignedTasks.length === 1 ? 'has' : 'have'} been reassigned to ${newLeadName}:`,
            ...taskLines(reassignedTasks)
          ]
        : [])
    ].join('\n'),
    metadata: {
      project: projectName,
      team: team.name,
      newTeamLead: newLeadName,
      changedBy: actorName,
      tasksReassigned: String(reassignedTasks.length)
    }
  };
};

/** Sent to the incoming lead. */
export const buildIncomingLeadCopy = (input: TeamLeadChangeInput): TeamNotificationCopy => {
  const { actorName, projectName, team, outgoingLeadName, reassignedTasks } = input;
  return {
    title: 'Assigned as Team Lead',
    message: `${actorName} assigned you as the Team Lead of the "${team.name}" in "${projectName}".`,
    detail: [
      `${actorName} assigned you as the Team Lead of the "${team.name}" in project "${projectName}", ` +
        `replacing ${outgoingLeadName}.`,
      ...(team.description ? ['', `Team Responsibility: ${team.description}`] : []),
      ...(reassignedTasks.length > 0
        ? [
            '',
            `${pluralizeTasks(reassignedTasks.length)} previously assigned to ${outgoingLeadName} ` +
              `${reassignedTasks.length === 1 ? 'has' : 'have'} been reassigned to you:`,
            ...taskLines(reassignedTasks)
          ]
        : [])
    ].join('\n'),
    metadata: {
      project: projectName,
      team: team.name,
      role: 'Team Lead',
      previousTeamLead: outgoingLeadName,
      assignedBy: actorName,
      ...(team.description ? { teamResponsibility: team.description } : {}),
      tasksReassigned: String(reassignedTasks.length)
    }
  };
};

/**
 * §5 — one per task automatically handed to the new lead. Published as `task_reassigned` (the
 * existing type) rather than a team-specific code, because for the recipient this *is* an ordinary
 * new assignment; only the stated cause is team-specific.
 */
export const buildLeadTaskReassignmentCopy = (input: {
  taskTitle: string;
  isSubtask: boolean;
  teamName: string;
  projectName: string;
  previousAssigneeName: string;
  actorName: string;
}): TeamNotificationCopy => {
  const noun = input.isSubtask ? 'Subtask' : 'Task';
  return {
    title: `${noun} Reassigned`,
    message: `${noun} "${input.taskTitle}" was reassigned to you because you are now the Team Lead of ` +
      `the "${input.teamName}".`,
    detail: [
      `${noun} "${input.taskTitle}" in project "${input.projectName}" was reassigned from ` +
        `${input.previousAssigneeName} to you because ${input.actorName} made you the Team Lead of the ` +
        `"${input.teamName}".`,
      '',
      'You can reassign it to a member of your team if someone else should own it.'
    ].join('\n'),
    metadata: {
      project: input.projectName,
      team: input.teamName,
      [input.isSubtask ? 'subtask' : 'task']: input.taskTitle,
      previousAssignee: input.previousAssigneeName,
      reassignedBy: input.actorName,
      reason: 'Team Lead change'
    }
  };
};
