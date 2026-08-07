import { HRRequest } from '../../types';

// Pure copy builders for every leave-related notification (submitted / forwarded to Admin /
// approved / rejected). Extracted from AppContext so all four templates are written once and
// stay consistent with each other: a recipient must always be able to tell a Full Day Leave from
// a Half Day Leave — and which half — straight from the notification, without opening the
// request. Same "pure, colocated, no React" convention as taskRules.ts / attendanceValidation.ts.

// `leavePeriod` is stored as 'First Half' / 'Second Half' (the value the API and
// hr.AttendanceStatuses work in), but a person reads Morning / Afternoon far more easily — and
// that is how the brief's example copy words it.
const HALF_DAY_PERIOD_LABELS: Record<NonNullable<HRRequest['details']['leavePeriod']>, string> = {
  'First Half': 'Morning',
  'Second Half': 'Afternoon'
};

/**
 * "Full Day Leave" / "Half Day Leave (Morning)".
 *
 * Defaults to Full Day when `leaveType` is missing: leave requests created before the half-day
 * option existed have no `leaveType`, and every one of those was a full day.
 */
export const describeLeaveType = (details: HRRequest['details'] | undefined): string => {
  if (details?.leaveType !== 'Half Day Leave') return 'Full Day Leave';
  const period = details.leavePeriod ? HALF_DAY_PERIOD_LABELS[details.leavePeriod] : undefined;
  return period ? `Half Day Leave (${period})` : 'Half Day Leave';
};

/** The half-day period on its own ("Morning"/"Afternoon"), or undefined for a full day. */
export const describeLeavePeriod = (details: HRRequest['details'] | undefined): string | undefined =>
  details?.leaveType === 'Half Day Leave' && details.leavePeriod
    ? HALF_DAY_PERIOD_LABELS[details.leavePeriod]
    : undefined;

/**
 * "12 Aug 2026" — short, unambiguous, and locale-independent in its field order, so a leave date
 * never reads as an ambiguous 08/12. Falls back to the raw value if it isn't a YYYY-MM-DD date.
 */
export const formatLeaveDate = (date: string): string => {
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};

export interface LeaveNotificationCopy {
  title: string;
  /** Compact preview for the notification list. */
  message: string;
  /** Expanded body — adds the reason/decision comment the preview deliberately leaves out. */
  detail: string;
  metadata: Record<string, string>;
}

const baseMetadata = (
  request: Pick<HRRequest, 'date' | 'details' | 'reason'>
): Record<string, string> => ({
  leaveType: describeLeaveType(request.details),
  ...(describeLeavePeriod(request.details) ? { period: describeLeavePeriod(request.details)! } : {}),
  date: formatLeaveDate(request.date)
});

/** Sent to the reviewers (HR, or Admin when HR themselves request leave). */
export const buildLeaveRequestedCopy = (params: {
  requesterName: string;
  request: Pick<HRRequest, 'date' | 'details' | 'reason'>;
}): LeaveNotificationCopy => {
  const { requesterName, request } = params;
  const leave = describeLeaveType(request.details);
  const date = formatLeaveDate(request.date);
  return {
    title: `${leave} Requested`,
    message: `${requesterName} has applied for a ${leave} on ${date}.`,
    detail: [
      `${requesterName} has applied for a ${leave} on ${date} and is waiting on your decision.`,
      '',
      `Reason: ${request.reason || 'No reason provided.'}`
    ].join('\n'),
    metadata: { ...baseMetadata(request), requestedBy: requesterName, status: 'Pending' }
  };
};

/** Sent to Admins when HR approves a leave request and forwards it for final approval. */
export const buildLeaveForwardedCopy = (params: {
  requesterName: string;
  approverName: string;
  request: Pick<HRRequest, 'date' | 'details' | 'reason'>;
}): LeaveNotificationCopy => {
  const { requesterName, approverName, request } = params;
  const leave = describeLeaveType(request.details);
  const date = formatLeaveDate(request.date);
  return {
    title: `${leave} Awaiting Final Approval`,
    message: `${approverName} approved ${requesterName}'s ${leave} on ${date} — final approval is yours.`,
    detail: [
      `${approverName} (HR) approved ${requesterName}'s ${leave} on ${date} and forwarded it for final Admin approval.`,
      '',
      `Reason: ${request.reason || 'No reason provided.'}`
    ].join('\n'),
    metadata: {
      ...baseMetadata(request),
      requestedBy: requesterName,
      approvedBy: approverName,
      status: 'Pending Admin approval'
    }
  };
};

/** Sent to the requester when HR approves their leave but Admin still has to sign it off. */
export const buildLeaveForwardedRequesterCopy = (params: {
  approverName: string;
  request: Pick<HRRequest, 'date' | 'details' | 'reason'>;
}): LeaveNotificationCopy => {
  const { approverName, request } = params;
  const leave = describeLeaveType(request.details);
  const date = formatLeaveDate(request.date);
  return {
    title: `${leave} Forwarded to Admin`,
    message: `Your ${leave} on ${date} was approved by HR and is awaiting final Admin approval.`,
    detail: `${approverName} (HR) approved your ${leave} on ${date}. It is now waiting on final Admin approval before it takes effect.`,
    metadata: { ...baseMetadata(request), approvedBy: approverName, status: 'Pending Admin approval' }
  };
};

/** Sent to the requester on the final decision. */
export const buildLeaveDecisionCopy = (params: {
  decision: 'Approved' | 'Rejected';
  approverName: string;
  request: Pick<HRRequest, 'date' | 'details' | 'reason'>;
  decisionReason?: string;
}): LeaveNotificationCopy => {
  const { decision, approverName, request, decisionReason } = params;
  const leave = describeLeaveType(request.details);
  const date = formatLeaveDate(request.date);
  const verb = decision === 'Approved' ? 'approved' : 'rejected';
  const reason = decisionReason?.trim();
  return {
    title: `${leave} ${decision}`,
    message: `Your ${leave} on ${date} has been ${verb} by ${approverName}.`,
    // The reviewer's reason is mandatory on a rejection and optional on an approval; either way
    // it belongs in the expanded body rather than the scannable preview line.
    detail: [
      `${approverName} ${verb} your ${leave} on ${date}.`,
      ...(reason ? ['', `Reason: ${reason}`] : [])
    ].join('\n'),
    metadata: {
      ...baseMetadata(request),
      [decision === 'Approved' ? 'approvedBy' : 'rejectedBy']: approverName,
      status: decision,
      ...(reason ? { [decision === 'Approved' ? 'comment' : 'rejectionReason']: reason } : {})
    }
  };
};
