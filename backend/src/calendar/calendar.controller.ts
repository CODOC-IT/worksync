import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/authMiddleware.js';
import * as service from './calendar.service.js';

// Controller = thin HTTP adapter, matching backend/src/projects' layering. No SQL, no
// authorization decisions here -- those are calendar.service.ts's job.

const requireUser = (req: AuthenticatedRequest, res: Response): { id: string; role: string } | null => {
  if (!req.user) {
    res.status(401).json({ success: false, message: 'Not authenticated.' });
    return null;
  }
  return req.user;
};

const handleServiceError = (error: unknown, res: Response, fallback: string): void => {
  if (error instanceof service.CalendarNotFoundError) {
    res.status(404).json({ success: false, message: error.message });
  } else if (error instanceof service.CalendarAuthorizationError) {
    res.status(403).json({ success: false, message: error.message });
  } else if (error instanceof service.CalendarValidationError) {
    res.status(400).json({ success: false, message: error.message });
  } else {
    console.error('[calendar.controller]', error);
    res.status(500).json({ success: false, message: (error as Error)?.message || fallback });
  }
};

export const listApprovedLeave = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const user = requireUser(req, res);
  if (!user) return;
  try {
    const data = await service.listApprovedLeave();
    res.json({ success: true, data });
  } catch (error) {
    handleServiceError(error, res, 'Failed to load approved leave.');
  }
};

// GET /api/calendar/holidays -- every authenticated user; visibility is now audience-scoped
// (Admin/HR see every holiday, everyone else only sees holidays their audience includes them in --
// see calendar.service.ts's listHolidays).
export const listHolidays = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const user = requireUser(req, res);
  if (!user) return;
  try {
    const data = await service.listHolidays(user.id, user.role);
    res.json({ success: true, data });
  } catch (error) {
    handleServiceError(error, res, 'Failed to load holidays.');
  }
};

// GET /api/calendar/departments -- HR only, enforced in calendar.service.ts via effectiveRoles.ts.
// Every active department org-wide, not scoped by HR's own permitted-department hierarchy (see
// listDepartmentsForHolidayAudience's comment) -- feeds Manage Holidays' audience picker only.
export const listDepartments = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const user = requireUser(req, res);
  if (!user) return;
  try {
    const data = await service.listDepartmentsForHolidayAudience(user.id);
    res.json({ success: true, data });
  } catch (error) {
    handleServiceError(error, res, 'Failed to load departments.');
  }
};

type HolidayAudienceBody = { audienceType?: string; departmentIds?: number[]; userIds?: string[] };

const toAudienceInput = (body: HolidayAudienceBody): service.HolidayAudienceInput => ({
  audienceType: body.audienceType || 'Everyone',
  departmentIds: body.departmentIds || [],
  userIds: body.userIds || []
});

// POST /api/calendar/holidays -- HR only, enforced in calendar.service.ts via effectiveRoles.ts.
export const createHoliday = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const user = requireUser(req, res);
  if (!user) return;
  try {
    const { name, date, isRecurringAnnual, ...audienceBody } = (req.body || {}) as {
      name?: string; date?: string; isRecurringAnnual?: boolean;
    } & HolidayAudienceBody;
    const data = await service.createHoliday(
      name || '', date || '', Boolean(isRecurringAnnual), toAudienceInput(audienceBody), user.id
    );
    res.status(201).json({ success: true, message: 'Holiday created successfully.', data });
  } catch (error) {
    handleServiceError(error, res, 'Failed to create holiday.');
  }
};

// PUT /api/calendar/holidays/:id -- HR only.
export const updateHoliday = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const user = requireUser(req, res);
  if (!user) return;
  try {
    const { name, date, isRecurringAnnual, audienceType, departmentIds, userIds } = (req.body || {}) as {
      name?: string; date?: string; isRecurringAnnual?: boolean;
    } & HolidayAudienceBody;
    const data = await service.updateHoliday(
      req.params.id,
      {
        name,
        date,
        isRecurringAnnual,
        audience: audienceType !== undefined ? toAudienceInput({ audienceType, departmentIds, userIds }) : undefined
      },
      user.id
    );
    res.json({ success: true, message: 'Holiday updated successfully.', data });
  } catch (error) {
    handleServiceError(error, res, 'Failed to update holiday.');
  }
};

// DELETE /api/calendar/holidays/:id -- HR only.
export const deleteHoliday = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const user = requireUser(req, res);
  if (!user) return;
  try {
    await service.deleteHoliday(req.params.id, user.id);
    res.json({ success: true, message: 'Holiday deleted successfully.' });
  } catch (error) {
    handleServiceError(error, res, 'Failed to delete holiday.');
  }
};
