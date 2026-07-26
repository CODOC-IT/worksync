/**
 * Vercel Serverless Entry Point
 *
 * This file wraps the Express application so Vercel can serve it
 * as a serverless function.  Every request to /api/* is forwarded
 * here via vercel.json rewrites.
 *
 * Build-time note for Vercel:
 *   The root package.json already bundles all Express dependencies
 *   (express, cors, bcryptjs, jsonwebtoken, nodemailer, etc.) so
 *   the serverless build picks them up automatically.
 */

import app from '../backend/src/server.js';

// Vercel expects a default export of the Express app for @vercel/node
export default app;

