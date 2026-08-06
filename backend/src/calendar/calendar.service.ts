import * as repo from './calendar.repository.js';
import { userStore } from '../store/userStore.js';
import { getEffectiveRoles } from '../auth/effectiveRoles.js';
import { fromUserPk, toUserPk } from '../utils/idMapping.js';
import { recordActivitySafe } from '../activity/activity.service.js';
import * as notificationService from '../notifications/notification.service.js';
import { resolveAdminRecipients } from '../notifications/notification.recipients.js';

// Service Layer, matching the layering convention already used by backend/src/projects and
// backend/src/notifications: no SQL here (that's calendar.repository.ts), no Express req/res
// here (that's calendar.controller.ts).

export class CalendarAuthorizationError extends Error {}
export class CalendarNotFoundError extends Error {}
export class CalendarValidationError extends Error {}

export interface ApprovedLeaveEntry {
  id: string;
  userId: string;
  userName: string;
  date: string;
  leaveType: 'Full Day Leave' | 'Half Day Leave';
}

const parseDetails = (details: repo.ApprovedLeaveRow['details']): { leaveType?: string } =>
  (typeof details === 'string' ? JSON.parse(details) : details || {}) as { leaveType?: string };

// Unfiltered by role, matching the Calendar module's existing convention (see
// frontend/src/features/calendar/calendarRules.ts: "Visibility is intentionally unfiltered") --
// every authenticated caller (Employee/Team Lead/HR/Admin) sees the same approved leave, same as
// Deadlines/Milestones/Task Due today. This is deliberately different from GET /api/hr-requests,
// which scopes by role for the Approvals Inbox -- that endpoint and its logic are untouched.
export const listApprovedLeave = async (): Promise<ApprovedLeaveEntry[]> => {
  const rows = await repo.findApprovedLeave();
  return rows.map((row) => {
    const details = parseDetails(row.details);
    return {
      id: row.id,
      userId: row.user_id,
      userName: row.user_name || userStore.findById(row.user_id)?.name || 'Unknown',
      date: row.request_date,
      leaveType: details.leaveType === 'Half Day Leave' ? 'Half Day Leave' : 'Full Day Leave'
    };
  });
};

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
export const validateHolidayDate = (
  date: string,
  today: string,
  existingDate?: string
): string | null => {
  if (!ISO_DATE_PATTERN.test(date || '')) return 'A valid holiday date is required.';
  if (date < today && date !== existingDate) return 'Holiday date cannot be in the past.';
  return null;
};

export interface HolidayDTO {
  id: string;
  name: string;
  date: string;
  isRecurringAnnual: boolean;
  audienceType: repo.HolidayAudienceType;
  departmentIds: number[];
  userIds: string[];
  createdByUserId: string;
  createdAt: string;
}

const toHolidayDTO = (
  row: repo.HolidayRow,
  departmentIds: number[] = [],
  userIds: number[] = []
): HolidayDTO => ({
  id: String(row.holidayid),
  name: row.holidayname,
  date: row.holidaydate,
  isRecurringAnnual: row.isrecurringannual,
  audienceType: row.audiencetype,
  departmentIds,
  userIds: userIds.map(fromUserPk),
  createdByUserId: fromUserPk(row.createdbyuserid),
  createdAt: row.createdatutc.toISOString()
});

export interface HolidayAudienceInput {
  audienceType: string;
  departmentIds: number[];
  userIds: string[];
}

const AUDIENCE_TYPES: repo.HolidayAudienceType[] = ['Everyone', 'Department', 'Users'];

// Order-independent equality for two id arrays -- used by updateHoliday to detect whether a
// submitted audience actually differs from what's currently stored.
const sameIdSet = <T,>(a: T[], b: T[]): boolean => {
  if (a.length !== b.length) return false;
  const setB = new Set(b);
  return a.every((id) => setB.has(id));
};

// Mutual exclusivity is a cross-table invariant (audienceType plus which of the two join tables
// gets populated) that a single-table CHECK constraint can't express, so it's enforced here --
// same layer validateHolidayDate's own date rule already lives at.
export const validateAudience = (
  audienceType: string,
  departmentIds: number[],
  userIds: string[]
): string | null => {
  if (!AUDIENCE_TYPES.includes(audienceType as repo.HolidayAudienceType)) {
    return 'A valid holiday audience is required.';
  }
  if (audienceType === 'Everyone') {
    if (departmentIds.length > 0 || userIds.length > 0) {
      return 'The "Everyone" audience cannot include specific departments or users.';
    }
  } else if (audienceType === 'Department') {
    if (departmentIds.length === 0) return 'Select at least one department.';
    if (userIds.length > 0) return 'A department audience cannot also include specific users.';
  } else if (userIds.length === 0) {
    return 'Select at least one user.';
  } else if (departmentIds.length > 0) {
    return 'A specific-users audience cannot also include departments.';
  }
  return null;
};

