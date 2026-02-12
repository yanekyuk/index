#!/usr/bin/env bun
/**
 * Bull Board UI for queue monitoring.
 *
 * Bull-board does not provide a dedicated Bun.serve() adapter. We use
 * @bull-board/hono because Hono uses the standard fetch Request/Response API,
 * which Bun.serve() supports natively—so the dashboard runs on Bun without
 * Express or any other framework.
 */
import dotenv from 'dotenv';
import path from 'path';

const envFile = process.env.NODE_ENV === 'production' ? '.env' : '.env.development';
dotenv.config({ path: path.resolve(process.cwd(), envFile) });

import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { HonoAdapter } from '@bull-board/hono';
import { serveStatic } from 'hono/bun';
import { Hono } from 'hono';
import { notificationQueue } from './queues/notification.queue';
import { intentHydeQueue } from './queues/intent-hyde.queue';
import { opportunityDiscoveryQueue } from './queues/opportunity-discovery.queue';
import { emailQueue } from './lib/email/queue/email.queue';

/** Served by the main server at this path (e.g. http://localhost:3001/dev/queues/). */
const BASE_PATH = '/dev/queues';

const app = new Hono();

// HonoAdapter for Bun: pass serveStatic from 'hono/bun' so static assets are served correctly.
const serverAdapter = new HonoAdapter(serveStatic);

createBullBoard({
  queues: [
    new BullMQAdapter(notificationQueue),
    new BullMQAdapter(intentHydeQueue),
    new BullMQAdapter(opportunityDiscoveryQueue),
    new BullMQAdapter(emailQueue),
  ],
  serverAdapter,
});

serverAdapter.setBasePath(BASE_PATH);
const boardApp = serverAdapter.registerPlugin();

// When mounted at BASE_PATH, Hono passes the path suffix to the subApp. So /dev/queues/ becomes
// path '' (not '/'), and the board's GET '/' never matches. Forward exact BASE_PATH and BASE_PATH/
// to the board with path '/' so the entry route matches.
app.get(BASE_PATH, (c) => c.redirect(`${BASE_PATH}/`, 302));
app.get(`${BASE_PATH}/`, async (c) => {
  const url = new URL(c.req.url);
  url.pathname = '/';
  const req = new Request(url.toString(), { method: 'GET', headers: c.req.raw.headers });
  return boardApp.fetch(req);
});
app.route(`${BASE_PATH}/`, boardApp);

app.get('/', (c) => c.redirect(`${BASE_PATH}/`, 302));

/** Hono app that serves Bull Board at BASE_PATH. Mounted in main server only. */
export const adminQueuesApp = app;
