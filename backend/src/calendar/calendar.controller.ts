import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/authMiddleware.js';
import * as service from './calendar.service.js';

// Controller = thin HTTP adapter, matching backend/src/projects' layering.

export const listApprovedLeave = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ success: false, message: 'Not authenticated.' });
    return;
  }
  try {
    const data = await service.listApprovedLeave();
    res.json({ success: true, data });
  } catch (error) {
    console.error('[calendar.controller]', error);
    res.status(500).json({ success: false, message: 'Failed to load approved leave.' });
  }
};
