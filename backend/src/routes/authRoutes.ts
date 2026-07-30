import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { userStore } from '../store/userStore.js';
import { authenticateJWT, AuthenticatedRequest, getJwtSecret, JWT_EXPIRES_IN } from '../middleware/authMiddleware.js';
import { loginRateLimiter, resetLoginAttempts } from '../middleware/rateLimiter.js';
import { recordActivitySafe } from '../activity/activity.service.js';
import { query } from '../db/pool.js';
import { getSupabaseServiceClient } from '../db/supabase.js';
import { toUserPk } from '../utils/idMapping.js';

const router = Router();

// One-time compatibility bridge for accounts that existed before the Supabase Auth cutover.
// bcrypt hashes cannot be imported into Supabase; only a successful legacy-password check may
// create the corresponding Auth account, and the plaintext password is never stored or logged.
router.post('/migrate-legacy-credentials', loginRateLimiter, async (req, res: Response): Promise<void> => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!email || !password) { res.status(400).json({ success: false, message: 'Email and password are required.' }); return; }
  try {
    const user = await userStore.findByEmailAsync(email);
    if (!user?.passwordHash || user.status !== 'active' || !(await bcrypt.compare(password, user.passwordHash))) {
      res.status(401).json({ success: false, message: 'Invalid email or password.' }); return;
    }
    const identity = await query<{ authuserid: string | null }>('SELECT authuserid FROM iam.users WHERE userid = $1', [toUserPk(user.id)]);
    if (identity.rows[0]?.authuserid) { res.status(409).json({ success: false, message: 'This account is already linked. Sign in with Supabase Auth or use password recovery.' }); return; }
    const created = await getSupabaseServiceClient().auth.admin.createUser({ email: user.email, password, email_confirm: true });
    if (created.error || !created.data.user) { res.status(409).json({ success: false, message: 'A Supabase account already exists for this email. Use password recovery to set its password.' }); return; }
    await query('UPDATE iam.users SET authuserid = $1, activatedatutc = COALESCE(activatedatutc, CURRENT_TIMESTAMP), updatedatutc = CURRENT_TIMESTAMP WHERE userid = $2 AND authuserid IS NULL', [created.data.user.id, toUserPk(user.id)]);
    recordActivitySafe({ actorId: user.id, actorName: user.name, actorEmail: user.email, actorRole: user.role, action: 'Updated', module: 'Authentication', entityType: 'User', entityId: user.id, entityName: user.name, description: 'Legacy credentials were securely migrated to Supabase Auth.', result: 'Successful', source: 'Web', important: true });
    res.status(200).json({ success: true, message: 'Your account has been migrated. Signing you in now.' });
  } catch (error) {
    console.error('[auth] Legacy credential migration failed.', error instanceof Error ? error.message : error);
    res.status(503).json({ success: false, message: 'Account migration is temporarily unavailable. Please try again.' });
  }
});

// POST /api/auth/login
router.post('/login', loginRateLimiter, async (req, res: Response): Promise<void> => {
  res.status(410).json({ success: false, message: 'Legacy login has been retired. Sign in with Supabase Auth.' });
  return;
  try {
    const { email, password } = req.body;
    const ip = req.ip || req.socket.remoteAddress || 'unknown';

    if (!email || !password) {
      res.status(400).json({ success: false, message: 'Email and password are required.' });
      return;
    }

    const user = await userStore.findByEmailAsync(email);
    if (!user || !user.passwordHash) {
      recordActivitySafe({ action: 'Login', module: 'Authentication', entityType: 'User', entityId: String(email),
        entityName: String(email), actorEmail: String(email), description: `Failed login attempt for ${email}.`,
        result: 'Failed', source: 'Web', important: true, ipAddress: ip });
      res.status(401).json({ success: false, message: 'Invalid email or password.' });
      return;
    }

    if (user.status !== 'active') {
      recordActivitySafe({ actorId: user.id, actorName: user.name, actorEmail: user.email, actorRole: user.role,
        action: 'Login', module: 'Authentication', entityType: 'User', entityId: user.id, entityName: user.name,
        description: `Blocked login attempt for deactivated account ${user.email}.`, result: 'Blocked',
        source: 'Web', important: true, ipAddress: ip });
      res.status(403).json({ success: false, message: 'Account is deactivated. Contact administrator.' });
      return;
    }

    const isValidPassword = await bcrypt.compare(password, user.passwordHash);
    if (!isValidPassword) {
      recordActivitySafe({ actorId: user.id, actorName: user.name, actorEmail: user.email, actorRole: user.role,
        action: 'Login', module: 'Authentication', entityType: 'User', entityId: user.id, entityName: user.name,
        description: `Failed login attempt for ${user.email}.`, result: 'Failed', source: 'Web',
        important: true, ipAddress: ip });
      res.status(401).json({ success: false, message: 'Invalid email or password.' });
      return;
    }

    resetLoginAttempts(ip);

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      getJwtSecret(),
      { expiresIn: JWT_EXPIRES_IN as any }
    );
    recordActivitySafe({ actorId: user.id, actorName: user.name, actorEmail: user.email, actorRole: user.role,
      action: 'Login', module: 'Authentication', entityType: 'User', entityId: user.id, entityName: user.name,
      description: `${user.name} signed in.`, result: 'Successful', source: 'Web', ipAddress: ip });

    res.status(200).json({
      success: true,
      message: 'Login successful.',
      token,
      user: userStore.sanitizeUser(user)
    });
  } catch {
    res.status(500).json({ success: false, message: 'Login failed. Please try again.' });
  }
});

