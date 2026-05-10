// One-shot: delete a single bookPages row by gen_id + page_number.
// Used when a rendered page is incorrect and needs to be removed before
// re-rendering or before approving the partial book.
//
// Run: pnpm tsx src/scripts/_delete_page.ts <gen_id> <page_number>

import "dotenv/config";
import { and, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { bookPages } from "../db/schema.js";

const argGenId = process.argv[2];
const pageNum = process.argv[3] ? parseInt(process.argv[3], 10) : NaN;
if (!argGenId || Number.isNaN(pageNum)) {
  console.error("usage: _delete_page.ts <gen_id> <page_number>");
  process.exit(1);
}
const genId: string = argGenId;

async function main(): Promise<void> {
  const before = await db.select().from(bookPages).where(and(eq(bookPages.generationId, genId), eq(bookPages.pageNumber, pageNum)));
  if (before.length === 0) {
    console.log(`No page ${pageNum} found for generation ${genId} — nothing to delete.`);
    return;
  }
  console.log(`Found page ${pageNum}: ${before[0]?.illustrationUrl ?? "(no URL)"}`);

  await db.delete(bookPages).where(and(eq(bookPages.generationId, genId), eq(bookPages.pageNumber, pageNum)));
  console.log(`✓ Deleted page ${pageNum} from generation ${genId}`);

  const remaining = await db.select({ pageNumber: bookPages.pageNumber }).from(bookPages).where(eq(bookPages.generationId, genId));
  const sorted = remaining.map((r) => r.pageNumber).sort((a, b) => a - b);
  console.log(`Remaining pages: [${sorted.join(", ")}] (${sorted.length} total)`);
}

main().catch((e) => { console.error("FAILED:", e); process.exit(1); }).then(() => process.exit(0));
