import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { userStore } from '../store/userStore.js';
import { authenticateJWT, AuthenticatedRequest, getJwtSecret, JWT_EXPIRES_IN } from '../middleware/authMiddleware.js';
import { loginRateLimiter, resetLoginAttempts } from '../middleware/rateLimiter.js';
import { recordActivity, recordActivitySafe } from '../activity/activity.service.js';
import { sendAccountUpdateEmail } from '../services/emailService.js';
import { getSupabaseServiceClient } from '../db/supabase.js';
import { query } from '../db/pool.js';
import { toUserPk } from '../utils/idMapping.js';
import { getEffectiveRoles } from '../auth/effectiveRoles.js';
import { canAuthenticateAccount } from '../auth/accountAccess.js';
import { isStrongPassword, PASSWORD_POLICY_MESSAGE } from '../accounts/accounts.validation.js';

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

    if (!canAuthenticateAccount(user)) {
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

    if (!canAuthenticateAccount(user)) {
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

    // Supabase/Postgres is authoritative. A newly provisioned account may not exist in this
    // process's in-memory roster yet, so resolve the authenticated profile directly from the DB.
    const user = await userStore.refreshUserFromDb(req.user.id);
    if (!user) {
      res.status(404).json({ success: false, message: 'User profile not found.' });
      return;
    }

    res.status(200).json({
      success: true,
      user
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
    // Always reload the authoritative Supabase roster. Account provisioning writes directly to
    // iam.users and must be visible immediately on every process/serverless instance.
    await userStore.syncUsersToDb();
    const users = await Promise.all((await userStore.getAllUsers()).map(async (u) => {
      const safe = userStore.sanitizeUser(u);
      const effective = await getEffectiveRoles(u.id);
      return {
        ...safe,
        activePermissions: {
          teamLead: effective.isActiveTeamLead,
          hr: effective.isActiveHR
        }
      };
    }));
    res.status(200).json({ success: true, users });
  } catch {
    res.status(500).json({ success: false, message: 'Failed to load users.' });
  }
});

// POST /api/auth/audit-login
// The browser signs in directly against Supabase (signInWithPassword), so the Express /login
// route never runs for successful logins. The frontend reports a successful sign-in here once
// per login so Login events reach the audit log with the caller's authoritative role. The
// audit write is awaited so serverless deployments cannot drop the event when the response
// returns before the async insert completes.
router.post('/audit-login', authenticateJWT, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (req.user) {
      const user = req.user ? userStore.findById(req.user.id) : undefined;
      await recordActivity({ actorId: req.user.id, actorName: user?.name, actorEmail: req.user.email,
        actorRole: req.user.role, action: 'Login', module: 'Authentication', entityType: 'User',
        entityId: req.user.id, entityName: user?.name, description: `${user?.name || req.user.email} signed in.`,
        result: 'Successful', source: 'Web', ipAddress: req.ip || req.socket.remoteAddress });
    }
  } catch (error) {
    console.warn('[auth] Login audit write failed.', error);
  }
  res.status(200).json({ success: true, message: 'Login activity recorded.' });
});

