import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { userStore } from '../store/userStore.js';
import { authenticateJWT, AuthenticatedRequest, getJwtSecret, JWT_EXPIRES_IN } from '../middleware/authMiddleware.js';
import { loginRateLimiter, resetLoginAttempts } from '../middleware/rateLimiter.js';
import { recordActivitySafe } from '../activity/activity.service.js';
import { getSupabaseServiceClient } from '../db/supabase.js';
import { query } from '../db/pool.js';
import { toUserPk } from '../utils/idMapping.js';

const router = Router();

const canManageAccounts = (role?: string) => role === 'Admin' || role === 'HR';
const DEFAULT_TEMPORARY_ACCOUNT_PASSWORD = 'Codoc@123';

// POST /api/auth/login
router.post('/login', loginRateLimiter, async (req, res: Response): Promise<void> => {
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

// POST /api/auth/migrate-legacy-credentials
// Migrates a legacy user (bcrypt password in WorkSync DB, no Supabase Auth identity yet) into
// Supabase Auth. Called by LoginView.tsx when the direct Supabase sign-in fails — this bridges
// the gap for accounts created before the Supabase Auth cutover.
router.post('/migrate-legacy-credentials', async (req, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      res.status(400).json({ success: false, message: 'Email and password are required.' });
      return;
    }

    const user = await userStore.findByEmailAsync(email.trim().toLowerCase());
    if (!user || !user.passwordHash) {
      res.status(401).json({ success: false, message: 'Invalid email or password.' });
      return;
    }

    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) {
      res.status(401).json({ success: false, message: 'Invalid email or password.' });
      return;
    }

    if (user.status !== 'active') {
      res.status(403).json({ success: false, message: 'Account is deactivated. Contact administrator.' });
      return;
    }

    // Check if user already has a Supabase Auth identity linked
    const existing = await query<{ authuserid: string | null }>(
      'SELECT authuserid FROM iam.users WHERE userid = $1',
      [toUserPk(user.id)]
    );
    if (existing.rows[0]?.authuserid) {
      res.status(409).json({ success: false, message: 'This account already has a linked Supabase identity. Try signing in directly.' });
      return;
    }

    const supabase = getSupabaseServiceClient();
    const created = await supabase.auth.admin.createUser({
      email: email.trim().toLowerCase(),
      password,
      email_confirm: true,
      user_metadata: { username: user.username, full_name: user.name }
    });

    if (created.error) {
      console.error('[Migrate Legacy] Supabase createUser failed:', created.error.message);
      res.status(502).json({ success: false, message: 'Authentication service is temporarily unavailable. Please try again.' });
      return;
    }

    const authUserId = created.data.user.id;

    await query(
      'UPDATE iam.users SET authuserid = $1, updatedatutc = CURRENT_TIMESTAMP WHERE userid = $2',
      [authUserId, toUserPk(user.id)]
    );

    recordActivitySafe({
      actorId: user.id,
      actorName: user.name,
      actorEmail: user.email,
      actorRole: user.role,
      action: 'Migrated to Supabase Auth',
      module: 'Authentication',
      entityType: 'User',
      entityId: user.id,
      entityName: user.name,
      description: `${user.name} migrated from legacy credentials to Supabase Auth.`,
    });

    res.status(200).json({ success: true, message: 'Credentials migrated to Supabase Auth. Please sign in again.' });
  } catch (error: any) {
    console.error('[Migrate Legacy] Error:', error?.message || error);
    res.status(500).json({ success: false, message: 'Migration failed. Please contact an administrator.' });
  }
});

