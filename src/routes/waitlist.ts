import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';

export const waitlistRoute = new Hono();

const WaitlistSignupSchema = z.object({
  email: z.string().email('بريد إلكتروني غير صحيح'),
  phone: z
    .string()
    .regex(/^(\+?20|0)?1[0-25]\d{8}$/, 'رقم هاتف مصري غير صحيح')
    .optional(),
  name: z.string().min(1).max(100).optional(),
  source: z.string().max(100).optional(), // UTM source for attribution
});

waitlistRoute.post('/', zValidator('json', WaitlistSignupSchema), async (c) => {
  const data = c.req.valid('json');

  // TODO: persist to Neon DB (Sprint 1, after Drizzle schema migrations run)
  // For now, log and return success so the frontend form works during dev.
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
      message: 'مرحباً بك في قائمة الانتظار! سنبعث لك إشعار بمجرد إطلاق المنصة.',
    },
    201,
  );
});
