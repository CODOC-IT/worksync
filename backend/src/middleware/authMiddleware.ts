import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';

export const getJwtSecret = (): string => {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    console.error(
      '\n[FATAL SECURITY ERROR] JWT_SECRET is missing or shorter than 32 characters.\n' +
      'Please configure JWT_SECRET in your .env file with a secure random key.\n'
    );
    if (process.env.NODE_ENV !== 'test') {
      process.exit(1);
    }
  }
  return secret || '';
};

export const validateAuthConfig = (): void => {
  const secret = getJwtSecret();
  const maskedSecret = secret.substring(0, 4) + '•'.repeat(Math.max(0, secret.length - 4));
  console.log(`[Auth] JWT_SECRET validated & loaded: ${maskedSecret} ✓`);
};

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
    role: string;
  };
}

export const authenticateJWT = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void => {
  const authHeader = req.headers.authorization;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    const secret = getJwtSecret();

    jwt.verify(token, secret, (err, payload) => {
      if (err) {
        res.status(403).json({ success: false, message: 'Invalid or expired token.' });
        return;
      }
      req.user = payload as AuthenticatedRequest['user'];
      next();
    });
  } else {
    res.status(401).json({ success: false, message: 'Authorization header with Bearer token required.' });
  }
};