// GET /api/auth/role-status
router.get('/role-status', async (_req, res: Response): Promise<void> => {
  await userStore.syncUsersToDb();
  res.status(200).json({
    success: true,
    hasAdmin: userStore.hasRole('Admin'),
    hasHR: userStore.hasRole('HR')
  });
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
// Admin-only direct edit. HR/Lead/Member must submit an account change request.
router.put('/profile/display-name', authenticateJWT, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      return void res.status(401).json({ success: false, message: 'Not authenticated.' });
    }

    if (req.user.role !== 'Admin') {
      return void res.status(403).json({
        success: false,
        message: 'Direct display name editing is restricted to Administrators. Please submit an account change request from your profile.'
      });
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

// PUT /api/auth/profile/username
// Admin-only direct edit. HR/Lead/Member must submit an account change request.
router.put('/profile/username', authenticateJWT, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      return void res.status(401).json({ success: false, message: 'Not authenticated.' });
    }

    if (req.user.role !== 'Admin') {
      return void res.status(403).json({
        success: false,
        message: 'Direct username editing is restricted to Administrators. Please submit an account change request from your profile.'
      });
    }

    const { username } = req.body;

    if (!username || typeof username !== 'string') {
      return void res.status(400).json({ success: false, message: 'Username is required.' });
    }

    const normalizedUsername = username.replace(/<[^>]*>/g, '').trim().toLowerCase();

    if (normalizedUsername.length < 3) {
      return void res.status(400).json({ success: false, message: 'Username must be at least 3 characters long.' });
    }

    if (normalizedUsername.length > 80) {
      return void res.status(400).json({ success: false, message: 'Username must not exceed 80 characters.' });
    }

    if (!/^[a-z0-9][a-z0-9._-]+$/.test(normalizedUsername)) {
      return void res.status(400).json({ success: false, message: 'Username can only contain letters, numbers, dots, hyphens, and underscores.' });
    }

    const updatedUser = await userStore.updateUsername(req.user.id, normalizedUsername);

    return void res.status(200).json({
      success: true,
      message: 'Username updated successfully.',
      user: updatedUser
    });
  } catch (error: any) {
    const message = error?.message || 'Failed to update username.';
    return void res.status(message.includes('already in use') ? 409 : 500).json({ success: false, message });
  }
});

// PUT /api/auth/profile/email
// Admin-only direct edit. HR/Lead/Member must submit an account change request.
router.put('/profile/email', authenticateJWT, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      return void res.status(401).json({ success: false, message: 'Not authenticated.' });
    }

    if (req.user.role !== 'Admin') {
      return void res.status(403).json({
        success: false,
        message: 'Direct email editing is restricted to Administrators. Please submit an account change request from your profile.'
      });
    }

    const { email } = req.body;

    if (!email || typeof email !== 'string') {
      return void res.status(400).json({ success: false, message: 'Email is required.' });
    }

    const normalizedEmail = email.replace(/<[^>]*>/g, '').trim().toLowerCase();

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      return void res.status(400).json({ success: false, message: 'A valid email address is required.' });
    }

    const updatedUser = await userStore.updateEmail(req.user.id, normalizedEmail);

    return void res.status(200).json({
      success: true,
      message: 'Email updated successfully.',
      user: updatedUser
    });
  } catch (error: any) {
    const message = error?.message || 'Failed to update email.';
    return void res.status(message.includes('already exists') ? 409 : 500).json({ success: false, message });
  }
});

// PUT /api/auth/profile/password
// Admin-only direct edit. HR/Lead/Member must submit an account change request.
router.put('/profile/password', authenticateJWT, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Not authenticated.' });
      return;
    }

    if (req.user.role !== 'Admin') {
      res.status(403).json({
        success: false,
        message: 'Direct password changing is restricted to Administrators. Please submit an account change request from your profile.'
      });
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

// POST /api/auth/users
router.post('/users', authenticateJWT, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (!req.user || !canManageAccounts(req.user.role)) {
      res.status(403).json({ success: false, message: 'Admin or HR access required.' });
      return;
    }

    const { name, username, email, password, role, department, title } = req.body;
    if (!name || !username || !email || !role || !department || !title) {
      res.status(400).json({ success: false, message: 'Name, username, email, role, department, and title are required.' });
      return;
    }
    if (req.user.role === 'HR' && role === 'Admin') {
      res.status(403).json({ success: false, message: 'HR cannot create Administrator accounts.' });
      return;
    }

    const resolvedPassword = typeof password === 'string' && password.trim().length >= 6
      ? password
      : DEFAULT_TEMPORARY_ACCOUNT_PASSWORD;

    const newUser = await userStore.createUser({
      name: String(name).trim(),
      username: String(username).trim().toLowerCase(),
      email: String(email).trim().toLowerCase(),
      password: resolvedPassword,
      role,
      department: String(department).trim(),
      title: String(title).trim(),
    });

    res.status(201).json({ success: true, message: 'Account created successfully.', user: userStore.sanitizeUser(newUser) });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error?.message || 'Failed to create account.' });
  }
});

