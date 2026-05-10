// Quick Neon connectivity probe through the real postgres-js driver
// (same as production code path). Prints round-trip latency or the
// real driver-level error.
//
// Run: pnpm tsx src/scripts/_neon-probe.ts

import "dotenv/config";
import { db } from "../db/index.js";
import { sql } from "drizzle-orm";

async function main(): Promise<void> {
  console.log("Probing Neon via postgres-js driver...");
  const t0 = Date.now();
  try {
    const result = await db.execute(sql`SELECT 1 AS ok, NOW() AS ts`);
    const ms = Date.now() - t0;
    console.log(`✅ CONNECTED in ${ms}ms`);
    console.log(`   Result: ${JSON.stringify(result)}`);
  } catch (err) {
    const ms = Date.now() - t0;
    console.log(`❌ FAILED after ${ms}ms`);
    console.log(`   Error: ${(err as Error).message?.slice(0, 200) ?? err}`);
    const code = (err as { code?: string }).code;
    if (code) console.log(`   Code: ${code}`);
  }
  process.exit(0);
}

main();
