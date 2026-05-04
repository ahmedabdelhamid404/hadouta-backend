-- Migration 0007: add main_child_persona_id to orders.
-- Per docs/design/specs/2026-05-03-illustration-pipeline-redesign-spec.md §5.8.
--
-- Stores the persona-library id picked by the customer in the wizard's
-- "no-photo persona-picker" path. NULL when the customer uploaded a photo
-- or used the free-form description path.

ALTER TABLE orders
  ADD COLUMN main_child_persona_id text;

-- Extend the appearance_input_type enum to include 'persona'.
-- Cannot wrap in transaction with ALTER TABLE; safe to run separately.
ALTER TYPE appearance_input_type ADD VALUE IF NOT EXISTS 'persona';