// PUT /api/auth/users/:id
router.put('/users/:id', authenticateJWT, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (!req.user || !canManageAccounts(req.user.role)) {
      res.status(403).json({ success: false, message: 'Admin or HR access required.' });
      return;
    }

    const targetUser = userStore.findById(req.params.id);
    if (!targetUser) {
      res.status(404).json({ success: false, message: 'User not found.' });
      return;
    }
    if (req.user.role === 'HR' && (targetUser.role === 'Admin' || req.body?.role === 'Admin')) {
      res.status(403).json({ success: false, message: 'HR cannot edit Administrator roles.' });
      return;
    }

    const updatedUser = await userStore.updateManagedUser(req.params.id, req.body || {}, req.user.id);
    res.status(200).json({ success: true, message: 'Account updated successfully.', user: updatedUser });
  } catch (error: any) {
    const message = error?.message || 'Failed to update account.';
    const status = message === 'User not found.' ? 404 : 400;
    res.status(status).json({ success: false, message });
  }
});

// PATCH /api/auth/users/:id/deactivate
router.patch('/users/:id/deactivate', authenticateJWT, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (!req.user || !canManageAccounts(req.user.role)) {
      res.status(403).json({ success: false, message: 'Admin or HR access required.' });
      return;
    }

    const targetUser = userStore.findById(req.params.id);
    if (!targetUser) {
      res.status(404).json({ success: false, message: 'User not found.' });
      return;
    }
    if (req.user.role === 'HR' && targetUser.role === 'Admin') {
      res.status(403).json({ success: false, message: 'HR cannot deactivate Administrator accounts.' });
      return;
    }

    const updatedUser = await userStore.deactivateManagedUser(req.params.id);
    res.status(200).json({ success: true, message: 'Account deactivated successfully.', user: updatedUser });
  } catch (error: any) {
    const message = error?.message || 'Failed to deactivate account.';
    const status = message === 'User not found.' ? 404 : 400;
    res.status(status).json({ success: false, message });
  }
});

// PATCH /api/auth/users/:id/reactivate
router.patch('/users/:id/reactivate', authenticateJWT, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (!req.user || !canManageAccounts(req.user.role)) {
      res.status(403).json({ success: false, message: 'Admin or HR access required.' });
      return;
    }

    const updatedUser = await userStore.reactivateManagedUser(req.params.id);
    res.status(200).json({ success: true, message: 'Account reactivated successfully.', user: updatedUser });
  } catch (error: any) {
    const message = error?.message || 'Failed to reactivate account.';
    const status = message === 'User not found.' ? 404 : 400;
    res.status(status).json({ success: false, message });
  }
});

// DELETE /api/auth/users/:id
router.delete('/users/:id', authenticateJWT, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (!req.user || !canManageAccounts(req.user.role)) {
      res.status(403).json({ success: false, message: 'Admin or HR access required.' });
      return;
    }

    await userStore.deleteManagedUser(req.params.id);
    res.status(200).json({ success: true, message: 'Account deleted successfully.' });
  } catch (error: any) {
    const message = error?.message || 'Failed to delete account.';
    const status = message === 'User not found.' ? 404 : 400;
    res.status(status).json({ success: false, message });
  }
});

export default router;
