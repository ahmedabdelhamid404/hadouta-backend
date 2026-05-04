-- Migration 0006: add bible_json + bible_regenerated_at to generations.
-- Per docs/design/specs/2026-05-03-illustration-pipeline-redesign-spec.md §5.6.
--
-- Stores the locked character/setting/style/cultural Bible separately from
-- story_json so admin can re-roll illustrations without regenerating the
-- Bible (and vice versa).

ALTER TABLE generations
  ADD COLUMN bible_json jsonb,
  ADD COLUMN bible_regenerated_at timestamp with time zone;

-- Partial index for "has Bible" / "no Bible" queries (used by admin
-- analytics + reroll handlers that need to know whether a generation
-- predates the Bible system).
CREATE INDEX IF NOT EXISTS idx_generations_bible_present
  ON generations ((bible_json IS NOT NULL));
