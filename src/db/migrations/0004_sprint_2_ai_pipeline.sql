-- Sprint 2 AI pipeline schema (per ADR-020 strategic pivot + Phase 5 design spec).
-- Hand-written because drizzle-kit's interactive snapshot prompt blocks
-- (recurring issue, same as 0002 + 0003).

-- ============================================================================
-- New enum
-- ============================================================================

CREATE TYPE "public"."generation_status" AS ENUM (
  'queued',
  'generating_story',
  'story_done',
  'generating_illustrations',
  'illustrations_done',
  'awaiting_review',
  'approved',
  'rejected',
  'assembling_pdf',
  'delivering',
  'delivered',
  'failed'
);

-- ============================================================================
-- ai_settings — singleton row holding all admin-controllable cost knobs
-- ============================================================================

CREATE TABLE "ai_settings" (
  "id" text PRIMARY KEY DEFAULT 'singleton',
  "story_model" text NOT NULL DEFAULT 'claude-haiku-4-5',
  "story_max_tokens" integer NOT NULL DEFAULT 4000,
  "illustration_model" text NOT NULL DEFAULT 'nano-banana',
  "illustration_count" integer NOT NULL DEFAULT 8,
  "max_retries" integer NOT NULL DEFAULT 1,
  "allow_illustration_fallback" boolean NOT NULL DEFAULT true,
  "auto_approve_threshold" integer,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_by_user_id" text REFERENCES "user"("id") ON DELETE SET NULL,
  CONSTRAINT "ai_settings_singleton_only" CHECK (id = 'singleton')
);

-- Seed singleton row immediately (UPSERT)
INSERT INTO "ai_settings" (id) VALUES ('singleton')
  ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- generations — top-level workflow record per AI pass
-- ============================================================================

CREATE TABLE "generations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "order_id" uuid NOT NULL REFERENCES "orders"("id") ON DELETE CASCADE,
  "status" "generation_status" NOT NULL DEFAULT 'queued',
  "story_json" jsonb,
  "cover_url" text,
  "pdf_url" text,
  "story_tokens_input" integer,
  "story_tokens_output" integer,
  "illustrations_count" integer,
  "estimated_cost_cents" integer,
  "rejection_category" text,
  "rejection_reason" text,
  "retry_count" integer NOT NULL DEFAULT 0,
  "error_log" text,
  "started_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "reviewed_at" timestamp with time zone,
  "reviewed_by_user_id" text REFERENCES "user"("id") ON DELETE SET NULL,
  "delivered_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_generations_order_id" ON "generations" ("order_id");
CREATE INDEX IF NOT EXISTS "idx_generations_status" ON "generations" ("status");
CREATE INDEX IF NOT EXISTS "idx_generations_created_at" ON "generations" ("created_at" DESC);

-- ============================================================================
-- book_pages — per-page story text + illustration URL + validator flags
-- ============================================================================

CREATE TABLE "book_pages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "generation_id" uuid NOT NULL REFERENCES "generations"("id") ON DELETE CASCADE,
  "page_number" integer NOT NULL,
  "story_text" text NOT NULL,
  "illustration_url" text,
  "illustration_prompt" text NOT NULL,
  "illustration_provider" varchar(30),
  "illustration_generated_at" timestamp with time zone,
  "validation_flags" jsonb,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_book_pages_generation_id" ON "book_pages" ("generation_id");
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_book_pages_generation_page" ON "book_pages" ("generation_id", "page_number");
