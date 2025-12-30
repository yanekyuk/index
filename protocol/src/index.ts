// Import this first! Must be before any other imports
import './instrument';

import * as Sentry from '@sentry/node';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';

console.log('process.env', process.env);
import { initializeBrokers } from './agents/context_brokers/connector';
import { emailWorker } from './lib/email/queue/email.worker';
import { initWeeklyNewsletterJob } from './jobs/newsletter.job';
import './queues/intent.queue';
import './queues/newsletter.queue';
import './queues/opportunity.queue';
/**
 * PLAYGROUND
 */
import { getAvailableAgents, runAgent } from './agents/playground/server/registry';
import { PARALLEL_INPUTS } from './agents/playground/server/data/users';

import path from 'path';

import authRoutes from './routes/auth';
import userRoutes from './routes/users';
import intentRoutes from './routes/intents';
import fileRoutes from './routes/files';
import indexRoutes from './routes/indexes';
import uploadRoutes from './routes/upload';
import connectionRoutes from './routes/connections';
import synthesisRoutes from './routes/synthesis';
import integrationRoutes from './routes/integrations';
import discoverRoutes from './routes/discover';
import linksRoutes from './routes/links';
import syncRoutes from './routes/sync';
import queueRoutes from './routes/queue';
import adminRoutes from './routes/admin';
import feedbackRoutes from './routes/feedback';
import notificationRoutes from './routes/notifications';
import devRoutes from './routes/dev';

const app = express();
const PORT = process.env.PORT || 3001;


// Middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      ...helmet.contentSecurityPolicy.getDefaultDirectives(),
      "img-src": ["'self'", "data:", "https:"],
      "script-src": ["'self'", "https:", "'unsafe-inline'"], // Required for Bull Board
    },
  },
}));
app.use(cors());
// app.use(morgan('combined')); // Temporarily disabled
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Serve static files from uploads directory
// Serve static files from uploads directory
app.use('/uploads', express.static('uploads'));

// Helper to determine playground path
const PLAYGROUND_DIST = path.resolve(__dirname, './agents/playground/dist');
app.use('/playground', express.static(PLAYGROUND_DIST));


// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/upload', uploadRoutes);
//app.use('/api/agents', agentRoutes);
app.use('/api/intents', intentRoutes);
app.use('/api/connections', connectionRoutes);

// New library-scoped endpoints
app.use('/api/files', fileRoutes);
app.use('/api/links', linksRoutes);
app.use('/api/indexes', indexRoutes);
app.use('/api/integrations', integrationRoutes);
app.use('/api/sync', syncRoutes);

app.use('/api/synthesis', synthesisRoutes);
app.use('/api/discover', discoverRoutes);
app.use('/api/queue', queueRoutes);

app.use('/api/admin', adminRoutes);
app.use('/api/feedback', feedbackRoutes);
app.use('/api/notifications', notificationRoutes);

// --- Playground API Routes ---
app.get('/api/agents', (req, res) => {
  res.json(getAvailableAgents());
});

app.get('/api/data/users', (req, res) => {
  res.json(PARALLEL_INPUTS);
});

app.post('/api/run/:agentId', async (req, res) => {
  const { agentId } = req.params;
  const body = req.body;

  // Check for wrapper format { input: ..., options: ... }
  // We assume if 'options' exists and 'input' exists, it's a wrapper. 
  // Otherwise treat body as input (Legacy support).
  let input = body;
  let options = undefined;

  if (body && typeof body === 'object' && 'input' in body && 'options' in body) {
    input = body.input;
    options = body.options;
  }

  try {
    const result = await runAgent(agentId, input, options);
    res.json(result);
  } catch (error: any) {
    console.error(`Error running agent ${agentId}:`, error);
    res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
});


if (process.env.NODE_ENV === 'development') {
  app.use('/api/dev', devRoutes);
}

// Sentry error handler must be before other error handlers
Sentry.setupExpressErrorHandler(app);

// Error handling middleware
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error(err.stack);
  res.status(500).json({
    error: 'Something went wrong!',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error'
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

(async () => {
  try {
    await initializeBrokers();
    console.log('🟢 Context brokers initialized');

    emailWorker.start();

    // Workers are auto-started upon import
    console.log('🟢 Queue workers initialized');

    initWeeklyNewsletterJob();
  } catch (err) {
    console.error('🔴 Failed to initialize services:', err);
  }

  app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📊 Health check: http://localhost:${PORT}/health`);
  });
})(); 
