import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { HealthResponseSchema } from '../schemas/health.js';

export const healthRoute = new OpenAPIHono();

const healthCheckRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['health'],
  summary: 'Health check',
  description: 'Returns the current service health + metadata. Used by uptime checks and deploy verification.',
  responses: {
    200: {
      description: 'Service is healthy',
      content: {
        'application/json': {
          schema: HealthResponseSchema,
        },
      },
    },
  },
});

healthRoute.openapi(healthCheckRoute, (c) => {
  return c.json(
    {
      status: 'ok' as const,
      service: 'hadouta-backend',
      version: process.env.npm_package_version ?? '0.1.0',
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV ?? 'development',
    },
    200,
  );
});
