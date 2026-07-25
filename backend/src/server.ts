import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import authRoutes from './routes/authRoutes.js';
import assistantRoutes from './routes/assistantRoutes.js';
import otpRoutes from './routes/otpRoutes.js';
import notificationRoutes from './notifications/notification.routes.js';
import { processEmailCandidates } from './notifications/notification.email.js';
import { isDatabaseConfigured } from './db/pool.js';
import { validateAuthConfig } from './middleware/authMiddleware.js';

dotenv.config();

// Fail-fast security checks on boot
validateAuthConfig();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json({ limit: '1mb' }));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/assistant', assistantRoutes);
app.use('/api/otp', otpRoutes);
app.use('/api/notifications', notificationRoutes);

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Global error handler (must be registered AFTER all routes)
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[Unhandled Error]', err?.stack || err?.message || err);
  res.status(500).json({ success: false, message: err?.message || 'Internal server error' });
});

// High-priority notification digest — batches everything not yet emailed at High priority into
// one email per recipient (see notification.email.ts). Critical priority is sent immediately
// from notification.service.ts's publishEvent instead of waiting for this interval. Runs only
// when there's a real database to query; a missing DATABASE_URL (this module's local-fallback
// mode) means there's nothing in notify.* to scan yet, so the interval would just no-op anyway.
const NOTIFICATION_DIGEST_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
if (process.env.NODE_ENV !== 'test' && isDatabaseConfigured()) {
  setInterval(() => {
    processEmailCandidates(['High']).catch((error) => {
      console.warn('[WorkSync API] High-priority notification digest run failed.', error);
    });
  }, NOTIFICATION_DIGEST_INTERVAL_MS);
}

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`[WorkSync API] Server listening on http://localhost:${PORT}`);
  });
}

export default app;
