import { z } from '@hono/zod-openapi';

/** Request body for POST /waitlist */
export const WaitlistSignupRequestSchema = z
  .object({
    email: z
      .string()
      .email('بريد إلكتروني غير صحيح')
      .openapi({ example: 'manar@example.com' }),
    phone: z
      .string()
      .regex(/^(\+?20|0)?1[0-25]\d{8}$/, 'رقم هاتف مصري غير صحيح')
      .optional()
      .openapi({ example: '+201012345678' }),
    name: z.string().min(1).max(100).optional().openapi({ example: 'منار' }),
    source: z
      .string()
      .max(100)
      .optional()
      .openapi({
        description: 'UTM / channel attribution',
        example: 'facebook_ad',
      }),
  })
  .openapi('WaitlistSignupRequest');

/** Response body for POST /waitlist (201) */
export const WaitlistSignupResponseSchema = z
  .object({
    ok: z.boolean(),
    message: z.string(),
  })
  .openapi('WaitlistSignupResponse');

export type WaitlistSignupRequest = z.infer<typeof WaitlistSignupRequestSchema>;
export type WaitlistSignupResponse = z.infer<typeof WaitlistSignupResponseSchema>;