// GET /api/auth/role-status
router.get('/role-status', async (_req, res: Response): Promise<void> => {
  res.status(410).json({ success: false, message: 'Public registration bootstrap has been retired.' });
});

// POST /api/auth/forgot-password
// Body: { email }
// Sends OTP to the user's email if account exists (don't reveal whether it exists)
router.post('/forgot-password', async (req, res: Response): Promise<void> => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  if (!email) { res.status(400).json({ success: false, message: 'Email is required.' }); return; }
  const { getSupabaseServiceClient } = await import('../db/supabase.js');
  const { error } = await getSupabaseServiceClient().auth.resetPasswordForEmail(email, {
    redirectTo: process.env.SUPABASE_PASSWORD_RESET_REDIRECT_URL || undefined,
  });
  if (error) { res.status(503).json({ success: false, message: 'Password recovery is temporarily unavailable.' }); return; }
  res.status(200).json({ success: true, message: 'If an account exists, a password recovery link has been sent.' });
  return;
  try {
    const { email } = req.body;

    if (!email) {
      res.status(400).json({ success: false, message: 'Email is required.' });
      return;
    }

    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    if (!emailRegex.test(email.trim())) {
      res.status(400).json({ success: false, message: 'Invalid email address format.' });
      return;
    }

    const { otpStore } = await import('../store/otpStore.js');
    const { sendOTPEmail, isEmailConfigured } = await import('../services/emailService.js');

    if (!isEmailConfigured()) {
      res.status(503).json({ success: false, message: 'Email service is not configured.' });
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();
    const user = await userStore.findByEmailAsync(normalizedEmail);

    if (user && user.status === 'active') {
      const { allowed } = otpStore.canResend(normalizedEmail);
      if (allowed) {
        try {
          const otp = otpStore.generate(normalizedEmail);
          await sendOTPEmail(normalizedEmail, user.name, otp);
        } catch (error: any) {
          // Keep the public response indistinguishable for known and unknown addresses.
          console.error('[Forgot Password Email Error]', error.message);
        }
      }
    }

    // Always return 200 to prevent email enumeration
    res.status(200).json({
      success: true,
      message: 'If an account exists with that email, a verification code has been sent.'
    });
  } catch (error: any) {
    console.error('[Forgot Password Error]', error.message);
    res.status(500).json({ success: false, message: 'Failed to process request.' });
  }
});

// PUT /api/auth/password
// Body: { resetToken, newPassword }
// Updates the user's password after OTP verification (resetToken from otp verify)
router.put('/password', async (req, res: Response): Promise<void> => {
  res.status(410).json({ success: false, message: 'Use the Supabase password recovery link to update your password.' });
  return;
  try {
    const { resetToken, newPassword } = req.body;

    if (!resetToken || !newPassword) {
      res.status(400).json({ success: false, message: 'Reset token and new password are required.' });
      return;
    }

    if (typeof newPassword !== 'string' || newPassword.length < 6) {
      res.status(400).json({ success: false, message: 'Password must be at least 6 characters long.' });
      return;
    }

    let payload: { email: string; purpose: string };
    try {
      payload = jwt.verify(resetToken, getJwtSecret()) as { email: string; purpose: string };
    } catch {
      res.status(401).json({ success: false, message: 'Invalid or expired reset token. Please request a new one.' });
      return;
    }

    if (payload.purpose !== 'password_reset') {
      res.status(401).json({ success: false, message: 'Invalid reset token.' });
      return;
    }

    const user = await userStore.findByEmailAsync(payload.email);
    if (!user) {
      res.status(404).json({ success: false, message: 'User not found.' });
      return;
    }

    if (user.status !== 'active') {
      res.status(403).json({ success: false, message: 'Account is deactivated. Contact administrator.' });
      return;
    }

    const bcrypt = await import('bcryptjs');
    const newHash = bcrypt.hashSync(newPassword, 10);
    await userStore.updatePassword(payload.email, newHash);

    res.status(200).json({ success: true, message: 'Password updated successfully. Please sign in with your new password.' });
  } catch {
    res.status(500).json({ success: false, message: 'Failed to update password.' });
  }
});

// GET /api/auth/me
router.get('/me', authenticateJWT, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Not authenticated.' });
      return;
    }

    // Serverless instances may receive this request before any login has hydrated the cache.
    await userStore.syncUsersToDb();
    const user = userStore.findById(req.user.id);
    if (!user) {
      res.status(404).json({ success: false, message: 'User profile not found.' });
      return;
    }

    res.status(200).json({
      success: true,
      user: userStore.sanitizeUser(user)
    });
  } catch {
    res.status(500).json({ success: false, message: 'Failed to restore authenticated session.' });
  }
});

