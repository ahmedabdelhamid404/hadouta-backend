-- Sprint 2 — admin auth invite flow
-- Adds must_change_password to user table. New admins created via the
-- invite endpoint get default password "1234" and this flag set to true;
-- the admin app routes them to /change-password on first login.
--
-- Hand-written (drizzle-kit interactive prompt issue, recurring).

ALTER TABLE "user"
  ADD COLUMN IF NOT EXISTS "must_change_password" BOOLEAN NOT NULL DEFAULT false;