// Existence check for a Department audience -- gives a clean validation error instead of letting
// an unknown id fail on the FK constraint inside insertHoliday/updateHoliday's transaction.
const assertValidDepartments = async (departmentIds: number[]): Promise<void> => {
  if (departmentIds.length === 0) return;
  const existing = new Set(await repo.findExistingDepartmentIds(departmentIds));
  const missing = departmentIds.filter((id) => !existing.has(id));
  if (missing.length > 0) {
    throw new CalendarValidationError(`Unknown department id(s): ${missing.join(', ')}.`);
  }
};

// Server-side enforcement of "Admin/HR must never appear in the Specific Users audience" -- the
// frontend hiding them from the picker is the UX layer only, mirrors
// project.service.ts's assertEligibleAssignee exactly (active-account + role-eligibility check
// against userStore, not just the request body).
const assertEligibleAudienceUsers = async (userIds: string[]): Promise<void> => {
  if (userIds.length === 0) return;
  const allUsers = await userStore.getAllUsers();
  for (const userId of userIds) {
    const target = allUsers.find((user) => user.id === userId);
    if (!target) throw new CalendarValidationError(`Selected user "${userId}" could not be found.`);
    if (target.status === 'inactive') {
      throw new CalendarValidationError(`${target.name} is a deactivated account and cannot be part of a holiday's audience.`);
    }
    if (target.role === 'Admin' || target.role === 'HR') {
      throw new CalendarValidationError(`${target.name} cannot be selected as a specific holiday audience member.`);
    }
  }
};

// Uses effectiveRoles.ts (backend/src/auth/effectiveRoles.ts) rather than a direct
// `role === 'HR'` string comparison, per the same rule Attendance/Activity already follow:
// isActiveHR is computed as `!isAdmin && ...` there, so an Admin can never satisfy this check --
// including an Admin who also happens to hold an HR grant -- Admin access is excluded by
// construction, not by an extra check layered on here.
const assertIsHR = async (actorId: string): Promise<void> => {
  const roles = await getEffectiveRoles(actorId);
  if (!roles.isActiveHR) {
    throw new CalendarAuthorizationError('Only HR can manage holidays.');
  }
};

const parseHolidayId = (holidayId: string): number => {
  const id = Number(holidayId);
  if (!Number.isInteger(id)) throw new CalendarValidationError('Invalid holiday id.');
  return id;
};

// Admin always sees every holiday (requirement); HR gets the same org-wide bypass because HR
// manages holidays via Manage Holidays and isn't necessarily in the audience of every holiday it
// created/must edit -- same convention as project.service.ts's isProjectAccessible
// (`role === 'Admin' || role === 'HR'`). Everyone else only gets 'Everyone'-audience holidays plus
// whichever 'Department'/'Users' holidays target their own department/id (repo.findHolidays).
const canSeeEveryHoliday = async (viewerId: string, viewerRole: string): Promise<boolean> => {
  if (viewerRole === 'Admin') return true;
  const roles = await getEffectiveRoles(viewerId);
  return roles.isActiveHR;
};

export interface DepartmentOptionDTO {
  id: number;
  name: string;
}

// Every active department in the org, gated the same way create/update/delete already are
// (HR-only, via assertIsHR) -- only HR manages holidays, so only HR needs this list. Deliberately
// separate from GET /api/accounts/departments (see calendar.repository.ts's
// findAllActiveDepartments) -- that endpoint's HR-permitted-hierarchy scoping is specific to
// member-provisioning authorization and must not limit which departments a holiday can target.
export const listDepartmentsForHolidayAudience = async (actorId: string): Promise<DepartmentOptionDTO[]> => {
  await assertIsHR(actorId);
  const rows = await repo.findAllActiveDepartments();
  return rows.map((row) => ({ id: row.departmentid, name: row.departmentname }));
};