// POST /api/auth/logout
router.post('/logout', authenticateJWT, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (req.user) {
      const user = req.user ? userStore.findById(req.user.id) : undefined;
      await recordActivity({ actorId: req.user.id, actorName: user?.name, actorEmail: req.user.email,
        actorRole: req.user.role, action: 'Logout', module: 'Authentication', entityType: 'User',
        entityId: req.user.id, entityName: user?.name, description: `${user?.name || req.user.email} signed out.`,
        source: 'Web', ipAddress: req.ip || req.socket.remoteAddress });
    }
  } catch (error) {
    console.warn('[auth] Logout audit write failed.', error);
  }
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

    const previousUser = userStore.findById(req.user.id);
    const updatedUser = await userStore.updateDisplayName(req.user.id, sanitizedName);

    recordActivitySafe({
      actorId: req.user.id,
      actorName: previousUser?.name || req.user.email,
      actorEmail: req.user.email,
      actorRole: req.user.role,
      affectedUserId: req.user.id,
      affectedUserName: updatedUser?.name || sanitizedName,
      action: 'Display Name Updated',
      module: 'Profile',
      entityType: 'User',
      entityId: req.user.id,
      entityName: updatedUser?.name || sanitizedName,
      description: `${previousUser?.name || req.user.email} changed their display name from "${previousUser?.name || ''}" to "${sanitizedName}".`,
      changes: [{ field: 'Display Name', previousValue: previousUser?.name || null, newValue: sanitizedName }],
      source: 'Web',
      metadata: { field: 'displayName' },
    });

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

    const previousUser = userStore.findById(req.user.id);
    const updatedUser = await userStore.updateUsername(req.user.id, normalizedUsername);

    recordActivitySafe({
      actorId: req.user.id,
      actorName: previousUser?.name || req.user.email,
      actorEmail: req.user.email,
      actorRole: req.user.role,
      affectedUserId: req.user.id,
      affectedUserName: updatedUser?.name || previousUser?.name,
      action: 'Username Updated',
      module: 'Profile',
      entityType: 'User',
      entityId: req.user.id,
      entityName: updatedUser?.name || previousUser?.name,
      description: `${previousUser?.name || req.user.email} changed their username from "${previousUser?.username || ''}" to "${normalizedUsername}".`,
      changes: [{ field: 'Username', previousValue: previousUser?.username || null, newValue: normalizedUsername }],
      source: 'Web',
      metadata: { field: 'username' },
    });

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

    const previousUser = userStore.findById(req.user.id);
    const updatedUser = await userStore.updateEmail(req.user.id, normalizedEmail);

    recordActivitySafe({
      actorId: req.user.id,
      actorName: previousUser?.name || req.user.email,
      actorEmail: req.user.email,
      actorRole: req.user.role,
      affectedUserId: req.user.id,
      affectedUserName: updatedUser?.name || previousUser?.name,
      action: 'Email Updated',
      module: 'Profile',
      entityType: 'User',
      entityId: req.user.id,
      entityName: updatedUser?.name || previousUser?.name,
      description: `${previousUser?.name || req.user.email} changed their email from "${previousUser?.email || ''}" to "${normalizedEmail}".`,
      changes: [{ field: 'Email', previousValue: previousUser?.email || null, newValue: normalizedEmail }],
      source: 'Web',
      metadata: { field: 'email' },
    });

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

    await userStore.updatePassword(user.email, newPassword);

    recordActivitySafe({
      actorId: req.user.id,
      actorName: user.name,
      actorEmail: req.user.email,
      actorRole: req.user.role,
      affectedUserId: req.user.id,
      affectedUserName: user.name,
      action: 'Password Updated',
      module: 'Profile',
      entityType: 'User',
      entityId: req.user.id,
      entityName: user.name,
      description: `${user.name} changed their account password.`,
      changes: [{ field: 'Password', previousValue: null, newValue: '••••••' }],
      source: 'Web',
      metadata: { field: 'password' },
    });

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
    if (role === 'Team_Lead') {
      res.status(400).json({ success: false, message: 'Team Lead assignment must be managed from the Projects section.' });
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

    const actorName = userStore.findById(req.user.id)?.name || req.user.email;
    recordActivitySafe({
      actorId: req.user.id,
      actorName,
      actorEmail: req.user.email,
      actorRole: req.user.role,
      affectedUserId: newUser.id,
      affectedUserName: newUser.name,
      action: 'Account Created',
      module: 'Authentication',
      entityType: 'User',
      entityId: newUser.id,
      entityName: newUser.name,
      description: `${actorName} created account for ${newUser.name} (${newUser.email}) with the ${newUser.role.replace('_', ' ')} role.`,
      source: 'Web',
      important: true,
      metadata: { role: newUser.role, department: newUser.department, title: newUser.title, email: newUser.email },
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
    if (req.user.role === 'HR') {
      const editingSelf = req.params.id === req.user.id;
      if (!editingSelf && (targetUser.role === 'Admin' || targetUser.role === 'HR')) {
        res.status(403).json({ success: false, message: 'HR can only edit their own profile or member accounts.' });
        return;
      }
      if (req.body?.role && req.body.role !== targetUser.role) {
        res.status(403).json({ success: false, message: 'HR cannot change roles.' });
        return;
      }
    }
    if ((req.body?.role === 'Team_Lead' && targetUser.role !== 'Team_Lead') || (targetUser.role === 'Team_Lead' && req.body?.role && req.body.role !== 'Team_Lead')) {
      res.status(400).json({ success: false, message: 'Team Lead assignment must be managed from the Projects section.' });
      return;
    }

    const nextPassword = typeof req.body?.password === 'string' ? req.body.password.trim() : '';
    const confirmPassword = typeof req.body?.confirmPassword === 'string' ? req.body.confirmPassword.trim() : '';
    if (nextPassword || confirmPassword) {
      const targetIsMember = targetUser.role === 'Team_Member' || targetUser.role === 'Team_Lead';
      const adminCanManagePassword = req.user.role === 'Admin' && (targetIsMember || targetUser.role === 'HR');
      const hrCanManagePassword = req.user.role === 'HR' && targetIsMember;
      if (!adminCanManagePassword && !hrCanManagePassword) {
        res.status(403).json({ success: false, message: 'Managed password changes are limited to Member and Team Lead accounts, or HR accounts when updated by an Administrator.' });
        return;
      }
      if (!isStrongPassword(nextPassword)) {
        res.status(400).json({ success: false, message: `New password must meet the policy: ${PASSWORD_POLICY_MESSAGE}` });
        return;
      }
      if (nextPassword !== confirmPassword) {
        res.status(400).json({ success: false, message: 'Password confirmation does not match.' });
        return;
      }
    }

    const updatedUser = await userStore.updateManagedUser(req.params.id, req.body || {}, req.user.id);

    if (nextPassword) {
      await userStore.updatePassword(updatedUser.email, nextPassword);
    }

    const actorName = userStore.findById(req.user.id)?.name || req.user.email;
    const changes = [
      targetUser.name !== updatedUser.name ? { field: 'Display Name', previousValue: targetUser.name, newValue: updatedUser.name } : null,
      targetUser.email !== updatedUser.email ? { field: 'Email', previousValue: targetUser.email, newValue: updatedUser.email } : null,
      targetUser.role !== updatedUser.role ? { field: 'Role', previousValue: targetUser.role, newValue: updatedUser.role } : null,
      targetUser.department !== updatedUser.department ? { field: 'Department', previousValue: targetUser.department, newValue: updatedUser.department } : null,
      targetUser.title !== updatedUser.title ? { field: 'Title', previousValue: targetUser.title, newValue: updatedUser.title } : null,
      nextPassword ? { field: 'Password', previousValue: null, newValue: '••••••' } : null,
    ].filter((c): c is { field: string; previousValue: string | null; newValue: string | null } => c !== null);

    recordActivitySafe({
      actorId: req.user.id,
      actorName,
      actorEmail: req.user.email,
      actorRole: req.user.role,
      affectedUserId: updatedUser.id,
      affectedUserName: updatedUser.name,
      action: 'Account Updated',
      module: 'Authentication',
      entityType: 'User',
      entityId: updatedUser.id,
      entityName: updatedUser.name,
      description: changes.length
        ? `${actorName} updated ${targetUser.name}'s account (${changes.map(c => c.field).join(', ')}).`
        : `${actorName} updated ${targetUser.name}'s account.`,
      source: 'Web',
      important: true,
      changes,
    });

    let message = 'Account updated successfully.';
    try {
      const displayRole = (role: string): string => role === 'Team_Member' ? 'Team Member' : role.replace('_', ' ');
      await sendAccountUpdateEmail({
        toEmail: updatedUser.email,
        recipientName: updatedUser.name,
        role: displayRole(updatedUser.role),
        department: updatedUser.department,
        title: updatedUser.title,
        changedBy: req.user.email,
        password: nextPassword || undefined,
        previous: {
          name: targetUser.name,
          email: targetUser.email,
          role: displayRole(targetUser.role),
          department: targetUser.department,
          title: targetUser.title
        },
      });
    } catch {
      message = 'Account updated, but the notification email could not be sent.';
    }

    res.status(200).json({ success: true, message, user: updatedUser });
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
    if (req.user.role === 'HR' && (targetUser.role === 'Admin' || targetUser.role === 'HR')) {
      res.status(403).json({ success: false, message: 'HR can only deactivate member accounts.' });
      return;
    }

    const updatedUser = await userStore.deactivateManagedUser(req.params.id);

    const actorName = userStore.findById(req.user.id)?.name || req.user.email;
    recordActivitySafe({
      actorId: req.user.id,
      actorName,
      actorEmail: req.user.email,
      actorRole: req.user.role,
      affectedUserId: targetUser.id,
      affectedUserName: targetUser.name,
      action: 'Account Deactivated',
      module: 'Authentication',
      entityType: 'User',
      entityId: targetUser.id,
      entityName: targetUser.name,
      description: `${actorName} deactivated ${targetUser.name}'s account.`,
      source: 'Web',
      important: true,
      changes: [{ field: 'Status', previousValue: 'Active', newValue: 'Deactivated' }],
    });

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

    const targetUser = userStore.findById(req.params.id);
    if (!targetUser) {
      res.status(404).json({ success: false, message: 'User not found.' });
      return;
    }
    if (req.user.role === 'HR' && (targetUser.role === 'Admin' || targetUser.role === 'HR')) {
      res.status(403).json({ success: false, message: 'HR can only reactivate member accounts.' });
      return;
    }

    const updatedUser = await userStore.reactivateManagedUser(req.params.id);

    const actorName = userStore.findById(req.user.id)?.name || req.user.email;
    recordActivitySafe({
      actorId: req.user.id,
      actorName,
      actorEmail: req.user.email,
      actorRole: req.user.role,
      affectedUserId: targetUser.id,
      affectedUserName: targetUser.name,
      action: 'Account Reactivated',
      module: 'Authentication',
      entityType: 'User',
      entityId: targetUser.id,
      entityName: targetUser.name,
      description: `${actorName} reactivated ${targetUser.name}'s account.`,
      source: 'Web',
      important: true,
      changes: [{ field: 'Status', previousValue: 'Deactivated', newValue: 'Active' }],
    });

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

    const targetUser = userStore.findById(req.params.id);
    if (!targetUser) {
      res.status(404).json({ success: false, message: 'User not found.' });
      return;
    }
    if (req.user.role === 'HR' && (targetUser.role === 'Admin' || targetUser.role === 'HR')) {
      res.status(403).json({ success: false, message: 'HR cannot delete Administrator or HR accounts.' });
      return;
    }

    await userStore.deleteManagedUser(req.params.id);

    const actorName = userStore.findById(req.user.id)?.name || req.user.email;
    recordActivitySafe({
      actorId: req.user.id,
      actorName,
      actorEmail: req.user.email,
      actorRole: req.user.role,
      affectedUserId: targetUser.id,
      affectedUserName: targetUser.name,
      action: 'Account Deleted',
      module: 'Authentication',
      entityType: 'User',
      entityId: targetUser.id,
      entityName: targetUser.name,
      description: `${actorName} deleted ${targetUser.name}'s account (${targetUser.email}).`,
      source: 'Web',
      important: true,
      metadata: { deletedEmail: targetUser.email },
    });

    res.status(200).json({ success: true, message: 'Account deleted successfully.' });
  } catch (error: any) {
    const message = error?.message || 'Failed to delete account.';
    const status = message === 'User not found.' ? 404 : 400;
    res.status(status).json({ success: false, message });
  }
});

export default router;
