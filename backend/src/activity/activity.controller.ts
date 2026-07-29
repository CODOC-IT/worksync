import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/authMiddleware.js';
import * as service from './activity.service.js';
import {
  ActivityFilterValidationError,
  parseActivityFilters,
  parseActivityId,
} from './activity.validation.js';

const sendError = (res: Response, error: unknown, fallback: string): void => {
  if (error instanceof ActivityFilterValidationError) {
    res.status(400).json({ success: false, message: error.message });
    return;
  }

  const message = error instanceof Error ? error.message : fallback;
  if (message.includes('Only administrators and HR')) {
    res.status(403).json({ success: false, message });
    return;
  }
  if (message.includes('requires a database')) {
    res.status(503).json({ success: false, message });
    return;
  }

  console.error('[activity] Request failed.', error);
  res.status(500).json({ success: false, message: fallback });
};

export const list = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const result = await service.listActivities(parseActivityFilters(req.query), req.user!.id, req.user!.role);
    res.json({ success: true, ...result });
  } catch (error) {
    sendError(res, error, 'Could not load activity.');
  }
};

export const detail = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const item = await service.getActivity(parseActivityId(req.params.id), req.user!.id, req.user!.role);
    if (!item) return void res.status(404).json({ success: false, message: 'Activity not found or access denied.' });
    res.json({ success: true, item });
  } catch (error) {
    sendError(res, error, 'Could not load activity details.');
  }
};

export const exportActivities = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const result = await service.exportCsv(parseActivityFilters(req.query), req.user!.id, req.user!.role);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="worksync-activity-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.setHeader('X-Activity-Exported-Count', String(result.exportedCount));
    res.setHeader('X-Activity-Total-Count', String(result.total));
    res.send(result.content);
  } catch (error) {
    sendError(res, error, 'Could not export activity as CSV.');
  }
};

export const exportPdf = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const result = await service.exportPdf(parseActivityFilters(req.query), req.user!.id, req.user!.role);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="worksync-activity-${new Date().toISOString().slice(0, 10)}.pdf"`);
    res.setHeader('Content-Length', result.content.length);
    res.setHeader('X-Activity-Exported-Count', String(result.exportedCount));
    res.setHeader('X-Activity-Total-Count', String(result.total));
    res.send(result.content);
  } catch (error) {
    sendError(res, error, 'Could not export activity as PDF.');
  }
};
