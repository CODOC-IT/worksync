import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { userStore } from '../store/userStore.js';
import { authenticateJWT, AuthenticatedRequest, getJwtSecret, JWT_EXPIRES_IN } from '../middleware/authMiddleware.js';
import { loginRateLimiter, resetLoginAttempts } from '../middleware/rateLimiter.js';

const router = Router();

// POST /api/auth/login
router.post('/login', loginRateLimiter, async (req, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;
    const ip = req.ip || req.socket.remoteAddress || 'unknown';

    if (!email || !password) {
      res.status(400).json({ success: false, message: 'Email and password are required.' });
      return;
    }

    const user = userStore.findByEmail(email);
    if (!user) {
      res.status(401).json({ success: false, message: 'Invalid email or password.' });
      return;
    }

    if (user.status !== 'active') {
      res.status(403).json({ success: false, message: 'Account is deactivated. Contact administrator.' });
      return;
    }

    const isValidPassword = await bcrypt.compare(password, user.passwordHash);
    if (!isValidPassword) {
      res.status(401).json({ success: false, message: 'Invalid email or password.' });
      return;
    }

    resetLoginAttempts(ip);

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      getJwtSecret(),
      { expiresIn: JWT_EXPIRES_IN as any }
    );

    res.status(200).json({
      success: true,
      message: 'Login successful.',
      token,
      user: userStore.sanitizeUser(user)
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message || 'Internal server error.' });
  }
});

// GET /api/auth/role-status
router.get('/role-status', (_req, res: Response): void => {
  res.status(200).json({
    success: true,
    hasAdmin: userStore.hasRole('Admin'),
    hasHR: userStore.hasRole('HR')
  });
});

// POST /api/auth/register
router.post('/register', async (req, res: Response): Promise<void> => {
  try {
    const { name, email, password, role, department, title } = req.body;

    if (!name || !email || !password || !role || !department) {
      res.status(400).json({
        success: false,
        message: 'Name, email, password, role, and department are required.'
      });
      return;
    }

    const sanitizedName = name.replace(/<[^>]*>/g, '').trim();

    if (sanitizedName.length < 4) {
      res.status(400).json({ success: false, message: 'Full Name must be at least 4 characters long.' });
      return;
    }

    const nameParts = sanitizedName.split(/\s+/).filter(Boolean);
    if (nameParts.length < 2) {
      res.status(400).json({ success: false, message: 'Full Name must include both first and last name (e.g. "John Doe").' });
      return;
    }

    if (nameParts[0].toLowerCase() === nameParts[nameParts.length - 1].toLowerCase()) {
      res.status(400).json({ success: false, message: 'First name and last name cannot be the same.' });
      return;
    }

    if (userStore.findByName(sanitizedName)) {
      res.status(409).json({
        success: false,
        message: `The name "${sanitizedName}" is already registered. Please choose a different name.`
      });
      return;
    }

    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    if (!emailRegex.test(email)) {
      res.status(400).json({ success: false, message: 'Invalid email address format (e.g. user@domain.com).' });
      return;
    }

    if (role === 'Admin' && userStore.hasRole('Admin')) {
      res.status(409).json({
        success: false,
        message: 'An Administrator account already exists in this organization. Only one Admin is permitted.'
      });
      return;
    }

    if (role === 'HR' && userStore.hasRole('HR')) {
      res.status(409).json({
        success: false,
        message: 'An HR Specialist account already exists in this organization. Only one HR is permitted.'
      });
      return;
    }

    if (password.length < 6) {
      res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters long.'
      });
      return;
    }

    const newUser = userStore.createUser({ name: sanitizedName, email, password, role, department, title });

    const token = jwt.sign(
      { id: newUser.id, email: newUser.email, role: newUser.role },
      getJwtSecret(),
      { expiresIn: JWT_EXPIRES_IN as any }
    );

    res.status(201).json({
      success: true,
      message: 'Registration successful.',
      token,
      user: userStore.sanitizeUser(newUser)
    });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message || 'Registration failed.' });
  }
});

// POST /api/auth/forgot-password
// Body: { email }
// Sends OTP to the user's email if account exists (don't reveal whether it exists)
router.post('/forgot-password', async (req, res: Response): Promise<void> => {
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

    const user = userStore.findByEmail(email.trim().toLowerCase());

    if (user && user.status === 'active') {
      const { otpStore } = await import('../store/otpStore.js');
      const { sendOTPEmail, isEmailConfigured } = await import('../services/emailService.js');

      if (!isEmailConfigured()) {
        res.status(503).json({ success: false, message: 'Email service is not configured.' });
        return;
      }

      const { allowed, secondsLeft } = otpStore.canResend(email);
      if (!allowed) {
        res.status(429).json({
          success: false,
          message: `Please wait ${secondsLeft} seconds before requesting a new OTP.`,
          secondsLeft
        });
        return;
      }

      const otp = otpStore.generate(email);
      await sendOTPEmail(email, user.name, otp);
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
  try {
    const { resetToken, newPassword } = req.body;

    if (!resetToken || !newPassword) {
      res.status(400).json({ success: false, message: 'Reset token and new password are required.' });
      return;
    }

    if (newPassword.length < 6) {
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

    const user = userStore.findByEmail(payload.email);
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
    userStore.updatePassword(payload.email, newHash);

    res.status(200).json({ success: true, message: 'Password updated successfully. Please sign in with your new password.' });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message || 'Failed to update password.' });
  }
});

// GET /api/auth/me
router.get('/me', authenticateJWT, (req: AuthenticatedRequest, res: Response): void => {
  if (!req.user) {
    res.status(401).json({ success: false, message: 'Not authenticated.' });
    return;
  }

  const user = userStore.findById(req.user.id);
  if (!user) {
    res.status(404).json({ success: false, message: 'User profile not found.' });
    return;
  }

  res.status(200).json({
    success: true,
    user: userStore.sanitizeUser(user)
  });
});

// GET /api/auth/users
router.get('/users', (_req, res: Response): void => {
  const users = userStore.getAllUsers().map((u) => userStore.sanitizeUser(u));
  res.status(200).json({ success: true, users });
});

// GET /api/auth/check-email?email=...
router.get('/check-email', (req, res: Response): void => {
  const email = req.query.email as string;
  if (!email) {
    res.status(400).json({ success: false, message: 'Email query parameter required.' });
    return;
  }
  const user = userStore.findByEmail(email.trim().toLowerCase());
  res.status(200).json({ success: true, exists: !!user });
});

// POST /api/auth/logout
router.post('/logout', authenticateJWT, (_req, res: Response): void => {
  res.status(200).json({ success: true, message: 'Logout successful.' });
});

// PUT /api/auth/profile/display-name
router.put('/profile/display-name', authenticateJWT, (req: AuthenticatedRequest, res: Response): void => {
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

    const updatedUser = userStore.updateDisplayName(req.user.id, sanitizedName);

    return void res.status(200).json({
      success: true,
      message: 'Display name updated successfully.',
      user: updatedUser
    });
  } catch (error: any) {
    return void res.status(500).json({ success: false, message: error.message || 'Failed to update display name.' });
  }
});

// PUT /api/auth/profile/avatar
router.put('/profile/avatar', authenticateJWT, (req: AuthenticatedRequest, res: Response): void => {
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

    const updatedUser = userStore.updateAvatar(req.user.id, avatar);

    return void res.status(200).json({
      success: true,
      message: 'Profile picture updated successfully.',
      user: updatedUser
    });
  } catch (error: any) {
    return void res.status(500).json({ success: false, message: error.message || 'Failed to update profile picture.' });
  }
});

export default router;
