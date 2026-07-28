import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import authRoutes from './routes/authRoutes.js';
import assistantRoutes from './routes/assistantRoutes.js';
import otpRoutes from './routes/otpRoutes.js';
import reportsRoutes from './routes/reportsRoutes.js';
import taskRoutes from './tasks/task.routes.js';
import projectRoutes from './projects/project.routes.js';
import projectChatRoutes from './routes/projectChatRoutes.js';
import notificationRoutes from './notifications/notification.routes.js';
import { processEmailCandidates } from './notifications/notification.email.js';
import { isDatabaseConfigured, bootstrapDatabase } from './db/pool.js';
import { validateAuthConfig } from './middleware/authMiddleware.js';
import { userStore } from './store/userStore.js';

dotenv.config();

// Fail-fast security checks on boot
validateAuthConfig();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/assistant', assistantRoutes);
app.use('/api/otp', otpRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/project-chats', projectChatRoutes);
app.use('/api/notifications', notificationRoutes);

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Catch-all 404 for unmatched API routes — returns JSON instead of Express's default HTML
app.use('/api/*', (_req, res) => {
  res.status(404).json({ success: false, message: 'API endpoint not found.' });
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
// Also skipped on Vercel, same as app.listen below — a serverless function has no persistent
// process for setInterval to run in, so this would never actually fire there.
const NOTIFICATION_DIGEST_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes
if (process.env.NODE_ENV !== 'test' && process.env.VERCEL !== '1' && isDatabaseConfigured()) {
  setInterval(() => {
    processEmailCandidates(['High']).catch((error) => {
      console.warn('[WorkSync API] High-priority notification digest run failed.', error);
    });
  }, NOTIFICATION_DIGEST_INTERVAL_MS);
}

// Skip listen on Vercel (serverless) and in test mode
// Vercel uses the exported `app` directly via api/index.ts
if (process.env.NODE_ENV !== 'test' && process.env.VERCEL !== '1') {
  bootstrapDatabase()
    .then(() => userStore.syncUsersToDb())
    .then(() => {
      app.listen(PORT, () => {
        console.log(`[WorkSync API] Server listening on http://localhost:${PORT}`);
      });
    });
}

export default app;
