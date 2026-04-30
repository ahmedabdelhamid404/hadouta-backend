import 'dotenv/config';
import { serve } from '@hono/node-server';
import { OpenAPIHono } from '@hono/zod-openapi';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { healthRoute } from './routes/health.js';
import { waitlistRoute } from './routes/waitlist.js';

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

// Routes
app.route('/health', healthRoute);
app.route('/waitlist', waitlistRoute);

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

// Error handler
app.onError((err, c) => {
  console.error('[server] Unhandled error:', err);
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
