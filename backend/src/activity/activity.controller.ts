import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/authMiddleware.js';
import * as service from './activity.service.js';
import { parseActivityFilters } from './activity.validation.js';

export const list = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const result = await service.listActivities(parseActivityFilters(req.query), req.user!.id, req.user!.role);
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ success: false, message: (error as Error).message || 'Could not load activity.' });
  }
};

export const detail = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const item = await service.getActivity(req.params.id, req.user!.id, req.user!.role);
    if (!item) return void res.status(404).json({ success: false, message: 'Activity not found or access denied.' });
    res.json({ success: true, item });
  } catch (error) {
    res.status(500).json({ success: false, message: (error as Error).message || 'Could not load activity.' });
  }
};

export const exportActivities = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const csv = await service.exportCsv(parseActivityFilters(req.query), req.user!.id, req.user!.role);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="worksync-activity-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(csv);
  } catch (error) {
    const message = (error as Error).message;
    res.status(message.includes('administrators') ? 403 : 500).json({ success: false, message });
  }
};

