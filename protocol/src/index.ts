import './instrument';
import * as Sentry from '@sentry/node';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';

// logger.info('process.env', process.env);
import { initializeBrokers } from './agents/context_brokers/connector';
import { emailWorker } from './lib/email/queue/email.worker';
import { initWeeklyNewsletterJob } from './jobs/newsletter.job';
import { initOpportunityFinderJob } from './jobs/opportunity.job';
import { initHydeJobs } from './jobs/hyde.job';
import './queues/intent.queue';
import './queues/newsletter.queue';
import './queues/opportunity.queue';
import './queues/notification.queue';
import './queues/profile.queue';
/**
 * PLAYGROUND
 */
import { getAvailableAgents, runAgent } from './agents/playground/server/registry';
import { TEST_USERS } from './agents/playground/server/data/users';
import { users } from './schemas/database.schema';
import db from './lib/drizzle/drizzle';
import { desc } from 'drizzle-orm';
import { IndexEmbedder } from './lib/embedder';
// Initialize shared embedder
const sharedEmbedder = new IndexEmbedder();

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
import chatRoutes from './routes/chat';
import devRoutes from './routes/dev';
import { log } from './lib/log';

const logger = log.server.from("[DEPRECATED] index");

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
app.use('/api/chat', chatRoutes);

// --- Playground API Routes ---
app.get('/api/agents', (req, res) => {
  res.json(getAvailableAgents());
});

app.get('/api/data/users', async (req, res) => {
  try {
    const dbUsers = await db.select().from(users).orderBy(desc(users.createdAt));

    const mappedUsers = dbUsers.map(u => {
      const socials = u.socials as any || {};
      return {
        id: u.id,
        name: u.name,
        // Map DB fields to context fields
        userProfile: {
          identity: {
            name: u.name,
            bio: u.intro,
            location: u.location,
            // avatar: u.avatar // profile usually expects identity fields
          }
        },
        parallelSearchParams: {
          name: u.name,
          email: u.email,
          linkedin: socials.linkedin,
          twitter: socials.x || socials.twitter,
          github: socials.github,
          website: Array.isArray(socials.websites) ? socials.websites[0] : socials.website
        },
        activeIntents: [] // TODO: Fetch intents if needed
      };
    });

    // Combine test users with real users
    // Filter out duplicates if needed, but for now just concat
    const allUsers = [...TEST_USERS, ...mappedUsers];

    res.json(allUsers);
  } catch (error) {
    logger.error('Error fetching users for playground:', { error });
    // Fallback to test users in case of DB error
    res.json(TEST_USERS);
  }
});

app.post('/api/run/:agentId', async (req, res) => {
  const { agentId } = req.params;
  const body = req.body;

  // Check for wrapper format { input: ..., options?: ... }
  // Only require 'input' key to exist - options is optional
  let input = body;
  let options = undefined;

  if (body && typeof body === 'object' && 'input' in body) {
    input = body.input;
    options = body.options;
  }

  try {
    const result = await runAgent(agentId, input, options);
    res.json(result);
  } catch (error: any) {
    logger.error(`Error running agent ${agentId}:`, error);
    res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
});

app.post('/api/embeddings', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) {
      return res.status(400).json({ error: 'Text is required' });
    }
    const result = await sharedEmbedder.generate(text);
    // Standardize output to number[]
    const vector = Array.isArray(result[0]) ? result[0] : result;
    res.json({ vector });
    return;
  } catch (error: any) {
    logger.error('Error generating embedding:', error);
    res.status(500).json({ error: error.message });
    return;
  }

});
if (process.env.NODE_ENV === 'development') {
  app.use('/api/dev', devRoutes);
}

// Sentry error handler must be before other error handlers
Sentry.setupExpressErrorHandler(app);

// Error handling middleware
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error(err.stack);
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
    logger.info('🟢 Context brokers initialized');

    emailWorker.start();

    // Workers are auto-started upon import
    logger.info('🟢 Queue workers initialized');

    initWeeklyNewsletterJob();
    initOpportunityFinderJob();
    initHydeJobs();
  } catch (err) {
    logger.error('🔴 Failed to initialize services:', { error: err });
  }

  app.listen(PORT, () => {
    logger.info(`🚀 Server running on port ${PORT}`);
    logger.info(`📊 Health check: http://localhost:${PORT}/health`);
  });
})(); 
