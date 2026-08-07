import { Request, Response, NextFunction } from 'express';
import { query } from '../db/pool.js';
import { getSupabaseServiceClient, getSupabaseAnonClient, isSupabaseServiceConfigured, isSupabaseAnonConfigured } from '../db/supabase.js';
import { fromUserPk } from '../utils/idMapping.js';
import { canAuthenticateAccount } from '../auth/accountAccess.js';

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
    role: string;
    authUserId: string;
    accountStatus: 'Pending' | 'Active' | 'Locked' | 'Deactivated';
    departmentId: number | null;
  };
}

export const validateAuthConfig = (): void => {
  if (isSupabaseServiceConfigured() || process.env.NODE_ENV === 'test') return;

  // Token validation still works through the anon/publishable-key fallback in resolveSession,
  // so a missing service-role key must never crash the whole API at boot -- on serverless
  // deployments that surfaces to the client as a bare non-JSON 500 (e.g. the login screen's
  // "Authentication service returned an unexpected response (HTTP 500)"). Warn loudly instead.
  if (isSupabaseAnonConfigured()) {
    console.warn(
      '[Auth] SUPABASE_SERVICE_ROLE_KEY is not configured. Falling back to anon-key token validation; ' +
      'server-side admin operations (password resets, email changes, user deactivation, storage) will be unavailable.'
    );
    return;
  }

  throw new Error(
    'Supabase Auth requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY ' +
    '(or SUPABASE_PUBLISHABLE_KEY for anon-key token validation).'
  );
};

// Kept only so legacy route modules compile during this one-release retirement window. No route
// may issue or validate these application JWTs after the Supabase cutover.
export const JWT_EXPIRES_IN = '0s';
export const getJwtSecret = (): string => '';

const resolveSession = async (req: AuthenticatedRequest, res: Response): Promise<boolean> => {
  const header = req.header('authorization');
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ success: false, message: 'Authorization header with Bearer token required.' });
    return false;
  }
  const token = header.slice(7);
  let supabaseUserId: string | undefined;

  // Primary path: service-role client (intended server-side token validation).
  try {
    const { data, error } = await getSupabaseServiceClient().auth.getUser(token);
    if (!error && data.user) {
      supabaseUserId = data.user.id;
    }
  } catch {
    // fall through to the anon/publishable-key validation path below
  }

  // Fallback: validate via the project's public anon/publishable key. This performs the exact same
  // Supabase JWT verification the browser client already uses, so a token can never pass without
  // being fully validated by Supabase -- it only rescues validation when the server-side
  // service-role key is misconfigured on the deployment.
  if (!supabaseUserId) {
    const anonClient = getSupabaseAnonClient();
    if (anonClient) {
      try {
        const { data, error } = await anonClient.auth.getUser(token);
        if (!error && data.user) {
          supabaseUserId = data.user.id;
        }
      } catch {
        // leave supabaseUserId undefined; handled by the auth failure below
      }
    }
  }

  if (!supabaseUserId) {
    res.status(401).json({ success: false, message: 'Invalid or expired session.' });
    return false;
  }
  const result = await query<{ userid: number; email: string; accountstatus: string; departmentid: number | null; rolecode: string | null }>(`
    SELECT u.userid, u.email, u.accountstatus, u.departmentid,
      COALESCE(MAX(r.rolecode) FILTER (WHERE r.rolecode = 'Administrator'), MAX(r.rolecode) FILTER (WHERE r.rolecode = 'HRRepresentative'), MAX(r.rolecode) FILTER (WHERE r.rolecode = 'TeamLead'), 'TeamMember') AS rolecode
    FROM iam.users u LEFT JOIN iam.userroles ur ON ur.userid = u.userid AND ur.revokedatutc IS NULL
      AND ur.startsatutc <= now() AND (ur.endsatutc IS NULL OR ur.endsatutc > now())
    LEFT JOIN iam.roles r ON r.roleid = ur.roleid WHERE u.authuserid = $1 GROUP BY u.userid`, [supabaseUserId]);
  const account = result.rows[0];
  if (!account) {
    res.status(403).json({ success: false, message: 'This Supabase account is not provisioned for WorkSync.' });
    return false;
  }
  req.user = {
    id: fromUserPk(account.userid),
    email: account.email,
    authUserId: supabaseUserId,
    departmentId: account.departmentid,
    role: account.rolecode === 'Administrator' ? 'Admin' : account.rolecode === 'HRRepresentative' ? 'HR' : account.rolecode === 'TeamLead' ? 'Team_Lead' : 'Team_Member',
    accountStatus: account.accountstatus as AuthenticatedRequest['user']['accountStatus']
  };
  return true;
};

export const authenticateJWT = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  if (!await resolveSession(req, res)) return;
  if (!req.user || !canAuthenticateAccount({
    accountStatus: req.user.accountStatus
  })) {
    res.status(403).json({ success: false, message: 'Your WorkSync account is not active.' });
    return;
  }
  next();
};
