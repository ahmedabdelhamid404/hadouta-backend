-- Migration 0002: ADR-018 phone-first WhatsApp OTP + ADR-019 multi-style foundation
-- Hand-written (drizzle-kit generate's interactive rename prompt couldn't be driven non-interactively).
-- See ADR-018 (phone-first auth) and ADR-019 (multi-style architecture) for rationale.

-- ----------------------------------------------------------------------------
-- USER table: replace `phone` (varchar(32) custom field) with the
-- Better-Auth phone-number plugin's canonical schema (phoneNumber +
-- phoneNumberVerified) plus the ADR-018 risk-based step-up field
-- (lastVerifiedAt). The plugin manages the first two; we own the third.
-- Existing user.phone column is dropped (user table has no production data
-- yet — only Better-Auth-managed test users from session-3 integration tests).
-- ----------------------------------------------------------------------------

ALTER TABLE "user" DROP COLUMN IF EXISTS "phone";

ALTER TABLE "user" ADD COLUMN "phone_number" text;
ALTER TABLE "user" ADD CONSTRAINT "user_phone_number_unique" UNIQUE ("phone_number");

ALTER TABLE "user" ADD COLUMN "phone_number_verified" boolean NOT NULL DEFAULT false;

ALTER TABLE "user" ADD COLUMN "last_verified_at" timestamp with time zone;

-- ----------------------------------------------------------------------------
-- THEMES table: ADR-019 multi-style foundation. Themes carry an array of
-- supported illustration styles. At MVP all themes default to ['watercolor'];
-- future themes can support multiple styles or be style-specific.
-- ----------------------------------------------------------------------------

ALTER TABLE "themes" ADD COLUMN "supported_styles" text[] NOT NULL DEFAULT ARRAY['watercolor']::text[];

-- ----------------------------------------------------------------------------
-- ORDERS table: ADR-019 multi-style foundation. Each order carries the single
-- illustration style the customer chose. CHECK constraint on the canonical
-- style code set; expand by ALTER CONSTRAINT when new styles ship.
-- ----------------------------------------------------------------------------

ALTER TABLE "orders" ADD COLUMN "style" text NOT NULL DEFAULT 'watercolor';

ALTER TABLE "orders" ADD CONSTRAINT "orders_style_check"
  CHECK ("style" IN ('watercolor', 'pixar_3d', 'soft_anime', 'kawaii'));
