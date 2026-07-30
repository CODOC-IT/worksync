import 'dotenv/config';
import express from 'express';
import cors from 'cors';

import authRoutes from './routes/authRoutes.js';
import assistantRoutes from './routes/assistantRoutes.js';
import otpRoutes from './routes/otpRoutes.js';
import reportsRoutes from './routes/reportsRoutes.js';
import hrRequestRoutes from './routes/hrRequestRoutes.js';

import taskRoutes from './tasks/task.routes.js';
import projectRoutes from './projects/project.routes.js';
import discussionRoutes from './collab/discussion.routes.js';
import notificationRoutes from './notifications/notification.routes.js';
import attendanceRoutes from './routes/attendanceRoutes.js';
import activityLogRoutes from './activityLog/activityLog.routes.js';
import activityRoutes from './activity/activity.routes.js';
import accountRoutes from './accounts/accounts.routes.js';

import { processEmailCandidates } from './notifications/notification.email.js';
import { isDatabaseConfigured, bootstrapDatabase } from './db/pool.js';
import { validateAuthConfig } from './middleware/authMiddleware.js';
import { userStore } from './store/userStore.js';
import { auditFailedRequests } from './middleware/auditFailureMiddleware.js';

// Fail-fast security checks on boot
validateAuthConfig();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(auditFailedRequests);

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/assistant', assistantRoutes);
app.use('/api/otp', otpRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/project-chats', discussionRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/activity-log', activityLogRoutes);
app.use('/api/activity', activityRoutes);
app.use('/api/accounts', accountRoutes);
app.use('/api/hr-requests', hrRequestRoutes);

// Health check
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString()
  });
});

// Catch-all 404 for unmatched API routes
app.use('/api/*', (_req, res) => {
  res.status(404).json({
    success: false,
    message: 'API endpoint not found.'
  });
});

// Global error handler
app.use(
  (
    err: any,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    console.error(
      '[Unhandled Error]',
      err?.stack || err?.message || err
    );

    res.status(500).json({
      success: false,
      message: err?.message || 'Internal server error'
    });
  }
);

// High-priority notification digest
const NOTIFICATION_DIGEST_INTERVAL_MS = 2 * 60 * 1000;

if (
  process.env.NODE_ENV !== 'test' &&
  process.env.VERCEL !== '1' &&
  isDatabaseConfigured()
) {
  setInterval(() => {
    processEmailCandidates(['High']).catch((error) => {
      console.warn(
        '[WorkSync API] High-priority notification digest run failed.',
        error
      );
    });
  }, NOTIFICATION_DIGEST_INTERVAL_MS);
}

// Start local backend server
if (
  process.env.NODE_ENV !== 'test' &&
  process.env.VERCEL !== '1'
) {
  bootstrapDatabase()
    .then(() => userStore.syncUsersToDb())
    .then(() => {
      app.listen(PORT, () => {
        console.log(
          `[WorkSync API] Server listening on http://localhost:${PORT}`
        );
      });
    })
    .catch((error) => {
      console.error(
        '[WorkSync API] Failed to start server.',
        error
      );
      process.exit(1);
    });
}

export default app;
