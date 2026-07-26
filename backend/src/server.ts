import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import authRoutes from './routes/authRoutes.js';
import assistantRoutes from './routes/assistantRoutes.js';
import otpRoutes from './routes/otpRoutes.js';
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

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Global error handler (must be registered AFTER all routes)
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[Unhandled Error]', err?.stack || err?.message || err);
  res.status(500).json({ success: false, message: err?.message || 'Internal server error' });
});

// Skip listen on Vercel (serverless) and in test mode
// Vercel uses the exported `app` directly via api/index.ts
if (process.env.NODE_ENV !== 'test' && process.env.VERCEL !== '1') {
  app.listen(PORT, () => {
    console.log(`[WorkSync API] Server listening on http://localhost:${PORT}`);
  });
}

export default app;
