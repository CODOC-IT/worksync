import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export const JWT_SECRET = process.env.JWT_SECRET || 'worksync-secret-key-super-secure-2026';

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

    jwt.verify(token, JWT_SECRET, (err, payload) => {
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
