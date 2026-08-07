import { Router } from 'express';
import { authenticateJWT } from '../middleware/authMiddleware.js';
import * as controller from './calendar.controller.js';

const router = Router();

// Every route requires a real authenticated session, matching every other module's routing.
router.use(authenticateJWT);

// GET /api/calendar/approved-leave — read-only, unfiltered by role (Employee/Team Lead/HR/Admin
// all see the same approved leave). Reads public.worksync_hr_requests directly; never writes to
// it. The HR approval flow that owns that table lives entirely in
// backend/src/routes/hrRequestRoutes.ts and is untouched by this module.
router.get('/approved-leave', controller.listApprovedLeave);

// GET /api/calendar/departments — every active department, HR only (see
// listDepartmentsForHolidayAudience's comment for why this isn't accounts.routes.ts's
// /api/accounts/departments). Feeds Manage Holidays' audience picker only.
router.get('/departments', controller.listDepartments);

// GET /api/calendar/holidays — read-only, visibility is audience-scoped (see
// calendar.service.ts's listHolidays).
router.get('/holidays', controller.listHolidays);

// POST /api/calendar/holidays — HR only (403 for everyone else, Admin included; enforced via
// effectiveRoles.ts in calendar.service.ts, not just this route).
router.post('/holidays', controller.createHoliday);

// PUT /api/calendar/holidays/:id — HR only.
router.put('/holidays/:id', controller.updateHoliday);

// DELETE /api/calendar/holidays/:id — HR only.
router.delete('/holidays/:id', controller.deleteHoliday);

export default router;
