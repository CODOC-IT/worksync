import { Router, Response } from 'express';
import jwt from 'jsonwebtoken';
import { otpStore } from '../store/otpStore.js';
import { sendOTPEmail, isEmailConfigured } from '../services/emailService.js';
import { userStore } from '../store/userStore.js';
import { getJwtSecret, JWT_EXPIRES_IN } from '../middleware/authMiddleware.js';
import { getPasswordPolicyError } from '../utils/passwordPolicy.js';

const router = Router();

// POST /api/otp/send
// Body: { email, name }
router.post('/send', async (req, res: Response): Promise<void> => {
  try {
    const { email, name } = req.body;

    if (!isEmailConfigured()) {
      res.status(503).json({ success: false, message: 'Email service is not configured.' });
      return;
    }

    if (!email || !name) {
      res.status(400).json({ success: false, message: 'Email and name are required.' });
      return;
    }

    if (name.trim().length < 4) {
      res.status(400).json({ success: false, message: 'Full Name must be at least 4 characters long.' });
      return;
    }

    const nameParts = name.trim().split(/\s+/).filter(Boolean);
    if (nameParts.length < 2) {
      res.status(400).json({ success: false, message: 'Full Name must include both first and last name (e.g. "John Doe").' });
      return;
    }

    if (nameParts[0].toLowerCase() === nameParts[nameParts.length - 1].toLowerCase()) {
      res.status(400).json({ success: false, message: 'First name and last name cannot be the same.' });
      return;
    }

    // Email format check
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    if (!emailRegex.test(email.trim())) {
      res.status(400).json({ success: false, message: 'Invalid email address format (e.g. user@domain.com).' });
      return;
    }

    // Return the same response for existing and eligible addresses to prevent account enumeration.
    const existingUser = await userStore.findByEmailAsync(email.trim().toLowerCase());
    if (existingUser) {
      res.status(200).json({
        success: true,
        message: 'If this address is eligible, a verification code has been sent.'
      });
      return;
    }

    const { allowed } = otpStore.canResend(email);
    if (!allowed) {
      res.status(200).json({
        success: true,
        message: 'If this address is eligible, a verification code has been sent.'
      });
      return;
    }

    const otp = otpStore.generate(email);
    await sendOTPEmail(email, name, otp);

    res.status(200).json({
      success: true,
      message: 'If this address is eligible, a verification code has been sent.'
    });
  } catch (error: any) {
    console.error('[OTP Send Error]', error.message);
    res.status(500).json({ success: false, message: 'Failed to send verification email. Please try again.' });
  }
});

// POST /api/otp/verify
// Body: { email, otp, name, password, department, title, purpose }
// When purpose='password_reset', returns a resetToken instead of creating user
router.post('/verify', async (req, res: Response): Promise<void> => {
  try {
    const { email, otp, name, password, department, title, purpose } = req.body;

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

    // If registration data provided, create the user account now
    if (name && password && department) {
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

        const passwordPolicyError = getPasswordPolicyError(password);
        if (passwordPolicyError) {
          res.status(400).json({ success: false, message: passwordPolicyError });
          return;
        }

        const newUser = await userStore.createUser({
          name: sanitizedName,
          email,
          password,
          role: 'Team_Member',
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
