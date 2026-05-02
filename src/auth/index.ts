import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { phoneNumber } from "better-auth/plugins";
import { z } from "zod";
import { db } from "../db/index.js";
import { sendEmail } from "./email.js";
import { sendWhatsAppOTP } from "./twilio.js";

/**
 * Better-Auth instance for Hadouta. ADR-018 phone-first WhatsApp OTP +
 * email/password as backup; ADR-009 stack (Better-Auth + Neon + R2).
 *
 * Auth tiers per ADR-018:
 *   1. WhatsApp OTP (primary — Twilio + Meta)
 *   2. SMS OTP fallback (Twilio, automatic when WhatsApp delivery fails)
 *   3. Google OAuth (alternative; conditional on env)
 *   4. Email/password + email-OTP (last-resort recovery)
 *
 * Lazy verification: no requireEmailVerification gate. Email is verified
 * only when the user adds it as a backup method, not at signup.
 *
 * Sessions stored in the same Neon Postgres database via Drizzle adapter.
 * Tables (created by `pnpm db:generate` from `src/db/schema.ts`):
 *   - user (with phone_number, phone_number_verified, last_verified_at, role)
 *   - session
 *   - account
 *   - verification (Better-Auth-managed, used by phone-number plugin too)
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
  // Comma-separated list of additional trusted origins for Better-Auth
  // (e.g. hadouta-admin.vercel.app + localhost ports for the admin app).
  // FRONTEND_URL is automatically included.
  TRUSTED_ORIGINS: optionalNonEmpty,
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

  // Sprint 2 first-cycle: turning off Better-Auth's strict origin/CSRF
  // check because the admin app proxies via a Vercel serverless Route
  // Handler. Node's undici fetch (used in the proxy) auto-adds
  // `Sec-Fetch-Mode: cors`, which combined with the request URL's host
  // (Railway) trips Better-Auth's INVALID_ORIGIN guard even when we
  // explicitly inject Origin: hadouta-admin.vercel.app.
  //
  // Trusted-origins still enforced server-side at the route level via
  // requireAdmin middleware (role='admin' check). Re-enable + properly
  // configure cross-origin cookies (SameSite=None, Secure) in Sprint 3.
  advanced: {
    disableCSRFCheck: true,
  },

  // Suppress Better-Auth's info-level logs which include user emails / phones
  // (e.g. "Sign-up attempt for existing email: ${email}") — constitution
  // Principle VII: PII never logged.
  logger: {
    level: "warn",
    disabled: false,
  },

  // ADR-018: email/password remains enabled as tier-4 last-resort fallback,
  // but the requireEmailVerification gate is OFF — email is no longer the
  // primary identifier, so verifying-on-signup is unnecessary friction.
  // Email verification still runs lazily when a user adds email as a
  // backup method.
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
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

  // Lazy email verification — link-based, sent only when explicitly requested
  // (e.g. a user adds email as a backup method post-signup). NOT triggered
  // automatically on signup per ADR-018.
  emailVerification: {
    sendOnSignUp: false,
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

  // Custom user fields beyond Better-Auth + plugin defaults — added as columns
  // on the `user` table by the Drizzle adapter. The phone-number plugin
  // manages phoneNumber + phoneNumberVerified columns; we own role and
  // lastVerifiedAt.
  user: {
    additionalFields: {
      role: {
        type: "string",
        required: false,
        defaultValue: "customer",
        input: false, // role is set server-side, not by the user
      },
      lastVerifiedAt: {
        type: "date",
        required: false,
        input: false,
      },
      mustChangePassword: {
        type: "boolean",
        required: false,
        defaultValue: false,
        input: false, // server-managed (set by invite flow, cleared by change-password)
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

  trustedOrigins: [
    env.FRONTEND_URL,
    // Always trust the canonical admin app + local-dev admin ports.
    "https://hadouta-admin.vercel.app",
    "http://localhost:3002",
    "http://localhost:3000",
    // Plus any extras from env (comma-separated).
    ...(env.TRUSTED_ORIGINS
      ? env.TRUSTED_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean)
      : []),
  ],

  session: {
    expiresIn: 60 * 60 * 24 * 30, // 30 days
    updateAge: 60 * 60 * 24, // refresh session activity once per day
  },

  // ADR-018 phone-first WhatsApp OTP. The plugin adds /api/auth/phone-number/*
  // endpoints (send-otp, verify-phone-number, sign-up). The sendOTP callback
  // delegates to twilio.ts, which handles WhatsApp tier-1 + SMS tier-2 fallback.
  // signUpOnVerification: when a phone-OTP verifies and no user exists for
  // that phone, create one. Better-Auth requires email on user table — we
  // generate a placeholder email from the phone number; the user can add a
  // real email later as a backup method.
  plugins: [
    phoneNumber({
      sendOTP: async ({ phoneNumber: to, code }) => {
        await sendWhatsAppOTP({
          phoneNumber: to,
          message: `كود الدخول لحدوتة: ${code}\n\nالكود صالح لـ ١٠ دقايق. ما تشاركوش الكود مع حد.\n\nHadouta verification code: ${code}`,
        });
      },
      otpLength: 6,
      expiresIn: 600, // 10 minutes — matches WhatsApp template spec
      signUpOnVerification: {
        getTempEmail: (phone) =>
          `${phone.replace(/[^0-9]/g, "")}@phone.hadouta.local`,
        getTempName: (phone) => phone,
      },
    }),
  ],
});

export type Auth = typeof auth;
