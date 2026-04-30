import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { z } from "zod";
import { db } from "../db/index.js";
import { sendEmail } from "./email.js";

/**
 * Better-Auth instance for Hadouta.
 *
 * Sprint 1 A5 scope: email/password + Google OAuth + Resend email verification.
 *
 * Sessions stored in the same Neon Postgres database via Drizzle adapter.
 * Tables (created by `pnpm db:generate` from `src/db/schema.ts`):
 *   - user (with custom phone + role columns via additionalFields)
 *   - session
 *   - account
 *   - verification
 */

// ----- Env validation (constitution Principle II — Zod at boundaries) -----
// Empty strings in `.env` (e.g. `GOOGLE_CLIENT_ID=`) are normalised to
// `undefined` before parsing so the optional fields treat "blank placeholder"
// the same as "not set" — and the truthy guards below behave correctly.
const optionalNonEmpty = z.preprocess(
  (v) => (v === "" ? undefined : v),
  z.string().optional(),
);
const AuthEnvSchema = z.object({
  NODE_ENV: z.string().default("development"),
  BETTER_AUTH_SECRET: z
    .string()
    .min(16, "BETTER_AUTH_SECRET must be at least 16 chars (use `openssl rand -base64 32`)"),
  BETTER_AUTH_URL: z.string().url().default("http://localhost:3001"),
  FRONTEND_URL: z.string().url().default("http://localhost:3000"),
  GOOGLE_CLIENT_ID: optionalNonEmpty,
  GOOGLE_CLIENT_SECRET: optionalNonEmpty,
  RESEND_API_KEY: optionalNonEmpty,
  RESEND_FROM_EMAIL: optionalNonEmpty,
});

const parsed = AuthEnvSchema.safeParse(process.env);
if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
  throw new Error(`[auth] invalid environment configuration:\n${issues}`);
}
const env = parsed.data;

const isProduction = env.NODE_ENV === "production";

// Resend transport config — exported so `email.ts` can stay a pure transport
// module without re-reading `process.env` (constitution Principle II).
export const resendConfig = {
  apiKey: env.RESEND_API_KEY,
  fromEmail: env.RESEND_FROM_EMAIL,
  isProduction,
} as const;

// Only enable Google OAuth when both credentials are present at module load.
// Passing empty strings makes Better-Auth reject the provider config.
const googleProvider =
  env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
    ? {
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
      }
    : undefined;

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
  }),

  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,

  // Suppress Better-Auth's info-level logs which include user emails
  // (e.g. "Sign-up attempt for existing email: ${email}") — constitution
  // Principle VII: PII never logged.
  logger: {
    level: "warn",
    disabled: false,
  },

  emailAndPassword: {
    enabled: true,
    // In production force email verification before sign-in. In dev keep it
    // off so flows aren't blocked when Resend creds aren't wired locally.
    requireEmailVerification: isProduction,
    minPasswordLength: 8,
    maxPasswordLength: 128,
    autoSignIn: true,
    sendResetPassword: async ({ user, url }) => {
      await sendEmail({
        to: user.email,
        subject: "إعادة تعيين كلمة المرور — حدوتة",
        html: `<p>مرحباً،</p><p>اضغط على الرابط التالي لإعادة تعيين كلمة المرور:</p><p><a href="${url}">${url}</a></p>`,
        text: `Reset your password: ${url}`,
      });
    },
  },

  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      await sendEmail({
        to: user.email,
        subject: "تأكيد بريدك الإلكتروني — حدوتة",
        html: `<p>مرحباً،</p><p>اضغط على الرابط التالي لتأكيد بريدك الإلكتروني:</p><p><a href="${url}">${url}</a></p>`,
        text: `Verify your email: ${url}`,
      });
    },
  },

  // Custom user fields beyond Better-Auth defaults — added as columns on
  // the `user` table by the Drizzle adapter.
  user: {
    additionalFields: {
      phone: { type: "string", required: false, input: true },
      role: {
        type: "string",
        required: false,
        defaultValue: "customer",
        input: false, // role is set server-side, not by the user
      },
    },
  },

  ...(googleProvider
    ? {
        socialProviders: {
          google: googleProvider,
        },
      }
    : {}),

  trustedOrigins: [env.FRONTEND_URL],

  session: {
    expiresIn: 60 * 60 * 24 * 30, // 30 days
    updateAge: 60 * 60 * 24, // refresh session activity once per day
  },
});

export type Auth = typeof auth;
