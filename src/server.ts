import 'dotenv/config';
// Sentry instrumentation must load before any other module that might
// throw — Sentry hooks into Node's async resource tracking at init time.
import { Sentry } from './instrumentation.js';
import { serve } from '@hono/node-server';
import { OpenAPIHono } from '@hono/zod-openapi';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { auth } from './auth/index.js';
import { healthRoute } from './routes/health.js';
import { waitlistRoute } from './routes/waitlist.js';
import { ordersRouter } from './routes/orders.js';
import { catalogRouter } from './routes/catalog.js';
import { photosRouter } from './routes/photos.js';

const app = new OpenAPIHono();

// Global middleware
app.use('*', logger());
app.use(
  '*',
  cors({
    origin: process.env.FRONTEND_URL ?? 'http://localhost:3000',
    credentials: true,
  }),
);

// Better-Auth handler — must be registered first so /api/auth/* requests
// flow through it before any other route group can intercept them.
app.on(['POST', 'GET'], '/api/auth/*', (c) => auth.handler(c.req.raw));

// Routes
app.route('/health', healthRoute);
app.route('/waitlist', waitlistRoute);
app.route('/api/orders', ordersRouter);
app.route('/api/catalog', catalogRouter);
app.route('/api/photos', photosRouter);

// OpenAPI spec endpoint — frontend pulls types from here via openapi-typescript
app.doc('/openapi.json', {
  openapi: '3.0.0',
  info: {
    version: process.env.npm_package_version ?? '0.1.0',
    title: 'Hadouta Backend API',
    description:
      'Egyptian AI personalized children\'s book platform. See https://github.com/ahmedabdelhamid404/hadouta-backend',
  },
  servers: [
    {
      url: 'http://localhost:3001',
      description: 'Local development',
    },
    {
      url: 'https://api.hadouta.com',
      description: 'Production',
    },
  ],
});

// 404 handler
app.notFound((c) => c.json({ error: 'Not found' }, 404));

// Error handler — captures to Sentry (no-op when DSN unset) before responding.
app.onError((err, c) => {
  console.error('[server] Unhandled error:', err);
  Sentry.captureException(err, {
    extra: {
      method: c.req.method,
      path: c.req.path,
    },
  });
  return c.json({ error: 'Internal server error' }, 500);
});

const port = Number(process.env.PORT ?? 3001);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(
    `[server] Hadouta backend listening on http://localhost:${info.port}`,
  );
  console.log(`[server] OpenAPI spec: http://localhost:${info.port}/openapi.json`);
});

export type AppType = typeof app;
