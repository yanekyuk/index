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
import { emailQueue } from './lib/email/queue/email.queue';

const BASE_PATH = '/admin/queues';
const PORT = Number(process.env.ADMIN_QUEUES_PORT ?? process.env.PORT ?? 3001);

const app = new Hono();

// HonoAdapter for Bun: pass serveStatic from 'hono/bun' so static assets are served correctly.
const serverAdapter = new HonoAdapter(serveStatic);

createBullBoard({
  queues: [
    new BullMQAdapter(notificationQueue),
    new BullMQAdapter(emailQueue),
  ],
  serverAdapter,
});

serverAdapter.setBasePath(BASE_PATH);
const boardApp = serverAdapter.registerPlugin();

// When mounted at BASE_PATH, Hono passes the path suffix to the subApp. So /admin/queues/ becomes
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

Bun.serve({
  fetch: app.fetch,
  port: PORT,
});

console.log(`Bull Board UI: http://localhost:${PORT}${BASE_PATH}/`);
console.log('Make sure Redis is running (REDIS_URL or default localhost:6379).');
