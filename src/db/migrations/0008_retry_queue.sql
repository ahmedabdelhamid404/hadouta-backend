-- Migration 0008: production retry-queue architecture per ADR-029 + V7 fix
-- (2026-05-10 architectural validation).
--
-- Adds two new generation statuses + tracking columns so the background
-- retry worker (src/jobs/retry-failed-generations.ts) can:
--   1. Pick up generations stuck on transient failures (Tier-1 503 storms,
--      network blips, Cloudinary 5xx) and retry them resumably without
--      re-running story+bible.
--   2. Escalate generations with permanent failures (safety blocks, billing
--      errors) to a human-review queue surfaced in the admin dashboard.
--
-- Per-illustration resumability is built into runGenerationPipeline via the
-- existing bookPages.illustrationUrl — pages already rendered are skipped on
-- resume. No bookPages schema change required.

-- ---------------------------------------------------------------------------
-- Enum extensions. ALTER TYPE ... ADD VALUE cannot run inside a transaction
-- block, but Drizzle's migration runner handles each statement independently
-- so this is safe per the same pattern as 0007.
-- ---------------------------------------------------------------------------

ALTER TYPE generation_status ADD VALUE IF NOT EXISTS 'failed_retry_pending';
ALTER TYPE generation_status ADD VALUE IF NOT EXISTS 'failed_human_review';

-- ---------------------------------------------------------------------------
-- Tracking columns on generations.
--   - next_retry_at: when the background worker should pick this row up.
--     NULL on terminal statuses; set when status flips to failed_retry_pending.
--   - last_error: short error label (e.g. "Gemini Capacity (Tier 1)") so the
--     admin queue can show the failure reason at a glance without parsing
--     errorLog. errorLog stays as the full stack/message for debugging.
--   - failure_summary: structured PageFailure[] from BatchResult.pageFailures
--     (+ coverFailure folded in). Lets the admin UI render a per-page failure
--     table and lets the retry worker know which pages are retryable vs which
--     need human intervention.
-- ---------------------------------------------------------------------------

ALTER TABLE generations
  ADD COLUMN IF NOT EXISTS next_retry_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_error text,
  ADD COLUMN IF NOT EXISTS failure_summary jsonb;

-- ---------------------------------------------------------------------------
-- Partial index — the retry worker queries this every 5 minutes; the index
-- keeps that scan cheap as the table grows. Predicate matches the worker's
-- WHERE clause exactly.
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_generations_retry_pending
  ON generations (next_retry_at)
  WHERE status = 'failed_retry_pending';
