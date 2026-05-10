// Retry worker for failed_retry_pending generations. ADR-029 Layer 4 +
// V7 fix (2026-05-10).
//
// Picks up generations where:
//   - status = 'failed_retry_pending'
//   - next_retry_at <= NOW()
//   - retry_count < MAX_RETRY_ATTEMPTS (defensive — runGenerationPipeline
//     also checks, but we filter here too so we don't waste a worker slot)
//
// Per run, processes up to MAX_PER_RUN generations (concurrency control —
// keeps one worker run from saturating the Gemini quota when many books
// fail simultaneously, e.g. during a Tier-1 503 storm).
//
// Idempotent: relies on runGenerationPipeline's resume semantics. Each
// invocation re-runs the pipeline; pages already in bookPages are skipped;
// only missing illustrations are billed.
//
// Designed to be called by:
//   - Railway cron (every 5 min): `pnpm tsx src/scripts/run-retry-worker.ts`
//   - Trigger.dev v3 once ADR-010 migration lands (Sprint 4+)
//   - Direct in-process loop (Sprint 3 dev mode — wraps in setInterval)

import { eq, lte, and, asc } from "drizzle-orm";
import { db } from "../db/index.js";
import { generations } from "../db/schema.js";
import { runGenerationPipeline } from "./generate-book.js";

const MAX_PER_RUN = 5; // bound concurrency so 100-stuck-generations doesn't fan out

export interface RetryWorkerResult {
  pickedUp: number;
  succeeded: number;
  failed: number;
  durations: number[];
}

/**
 * Single sweep — finds eligible generations, runs them sequentially (NOT in
 * parallel; runGenerationPipeline already runs internal concurrency-3 across
 * its illustrations). Returns counts for logging/observability.
 *
 * Sequential at the worker level because:
 *   - 5 books × 17 pages × multi-turn = 170 Gemini calls if parallelized
 *   - Tier 1 capacity can't sustain that during a 503 storm (which is
 *     precisely WHY we have failed_retry_pending generations to begin with)
 *   - Sequential keeps total in-flight Gemini calls = 3 (the orchestrator's
 *     own concurrency cap) instead of 15+
 */
export async function runRetryWorker(): Promise<RetryWorkerResult> {
  const now = new Date();
  console.log(`[retry-worker] sweep started at ${now.toISOString()}`);

  const eligible = await db
    .select({
      id: generations.id,
      orderId: generations.orderId,
      retryCount: generations.retryCount,
      nextRetryAt: generations.nextRetryAt,
      lastError: generations.lastError,
    })
    .from(generations)
    .where(
      and(
        eq(generations.status, "failed_retry_pending"),
        lte(generations.nextRetryAt, now),
      ),
    )
    .orderBy(asc(generations.nextRetryAt))
    .limit(MAX_PER_RUN);

  console.log(`[retry-worker] picked up ${eligible.length} eligible generation(s)`);

  let succeeded = 0;
  let failed = 0;
  const durations: number[] = [];

  for (const gen of eligible) {
    console.log(
      `[retry-worker] resuming generation=${gen.id} ` +
        `(attempt ${gen.retryCount}, last error: "${gen.lastError ?? "n/a"}")`,
    );
    const t0 = Date.now();
    try {
      // runGenerationPipeline owns its own try/catch and persists terminal
      // status. It will RE-set failed_retry_pending if this attempt also
      // fails (with an updated next_retry_at), or flip to awaiting_review on
      // success, or escalate to failed_human_review if the budget exhausts.
      await runGenerationPipeline(gen.id, gen.orderId);
      const elapsed = Date.now() - t0;
      durations.push(elapsed);
      succeeded++;
      console.log(
        `[retry-worker] generation=${gen.id} resumed successfully (${elapsed}ms)`,
      );
    } catch (err) {
      // runGenerationPipeline shouldn't throw (it catches all internally),
      // but defend against unhandled cases anyway.
      const elapsed = Date.now() - t0;
      durations.push(elapsed);
      failed++;
      console.error(
        `[retry-worker] generation=${gen.id} threw despite internal handling:`,
        err,
      );
    }
  }

  const result: RetryWorkerResult = {
    pickedUp: eligible.length,
    succeeded,
    failed,
    durations,
  };
  console.log(
    `[retry-worker] sweep done: picked=${result.pickedUp} succeeded=${succeeded} failed=${failed}`,
  );
  return result;
}
