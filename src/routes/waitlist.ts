import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import {
  WaitlistSignupRequestSchema,
  WaitlistSignupResponseSchema,
} from '../schemas/waitlist.js';

export const waitlistRoute = new OpenAPIHono();

const createWaitlistSignupRoute = createRoute({
  method: 'post',
  path: '/',
  tags: ['waitlist'],
  summary: 'Join the waitlist',
  description:
    'Persist a waitlist signup (email + optional phone + optional name + optional UTM source). Sprint 1 placeholder logs to console; Sprint 2 will write to Neon.',
  request: {
    body: {
      content: {
        'application/json': {
          schema: WaitlistSignupRequestSchema,
        },
      },
      required: true,
    },
  },
  responses: {
    201: {
      description: 'Signup recorded',
      content: {
        'application/json': {
          schema: WaitlistSignupResponseSchema,
        },
      },
    },
    400: {
      description: 'Validation error',
    },
  },
});

waitlistRoute.openapi(createWaitlistSignupRoute, (c) => {
  const data = c.req.valid('json');

  // TODO Sprint 2: persist to Neon DB via Drizzle. Console log is the placeholder.
  console.log('[waitlist] new signup:', {
    email: data.email,
    phone: data.phone,
    name: data.name,
    source: data.source,
    received_at: new Date().toISOString(),
  });

  return c.json(
    {
      ok: true,
      message:
        'مرحباً بك في قائمة الانتظار! سنبعث لك إشعار بمجرد إطلاق المنصة.',
    },
    201,
  );
});
