import { Request, Response, NextFunction } from 'express';
import { query } from '../db/pool.js';
import { getSupabaseServiceClient, isSupabaseServiceConfigured } from '../db/supabase.js';
import { fromUserPk } from '../utils/idMapping.js';

export interface AuthenticatedRequest extends Request { user?: { id: string; email: string; role: string; authUserId: string; }; }

export const validateAuthConfig = (): void => {
  if (!isSupabaseServiceConfigured() && process.env.NODE_ENV !== 'test') {
    throw new Error('Supabase Auth requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  }
};

// Kept only so legacy route modules compile during this one-release retirement window. No route
// may issue or validate these application JWTs after the Supabase cutover.
export const JWT_EXPIRES_IN = '0s';
export const getJwtSecret = (): string => '';

export const authenticateJWT = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  const header = req.header('authorization');
  if (!header?.startsWith('Bearer ')) { res.status(401).json({ success: false, message: 'Authorization header with Bearer token required.' }); return; }
  try {
    const { data, error } = await getSupabaseServiceClient().auth.getUser(header.slice(7));
    if (error || !data.user) { res.status(401).json({ success: false, message: 'Invalid or expired session.' }); return; }
    const result = await query<{ userid: number; email: string; accountstatus: string; rolecode: string | null }>(`
      SELECT u.userid, u.email, u.accountstatus,
        COALESCE(MAX(r.rolecode) FILTER (WHERE r.rolecode = 'Administrator'), MAX(r.rolecode) FILTER (WHERE r.rolecode = 'HRRepresentative'), MAX(r.rolecode) FILTER (WHERE r.rolecode = 'TeamLead'), 'TeamMember') AS rolecode
      FROM iam.users u LEFT JOIN iam.userroles ur ON ur.userid = u.userid AND ur.revokedatutc IS NULL AND (ur.endsatutc IS NULL OR ur.endsatutc > now())
      LEFT JOIN iam.roles r ON r.roleid = ur.roleid WHERE u.authuserid = $1 GROUP BY u.userid`, [data.user.id]);
    const account = result.rows[0];
    if (!account) { res.status(403).json({ success: false, message: 'This Supabase account is not provisioned for WorkSync.' }); return; }
    if (account.accountstatus !== 'Active') { res.status(403).json({ success: false, message: 'Your WorkSync account is not active.' }); return; }
    req.user = { id: fromUserPk(account.userid), email: account.email, authUserId: data.user.id, role: account.rolecode === 'Administrator' ? 'Admin' : account.rolecode === 'HRRepresentative' ? 'HR' : account.rolecode === 'TeamLead' ? 'Team_Lead' : 'Team_Member' };
    next();
  } catch { res.status(503).json({ success: false, message: 'Authentication service is unavailable.' }); }
};
