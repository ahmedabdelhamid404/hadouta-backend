// One-shot fix: removes the spurious "blue backpack with sunflower patch"
// variation from the source Bible (it was an accessory mis-classified as an
// outfit variation, causing page 1 to skip the wardrobe anchor in iter 8).
//
// Also deletes the partial iter 8 run (gen_id da58b825-...) so we can re-run
// fresh against the corrected Bible.
//
// Run: pnpm tsx src/scripts/_fix_bible_variations.ts

import "dotenv/config";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { generations, bookPages } from "../db/schema.js";

const SOURCE_GEN_ID = "68d5add6-48da-4a3e-baf3-054ad2162326";
const PARTIAL_ITER8_ID = "da58b825-6ae3-4fb4-9e1d-5d90c523c95d";

interface BibleOutfitVariation { pageNumbers?: number[]; description?: string }
interface BibleType {
  characterBible?: {
    mainChild?: {
      outfit?: { default?: string; variations?: BibleOutfitVariation[] };
    };
  };
}

async function main(): Promise<void> {
  console.log("Fix script — clearing spurious outfit variations from source Bible\n");

  // Step 1: read source Bible
  const sourceRow = await db.select().from(generations).where(eq(generations.id, SOURCE_GEN_ID)).limit(1).then((r) => r[0]);
  if (!sourceRow?.bibleJson) throw new Error("no source bible");
  const bible = JSON.parse(JSON.stringify(sourceRow.bibleJson)) as BibleType;
  const variationsBefore = bible.characterBible?.mainChild?.outfit?.variations ?? [];
  console.log(`Variations BEFORE: ${variationsBefore.length}`);
  for (const v of variationsBefore) console.log(`  pages [${(v.pageNumbers ?? []).join(", ")}] → ${v.description}`);

  // Step 2: clear variations (the only entry was a backpack accessory mis-tagged
  // as outfit variation; story doesn't actually have any wardrobe changes).
  if (bible.characterBible?.mainChild?.outfit) {
    bible.characterBible.mainChild.outfit.variations = [];
  } else {
    console.log("WARN: no outfit field on Bible — nothing to clear");
  }

  // Step 3: write back
  await db.update(generations).set({ bibleJson: bible }).where(eq(generations.id, SOURCE_GEN_ID));
  console.log("✓ Source Bible updated\n");

  // Step 4: verify
  const verifyRow = await db.select().from(generations).where(eq(generations.id, SOURCE_GEN_ID)).limit(1).then((r) => r[0]);
  const variationsAfter = (verifyRow?.bibleJson as BibleType)?.characterBible?.mainChild?.outfit?.variations ?? [];
  console.log(`Variations AFTER: ${variationsAfter.length}`);
  if (variationsAfter.length !== 0) {
    throw new Error("variations still present after update — fix did not apply");
  }

  // Step 5: clean up the partial iter 8 generation (cover not yet uploaded)
  console.log("\nCleaning up partial iter 8 generation...");
  await db.delete(bookPages).where(eq(bookPages.generationId, PARTIAL_ITER8_ID));
  const deleted = await db.delete(generations).where(eq(generations.id, PARTIAL_ITER8_ID));
  console.log(`✓ Deleted partial iter 8 generation (rows affected: ${(deleted as { rowCount?: number }).rowCount ?? "?"})`);

  console.log("\n✅ Fix complete. Ready to re-run iter 8 fresh:");
  console.log("   pnpm tsx src/scripts/_iter8_full_book.ts");
}

main().catch((e) => { console.error("FAILED:", e); process.exit(1); }).then(() => process.exit(0));
