// CLI entry point for the retry worker. Designed to be invoked by Railway
// cron (or any external scheduler) every 5 minutes.
//
// Run: pnpm tsx src/scripts/run-retry-worker.ts
//
// Exit codes:
//   0 — sweep completed (regardless of how many generations succeeded —
//       the worker's job is to ATTEMPT, not to guarantee success)
//   1 — unhandled error (DB connection issue, etc.) — Railway will retry
//       on the next cron tick

import "dotenv/config";
import { runRetryWorker } from "../jobs/retry-failed-generations.js";

async function main(): Promise<void> {
  const result = await runRetryWorker();
  console.log(JSON.stringify(result));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[run-retry-worker] FATAL:", err);
    process.exit(1);
  });
