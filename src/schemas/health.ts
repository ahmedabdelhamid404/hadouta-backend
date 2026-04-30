import { z } from '@hono/zod-openapi';

export const HealthResponseSchema = z
  .object({
    status: z.literal('ok'),
    service: z.string(),
    version: z.string(),
    timestamp: z.string().datetime(),
    environment: z.string(),
  })
  .openapi('HealthResponse');

export type HealthResponse = z.infer<typeof HealthResponseSchema>;
