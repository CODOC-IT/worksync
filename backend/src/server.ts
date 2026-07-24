import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import authRoutes from './routes/authRoutes.js';
import otpRoutes from './routes/otpRoutes.js';
import { validateAuthConfig } from './middleware/authMiddleware.js';

dotenv.config();

// Fail-fast security checks on boot
validateAuthConfig();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/otp', otpRoutes);

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`[WorkSync API] Server listening on http://localhost:${PORT}`);
  });
}

export default app;
