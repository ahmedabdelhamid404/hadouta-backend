// One-shot: apply migration 0008_retry_queue.sql directly to the database.
// Drizzle's journal stops at 0004 (migrations 0005-0008 are orphaned — the
// SQL files exist but were never registered via `drizzle-kit generate`).
// This script bypasses the journal and runs 0008's ALTER statements directly.
//
// Run: pnpm tsx src/scripts/_apply_0008.ts

import "dotenv/config";
import postgres from "postgres";

async function main(): Promise<void> {
  const connStr = process.env.DATABASE_URL;
  if (!connStr) throw new Error("DATABASE_URL not set");
  const sql = postgres(connStr, { max: 1 });

  try {
    console.log("Applying 0008 — retry queue schema...");

    // ALTER TYPE statements must run individually (cannot be in a transaction).
    await sql.unsafe(
      `ALTER TYPE generation_status ADD VALUE IF NOT EXISTS 'failed_retry_pending';`,
    );
    console.log("  ✓ enum value: failed_retry_pending");
    await sql.unsafe(
      `ALTER TYPE generation_status ADD VALUE IF NOT EXISTS 'failed_human_review';`,
    );
    console.log("  ✓ enum value: failed_human_review");

    // ALTER TABLE — add columns.
    await sql.unsafe(`
      ALTER TABLE generations
        ADD COLUMN IF NOT EXISTS next_retry_at timestamptz,
        ADD COLUMN IF NOT EXISTS last_error text,
        ADD COLUMN IF NOT EXISTS failure_summary jsonb;
    `);
    console.log("  ✓ columns: next_retry_at, last_error, failure_summary");

    // Partial index for the cron worker.
    await sql.unsafe(`
      CREATE INDEX IF NOT EXISTS idx_generations_retry_pending
        ON generations (next_retry_at)
        WHERE status = 'failed_retry_pending';
    `);
    console.log("  ✓ partial index: idx_generations_retry_pending");

    // Verify.
    const cols = await sql.unsafe(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'generations' AND column_name IN ('next_retry_at', 'last_error', 'failure_summary')`,
    );
    console.log(`\n✓ Verification: ${cols.length}/3 columns present`);
    for (const row of cols) console.log(`    - ${(row as { column_name: string }).column_name}`);
  } finally {
    await sql.end();
  }
}

main()
  .catch((e) => {
    console.error("FAILED:", e);
    process.exit(1);
  })
  .then(() => process.exit(0));