export const listHolidays = async (viewerId: string, viewerRole: string): Promise<HolidayDTO[]> => {
  const bypass = await canSeeEveryHoliday(viewerId, viewerRole);
  const rows = await repo.findHolidays(toUserPk(viewerId), bypass);
  if (rows.length === 0) return [];

  const holidayIds = rows.map((row) => row.holidayid);
  const [departmentRows, userRows] = await Promise.all([
    repo.findAudienceDepartmentsForHolidays(holidayIds),
    repo.findAudienceUsersForHolidays(holidayIds)
  ]);
  return rows.map((row) =>
    toHolidayDTO(
      row,
      departmentRows.filter((d) => d.holidayid === row.holidayid).map((d) => d.departmentid),
      userRows.filter((u) => u.holidayid === row.holidayid).map((u) => u.userid)
    )
  );
};

// Recipients for the 'holiday_created' notification: the audience itself, plus every Admin
// unconditionally (requirement: "Admin must always receive a notification"), deduped, minus the
// actor. createHoliday is HR-only (assertIsHR), so actorId can never itself be an Admin id here --
// the exclude-actor step can never accidentally drop an Admin recipient.
const resolveHolidayAudienceRecipients = async (dto: HolidayDTO, actorId: string): Promise<string[]> => {
  let audiencePks: number[];
  if (dto.audienceType === 'Everyone') {
    audiencePks = await repo.findActiveUserIds();
  } else if (dto.audienceType === 'Department') {
    audiencePks = await repo.findActiveUserIdsForDepartments(dto.departmentIds);
  } else {
    audiencePks = dto.userIds.map(toUserPk);
  }
  const adminRecipientIds = await resolveAdminRecipients(actorId);
  const recipientIds = new Set<string>([...audiencePks.map(fromUserPk), ...adminRecipientIds]);
  recipientIds.delete(actorId);
  return Array.from(recipientIds);
};

// Fire-and-forget, mirroring project.service.ts's notifyRecipients -- never awaited by
// createHoliday, and any failure is caught/logged here so notification delivery can never affect
// whether holiday creation itself succeeds.
const notifyHolidayCreated = (dto: HolidayDTO, actorId: string): void => {
  resolveHolidayAudienceRecipients(dto, actorId)
    .then((recipientIds) => {
      if (recipientIds.length === 0) return undefined;
      const audienceLabel =
        dto.audienceType === 'Everyone'
          ? 'everyone'
          : dto.audienceType === 'Department'
            ? 'the selected department(s)'
            : 'the selected team member(s)';
      return notificationService.publishEvent({
        type: 'holiday_created',
        title: 'New Holiday Added',
        message: `"${dto.name}" was added to the holiday calendar (${dto.date}) for ${audienceLabel}.`,
        actorId,
        recipientIds
      });
    })
    .catch((error) => {
      console.error('[calendar.service] Failed to publish holiday_created notification.', error);
    });
};

export const createHoliday = async (
  name: string,
  date: string,
  isRecurringAnnual: boolean,
  audience: HolidayAudienceInput,
  actorId: string
): Promise<HolidayDTO> => {
  await assertIsHR(actorId);
  if (!name?.trim()) throw new CalendarValidationError('Holiday name is required.');
  const dateError = validateHolidayDate(date, await repo.getBusinessDate());
  if (dateError) throw new CalendarValidationError(dateError);

  const audienceError = validateAudience(audience.audienceType, audience.departmentIds, audience.userIds);
  if (audienceError) throw new CalendarValidationError(audienceError);
  await assertValidDepartments(audience.departmentIds);
  await assertEligibleAudienceUsers(audience.userIds);

  const audienceType = audience.audienceType as repo.HolidayAudienceType;
  const departmentPks = audience.departmentIds;
  const userPks = audience.userIds.map(toUserPk);

  const id = await repo.insertHoliday({
    name: name.trim(),
    date,
    isRecurringAnnual: Boolean(isRecurringAnnual),
    audienceType,
    departmentIds: departmentPks,
    userIds: userPks,
    createdByUserId: toUserPk(actorId)
  });
  const row = await repo.findHolidayById(id);
  recordActivitySafe({
    actorId, action: 'Created', module: 'Calendar', entityType: 'Holiday', entityId: String(id),
    entityName: name.trim(), description: `Created holiday “${name.trim()}” on ${date}.`,
    source: 'API', linkRoute: '/calendar',
  });
  const dto = toHolidayDTO(row!, departmentPks, userPks);

  // Persisted successfully above -- notification delivery is entirely fire-and-forget from here
  // on and cannot turn this into a failed creation.
  notifyHolidayCreated(dto, actorId);

  return dto;
};

