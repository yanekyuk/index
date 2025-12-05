import * as Sentry from '@sentry/node';
import dotenv from 'dotenv';
import path from 'path';

// Load environment-specific .env file first
const envFile = `.env.${process.env.NODE_ENV || 'development'}`;
dotenv.config({ path: path.resolve(process.cwd(), envFile) });

// Ensure to call this before importing any other modules!
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  // Adds request headers and IP for users
  sendDefaultPii: true,
  // Set tracesSampleRate to 1.0 to capture 100% of transactions for tracing
  tracesSampleRate: 1.0,
  environment: process.env.NODE_ENV || 'development',
  // Enable logs to be sent to Sentry
  enableLogs: true,
});
