import { Request, Response, NextFunction } from 'express';

interface AttemptEntry {
  count: number;
  resetAt: number;
}

const attempts = new Map<string, AttemptEntry>();

const CLEANUP_INTERVAL = 60_000;
const WINDOW_MS = 60_000;
const MAX_ATTEMPTS = 5;

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of attempts) {
    if (now >= entry.resetAt) {
      attempts.delete(key);
    }
  }
}, CLEANUP_INTERVAL);

export const loginRateLimiter = (req: Request, res: Response, next: NextFunction): void => {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const entry = attempts.get(ip);

  if (!entry || now >= entry.resetAt) {
    attempts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    next();
    return;
  }

  entry.count++;
  if (entry.count > MAX_ATTEMPTS) {
    res.status(429).json({
      success: false,
      message: 'Too many login attempts. Please try again in 60 seconds.'
    });
    return;
  }

  next();
};

export const resetLoginAttempts = (ip: string): void => {
  attempts.delete(ip);
};
