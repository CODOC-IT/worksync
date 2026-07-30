import { Router, Response } from 'express';
import jwt from 'jsonwebtoken';
import { otpStore } from '../store/otpStore.js';
import { sendOTPEmail, isEmailConfigured } from '../services/emailService.js';
import { userStore } from '../store/userStore.js';
import { getJwtSecret, JWT_EXPIRES_IN } from '../middleware/authMiddleware.js';
import { UserRole } from '../types.js';

const router = Router();
router.use((_req, res: Response): void => {
  res.status(410).json({ success: false, message: 'Public OTP registration has been retired. Accounts are created by invitation.' });
});
const USER_ROLES: UserRole[] = ['Team_Member', 'Team_Lead', 'HR', 'Admin'];

const isUserRole = (role: unknown): role is UserRole =>
  typeof role === 'string' && USER_ROLES.includes(role as UserRole);

// POST /api/otp/send
// Body: { email, name, role }
router.post('/send', async (req, res: Response): Promise<void> => {
  try {
    const { email, name, role } = req.body;

    if (!isEmailConfigured()) {
      res.status(503).json({ success: false, message: 'Email service is not configured.' });
      return;
    }

    if (!email || !name || !isUserRole(role)) {
      res.status(400).json({ success: false, message: 'Email, name, and a valid role are required.' });
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();
    const sanitizedName = name.trim();

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

    await userStore.syncUsersToDb();

    if (userStore.findByName(sanitizedName)) {
      res.status(409).json({
        success: false,
        message: `The name "${sanitizedName}" is already registered. Please choose a different name.`
      });
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

    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    if (!emailRegex.test(normalizedEmail)) {
      res.status(400).json({ success: false, message: 'Invalid email address format (e.g. user@domain.com).' });
      return;
    }

    if (await userStore.findByEmailAsync(normalizedEmail)) {
      res.status(409).json({
        success: false,
        message: `An account with the email "${normalizedEmail}" already exists. Please sign in instead.`
      });
      return;
    }

    const { allowed, secondsLeft } = otpStore.canResend(normalizedEmail);
    if (!allowed) {
      res.status(429).json({
        success: false,
        message: `Please wait ${secondsLeft} seconds before requesting a new OTP.`,
        secondsLeft
      });
      return;
    }

    const otp = otpStore.generate(normalizedEmail);
    await sendOTPEmail(normalizedEmail, sanitizedName, otp);

    res.status(200).json({
      success: true,
      message: `Verification code sent to ${normalizedEmail}. Valid for 1 minute.`
    });
  } catch (error: any) {
    console.error('[OTP Send Error]', error.message);
    res.status(500).json({ success: false, message: 'Failed to send verification email. Please try again.' });
  }
});

// POST /api/otp/verify
// Body: { email, otp, name, password, role, department, title, purpose }
// When purpose='password_reset', returns a resetToken instead of creating user
router.post('/verify', async (req, res: Response): Promise<void> => {
  try {
    const { email, otp, name, password, role, department, title, purpose } = req.body;

    if (!email || !otp) {
      res.status(400).json({ success: false, message: 'Email and OTP are required.' });
      return;
    }

    const result = otpStore.verify(email, otp);
    if (!result.valid) {
      res.status(400).json({ success: false, message: result.reason });
      return;
    }

    // Password reset flow — return a short-lived reset token
    if (purpose === 'password_reset') {
      const resetToken = jwt.sign(
        { email: email.toLowerCase(), purpose: 'password_reset' },
        getJwtSecret(),
        { expiresIn: '10m' }
      );
      res.status(200).json({
        success: true,
        message: 'Email verified successfully.',
        resetToken
      });
      return;
    }

    const registrationRequested = Boolean(name || password || role || department || title);
    if (registrationRequested && (!name || !password || !department || !isUserRole(role))) {
      res.status(400).json({
        success: false,
        message: 'Name, password, role, and department are required for registration.'
      });
      return;
    }

    // If registration data provided, create the user account now
    if (registrationRequested && isUserRole(role)) {
      try {
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

        if (await userStore.findByEmailAsync(email)) {
          res.status(409).json({
            success: false,
            message: `An account with the email "${email}" already exists. Please sign in instead.`
          });
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

        if (typeof password !== 'string' || password.length < 6) {
          res.status(400).json({ success: false, message: 'Password must be at least 6 characters long.' });
          return;
        }

        const newUser = await userStore.createUser({
          name: sanitizedName,
          email,
          password,
          role,
          department,
          title
        });

        const token = jwt.sign(
          { id: newUser.id, email: newUser.email, role: newUser.role },
          getJwtSecret(),
          { expiresIn: JWT_EXPIRES_IN as any }
        );
        res.status(201).json({
          success: true,
          message: 'Email verified and account created successfully.',
          token,
          user: userStore.sanitizeUser(newUser)
        });
        return;
      } catch {
        res.status(400).json({ success: false, message: 'Unable to create account.' });
        return;
      }
    }

    // If only verifying email (login use-case)
    res.status(200).json({ success: true, message: 'OTP verified successfully.' });
  } catch {
    res.status(500).json({ success: false, message: 'OTP verification failed.' });
  }
});

export default router;
