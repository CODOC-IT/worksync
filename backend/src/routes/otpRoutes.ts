import { Router, Response } from 'express';
import { otpStore } from '../store/otpStore.js';
import { sendOTPEmail, isEmailConfigured } from '../services/emailService.js';
import { userStore } from '../store/userStore.js';
import { UserRole } from '../types.js';

const router = Router();

// POST /api/otp/send
// Body: { email, name }
router.post('/send', async (req, res: Response): Promise<void> => {
  try {
    const { email, name } = req.body;

    if (!isEmailConfigured()) {
      res.status(503).json({ success: false, message: 'Email service is not configured. Please add your Gmail App Password (SMTP_PASS) to your .env file.' });
      return;
    }

    if (!email || !name) {
      res.status(400).json({ success: false, message: 'Email and name are required.' });
      return;
    }

    // Email format check
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      res.status(400).json({ success: false, message: 'Invalid email address format.' });
      return;
    }

    // Check 60s resend cooldown
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
    await sendOTPEmail(email, name, otp);

    res.status(200).json({
      success: true,
      message: `Verification code sent to ${email}. Valid for 10 minutes.`
    });
  } catch (error: any) {
    console.error('[OTP Send Error]', error.message);
    res.status(400).json({ success: false, message: error.message || 'Failed to send verification email. Please try again.' });
  }
});

// POST /api/otp/verify
// Body: { email, otp, name, password, role, department, title }
router.post('/verify', async (req, res: Response): Promise<void> => {
  try {
    const { email, otp, name, password, role, department, title } = req.body;

    if (!email || !otp) {
      res.status(400).json({ success: false, message: 'Email and OTP are required.' });
      return;
    }

    const result = otpStore.verify(email, otp);
    if (!result.valid) {
      res.status(400).json({ success: false, message: result.reason });
      return;
    }

    // If registration data provided, create the user account now
    if (name && password && role && department) {
      try {
        const newUser = userStore.createUser({
          name,
          email,
          password,
          role: role as UserRole,
          department,
          title
        });

        import('../middleware/authMiddleware.js').then(({ getJwtSecret, JWT_EXPIRES_IN }) => {
          import('jsonwebtoken').then((jwt) => {
            const token = jwt.default.sign(
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
          });
        });
        return;
      } catch (err: any) {
        res.status(400).json({ success: false, message: err.message });
        return;
      }
    }

    // If only verifying email (login use-case)
    res.status(200).json({ success: true, message: 'OTP verified successfully.' });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message || 'OTP verification failed.' });
  }
});

// GET /api/otp/resend-status?email=...
router.get('/resend-status', (req, res: Response): void => {
  const email = req.query.email as string;
  if (!email) {
    res.status(400).json({ success: false, message: 'Email query parameter required.' });
    return;
  }
  const { allowed, secondsLeft } = otpStore.canResend(email);
  res.status(200).json({ success: true, allowed, secondsLeft });
});

export default router;
