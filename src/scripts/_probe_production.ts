// Production-pipeline probe: exercises the new src/lib/ai/* code path on
// Hena's existing order. Renders 1 cover + 1 body page (page 1) and reports
// URLs. Validates the post-2026-05-10 refactor end-to-end:
//   - Static watercolor anchor (Image 1) loaded from STATIC_WATERCOLOR_ANCHOR_URL
//   - Customer photos (Image 2..N+1) loaded from photos table
//   - buildIllustrationPrompt produces the new block structure
//   - generateCoverIllustration + generateBodyIllustration use the new path
//
// Cost: ~$0.16 total (1 cover + 1 page on Google direct gemini-3.1-flash-image-preview,
// multi-turn = 2 successful calls × $0.04 = $0.08 each). Uses Hena's existing
// Bible — does NOT re-generate Bible or story.
//
// Run: pnpm tsx src/scripts/_probe_production.ts

import "dotenv/config";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { generations, photos as photosTable } from "../db/schema.js";
import { buildIllustrationPrompt } from "../lib/ai/prompts/build-illustration-prompt.js";
import {
  generateCoverIllustration,
  generateBodyIllustration,
} from "../lib/ai/illustration-generator.js";
import type { Bible } from "../lib/ai/schemas/bible.js";

const ORDER_ID = "76e6226a-452e-47d6-9209-b53717d6d1cd"; // Hena's friendship order
const SOURCE_GEN_ID = "68d5add6-48da-4a3e-baf3-054ad2162326"; // watercolor baseline (has Bible + story)

interface StoryShape {
  title: string;
  coverDescription: string;
  pages: Array<{
    number: number;
    text: string;
    scene: string;
    charactersOnPage: string[];
    keyObjectOrDetail?: string;
    emotionalBeat: string;
  }>;
}

async function main(): Promise<void> {
  console.log("Production pipeline probe — Hena's order, 1 cover + page 1\n");

  // 1. Load Bible + story from existing source generation.
  const sourceGen = await db
    .select()
    .from(generations)
    .where(eq(generations.id, SOURCE_GEN_ID))
    .limit(1)
    .then((r) => r[0]);
  if (!sourceGen?.storyJson || !sourceGen?.bibleJson) {
    throw new Error(`Source generation ${SOURCE_GEN_ID} missing story or bible`);
  }
  const story = sourceGen.storyJson as StoryShape;
  const bible = sourceGen.bibleJson as Bible;
  console.log(`✓ Loaded story (${story.pages.length} pages) + bible`);
  console.log(`  Protagonist: ${bible.characterBible.mainChild.name}, age ${bible.characterBible.mainChild.age}`);
  console.log(`  Outfit: ${bible.characterBible.mainChild.outfit.default.slice(0, 80)}...`);

  // 2. Load customer photos.
  const photoRows = await db
    .select({ url: photosTable.url })
    .from(photosTable)
    .where(eq(photosTable.orderId, ORDER_ID));
  const customerPhotoUrls = photoRows
    .map((r) => r.url)
    .filter((u): u is string => typeof u === "string" && u.length > 0);
  if (customerPhotoUrls.length === 0) {
    throw new Error(`No customer photos for order ${ORDER_ID}`);
  }
  console.log(`✓ Loaded ${customerPhotoUrls.length} customer photo(s)\n`);

  // 3. Build prompts using the new production prompt builder.
  console.log("Building cover prompt...");
  const coverPrompts = buildIllustrationPrompt({
    bible,
    scene: story.coverDescription,
    pageNumber: 0,
  });
  console.log(`  cover prompt length: ${coverPrompts.positive.length} chars`);

  const page1 = story.pages.find((p) => p.number === 1);
  if (!page1) throw new Error("Story has no page 1");
  console.log("Building page 1 prompt...");
  const page1Prompts = buildIllustrationPrompt({
    bible,
    scene: page1.scene,
    pageNumber: 1,
    charactersOnPage: page1.charactersOnPage,
    keyObjectOrDetail: page1.keyObjectOrDetail,
  });
  console.log(`  page 1 prompt length: ${page1Prompts.positive.length} chars\n`);

  const protagonistName = bible.characterBible.mainChild.name;
  const defaultOutfit = bible.characterBible.mainChild.outfit.default;

  // 4. Render cover via production pipeline (Google direct + multi-turn).
  console.log("→ Rendering COVER (Google direct, multi-turn)...");
  const t0 = Date.now();
  const cover = await generateCoverIllustration({
    orderId: ORDER_ID,
    positivePrompt: coverPrompts.positive,
    negativePrompt: coverPrompts.negative,
    customerPhotoUrls,
    protagonistName,
    outfit: defaultOutfit,
  });
  console.log(`✓ Cover rendered in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  console.log(`  ${cover.url}`);
  console.log(`  modelId: ${cover.modelId}, ${(cover.fileSize / 1024).toFixed(0)}KB\n`);

  // 5. Render page 1 via production pipeline.
  console.log("→ Rendering PAGE 1 (Google direct, multi-turn)...");
  const t1 = Date.now();
  const bodyPage = await generateBodyIllustration({
    orderId: ORDER_ID,
    pageNumber: 1,
    positivePrompt: page1Prompts.positive,
    negativePrompt: page1Prompts.negative,
    customerPhotoUrls,
    protagonistName,
    outfit: defaultOutfit,
  });
  console.log(`✓ Page 1 rendered in ${((Date.now() - t1) / 1000).toFixed(0)}s`);
  console.log(`  ${bodyPage.url}`);
  console.log(`  modelId: ${bodyPage.modelId}, ${(bodyPage.fileSize / 1024).toFixed(0)}KB\n`);

  console.log("✅ PROBE COMPLETE.");
  console.log(`   Cover:  ${cover.url}`);
  console.log(`   Page 1: ${bodyPage.url}`);
  console.log(`   Total cost: ~$0.16 (cover + page 1, multi-turn × $0.08 on gemini-3.1-flash-image-preview)`);
}

main()
  .catch((e) => { console.error("FAILED:", e); process.exit(1); })
  .then(() => process.exit(0));
