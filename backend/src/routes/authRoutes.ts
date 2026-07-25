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

// POST /api/auth/logout
router.post('/logout', authenticateJWT, (_req, res: Response): void => {
  res.status(200).json({ success: true, message: 'Logout successful.' });
});

export default router;
