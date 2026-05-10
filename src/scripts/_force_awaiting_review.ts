// One-shot: flip a generation's status to awaiting_review even if only some
// pages exist. Used when founder wants to see partial output as PDF without
// rendering the full 16-page book.
//
// WARNING: PDF assembly may break if it expects all 16 pages. Test first.
//
// Run: pnpm tsx src/scripts/_force_awaiting_review.ts <gen_id>

import "dotenv/config";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { generations, bookPages } from "../db/schema.js";

const argGenId = process.argv[2];
if (!argGenId) { console.error("usage: _force_awaiting_review.ts <gen_id>"); process.exit(1); }
const genId: string = argGenId;

async function main(): Promise<void> {
  const row = await db.select().from(generations).where(eq(generations.id, genId)).limit(1).then((r) => r[0]);
  if (!row) throw new Error(`generation ${genId} not found`);

  const pages = await db.select({ pageNumber: bookPages.pageNumber }).from(bookPages).where(eq(bookPages.generationId, genId));
  console.log(`Generation: ${genId}`);
  console.log(`Current status: ${row.status}`);
  console.log(`Cover: ${row.coverUrl ? "yes" : "NO"}`);
  console.log(`Pages saved: ${pages.length} (${pages.map((p) => p.pageNumber).sort((a, b) => a - b).join(", ")})`);

  await db.update(generations).set({
    status: "awaiting_review",
    completedAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(generations.id, genId));

  console.log(`\n✓ Status flipped to awaiting_review`);
  console.log(`Admin URL: https://hadouta-admin.vercel.app/orders/${genId}`);
  console.log(`The Approve button should now be available in admin.`);
}

main().catch((e) => { console.error("FAILED:", e); process.exit(1); }).then(() => process.exit(0));