// GET /api/auth/users
// Every authenticated role needs this roster -- not just Admin: Team Leads/HR/Team Members all
// need it to resolve task assignees, @mentions, and notification recipients (e.g. HR-role
// lookup for attendance/break events) client-side. sanitizeUser() already strips the password
// hash, so exposing the rest to any logged-in teammate matches how the rest of this internal
// tool already treats team-roster data (see TeamMembersView, open to every role).
router.get('/users', authenticateJWT, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ success: false, message: 'Authentication required.' });
    return;
  }

  try {
    // Re-sync before responding so the roster reflects the current database state instead of
    // any stale in-memory subset from an earlier request lifecycle.
    await userStore.syncUsersToDb();
    const users = (await userStore.getAllUsers()).map((u) => userStore.sanitizeUser(u));
    res.status(200).json({ success: true, users });
  } catch {
    res.status(500).json({ success: false, message: 'Failed to load users.' });
  }
});

// POST /api/auth/logout
router.post('/logout', authenticateJWT, (req: AuthenticatedRequest, res: Response): void => {
  const user = req.user ? userStore.findById(req.user.id) : undefined;
  if (req.user) recordActivitySafe({ actorId: req.user.id, actorName: user?.name, actorEmail: req.user.email,
    actorRole: req.user.role, action: 'Logout', module: 'Authentication', entityType: 'User',
    entityId: req.user.id, entityName: user?.name, description: `${user?.name || req.user.email} signed out.`,
    source: 'Web', ipAddress: req.ip || req.socket.remoteAddress });
  res.status(200).json({ success: true, message: 'Logout successful.' });
});

// PUT /api/auth/profile/display-name
router.put('/profile/display-name', authenticateJWT, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      return void res.status(401).json({ success: false, message: 'Not authenticated.' });
    }

    const { name } = req.body;

    if (!name || typeof name !== 'string') {
      return void res.status(400).json({ success: false, message: 'Display name is required.' });
    }

    const sanitizedName = name.replace(/<[^>]*>/g, '').trim();

    if (sanitizedName.length < 2) {
      return void res.status(400).json({ success: false, message: 'Display name must be at least 2 characters long.' });
    }

    if (sanitizedName.length > 100) {
      return void res.status(400).json({ success: false, message: 'Display name must not exceed 100 characters.' });
    }

    const updatedUser = await userStore.updateDisplayName(req.user.id, sanitizedName);

    return void res.status(200).json({
      success: true,
      message: 'Display name updated successfully.',
      user: updatedUser
    });
  } catch {
    return void res.status(500).json({ success: false, message: 'Failed to update display name.' });
  }
});

// PUT /api/auth/profile/avatar
router.put('/profile/avatar', authenticateJWT, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      return void res.status(401).json({ success: false, message: 'Not authenticated.' });
    }

    const { avatar } = req.body;

    if (!avatar || typeof avatar !== 'string') {
      return void res.status(400).json({ success: false, message: 'Avatar data URL is required.' });
    }

    if (!avatar.startsWith('data:image/')) {
      return void res.status(400).json({ success: false, message: 'Avatar must be a valid image data URL.' });
    }

    const maxSize = 2 * 1024 * 1024;
    const base64Size = Math.ceil((avatar.length * 3) / 4);
    if (base64Size > maxSize) {
      return void res.status(400).json({ success: false, message: 'Avatar image must be smaller than 2 MB.' });
    }

    const updatedUser = await userStore.updateAvatar(req.user.id, avatar);

    return void res.status(200).json({
      success: true,
      message: 'Profile picture updated successfully.',
      user: updatedUser
    });
  } catch {
    return void res.status(500).json({ success: false, message: 'Failed to update profile picture.' });
  }
});

// PUT /api/auth/profile/password
router.put('/profile/password', authenticateJWT, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Not authenticated.' });
      return;
    }

    const { currentPassword, newPassword, confirmPassword } = req.body;

    if (!currentPassword || !newPassword || !confirmPassword) {
      res.status(400).json({ success: false, message: 'All password fields are required.' });
      return;
    }

    if (newPassword !== confirmPassword) {
      res.status(400).json({ success: false, message: 'New password and confirmation do not match.' });
      return;
    }

    if (newPassword.length < 6) {
      res.status(400).json({ success: false, message: 'New password must be at least 6 characters long.' });
      return;
    }

    const user = userStore.findById(req.user.id);
    if (!user || !user.passwordHash) {
      res.status(404).json({ success: false, message: 'User not found.' });
      return;
    }

    const isValid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!isValid) {
      res.status(403).json({ success: false, message: 'Current password is incorrect.' });
      return;
    }

    const newHash = bcrypt.hashSync(newPassword, 10);
    await userStore.updatePassword(user.email, newHash);

    res.status(200).json({ success: true, message: 'Password changed successfully.' });
  } catch {
    res.status(500).json({ success: false, message: 'Failed to change password.' });
  }
});

export default router;
