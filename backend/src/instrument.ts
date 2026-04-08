import * as Sentry from '@sentry/node';
import { log } from './lib/log';
// Ensure to call this before importing any other modules!
Sentry.init({
  dsn: process.env.SENTRY_DSN!,
  // Adds request headers and IP for users
  sendDefaultPii: true,
  // Set tracesSampleRate to 1.0 to capture 100% of transactions for tracing
  tracesSampleRate: 1.0,
  environment: process.env.NODE_ENV || 'development',
  // Enable logs to be sent to Sentry
  enableLogs: true,
});

log.server.from('instrument').info('Sentry initialized');