export const updateHoliday = async (
  holidayId: string,
  updates: { name?: string; date?: string; isRecurringAnnual?: boolean; audience?: HolidayAudienceInput },
  actorId: string
): Promise<HolidayDTO> => {
  await assertIsHR(actorId);
  const id = parseHolidayId(holidayId);
  const existing = await repo.findHolidayById(id);
  if (!existing) throw new CalendarNotFoundError('Holiday not found.');

  if (updates.name !== undefined && !updates.name.trim()) {
    throw new CalendarValidationError('Holiday name cannot be empty.');
  }
  if (updates.date !== undefined) {
    const dateError = validateHolidayDate(
      updates.date,
      await repo.getBusinessDate(),
      existing.holidaydate
    );
    if (dateError) throw new CalendarValidationError(dateError);
  }

  // Current audience, needed either way: to build the returned DTO when nothing changes, and to
  // detect whether a submitted audience actually differs from what's already stored. Fetched once,
  // up front, rather than the previous re-fetch-after-write -- same number of queries either way,
  // just moved earlier so it can double as the "did anything change" comparison.
  const [currentDepartmentRows, currentUserRows] = await Promise.all([
    repo.findAudienceDepartmentsForHolidays([id]),
    repo.findAudienceUsersForHolidays([id])
  ]);
  const currentDepartmentIds = currentDepartmentRows.map((d) => d.departmentid);
  const currentUserPks = currentUserRows.map((u) => u.userid);
  let resultDepartmentIds = currentDepartmentIds;
  let resultUserPks = currentUserPks;

  let audienceType: repo.HolidayAudienceType | undefined;
  let departmentPks: number[] | undefined;
  let userPks: number[] | undefined;
  if (updates.audience) {
    const audienceError = validateAudience(
      updates.audience.audienceType, updates.audience.departmentIds, updates.audience.userIds
    );
    if (audienceError) throw new CalendarValidationError(audienceError);
    await assertValidDepartments(updates.audience.departmentIds);
    await assertEligibleAudienceUsers(updates.audience.userIds);

    const nextAudienceType = updates.audience.audienceType as repo.HolidayAudienceType;
    const nextDepartmentIds = updates.audience.departmentIds;
    const nextUserPks = updates.audience.userIds.map(toUserPk);

    // Only pass the audience through to the repository (which does an unconditional
    // delete-then-reinsert whenever audienceType is present) if it actually differs from what's
    // currently stored -- a pure name/date/recurrence edit, or a resubmission of the same
    // audience, must not churn the join tables for no reason.
    if (
      nextAudienceType !== existing.audiencetype ||
      !sameIdSet(nextDepartmentIds, currentDepartmentIds) ||
      !sameIdSet(nextUserPks, currentUserPks)
    ) {
      audienceType = nextAudienceType;
      departmentPks = nextDepartmentIds;
      userPks = nextUserPks;
      resultDepartmentIds = nextDepartmentIds;
      resultUserPks = nextUserPks;
    }
  }

  await repo.updateHoliday(id, {
    name: updates.name?.trim(),
    date: updates.date,
    isRecurringAnnual: updates.isRecurringAnnual,
    audienceType,
    departmentIds: departmentPks,
    userIds: userPks
  });
  const updated = await repo.findHolidayById(id);
  recordActivitySafe({
    actorId, action: 'Updated', module: 'Calendar', entityType: 'Holiday', entityId: String(id),
    entityName: updated?.holidayname || String(id), description: `Updated holiday “${updated?.holidayname || id}”.`,
    source: 'API', linkRoute: '/calendar',
  });

  return toHolidayDTO(updated!, resultDepartmentIds, resultUserPks);
};

export const deleteHoliday = async (holidayId: string, actorId: string): Promise<void> => {
  await assertIsHR(actorId);
  const id = parseHolidayId(holidayId);
  const existing = await repo.findHolidayById(id);
  const deleted = await repo.deleteHoliday(id);
  if (!deleted) throw new CalendarNotFoundError('Holiday not found.');
  recordActivitySafe({
    actorId, action: 'Deleted', module: 'Calendar', entityType: 'Holiday', entityId: String(id),
    entityName: existing?.holidayname || String(id), description: `Deleted holiday “${existing?.holidayname || id}”.`,
    source: 'API', linkRoute: '/calendar',
  });
};
