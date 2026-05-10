// Recovery script for the test-pixar-3-page-birthday run that ETIMEDOUTed
// after page 1 was generated. Inserts the missing bookPage row for page 1
// (Cloudinary URL preserved), generates pages 2 + 3, marks awaiting_review.
//
// Run: pnpm tsx src/scripts/_probe-and-recover.ts

import "dotenv/config";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  generations,
  bookPages,
  photos as photosTable,
} from "../db/schema.js";
import { buildIllustrationPrompt } from "../lib/ai/prompts/build-illustration-prompt.js";
import { generateBodyIllustration } from "../lib/ai/illustration-generator.js";
import type { Bible } from "../lib/ai/schemas/bible.js";
import type { StoryOutput } from "../lib/ai/schemas/story.js";

const GEN_ID = "3c5ce810-a8a7-4086-8ae6-dacb8fcbd0a6";
const ORDER_ID = "b9775fae-0e07-4c36-bff2-8694a4342d32";
const PAGE_1_URL =
  "https://res.cloudinary.com/dvewybhzv/image/upload/v1778097297/hadouta/orders/b9775fae-0e07-4c36-bff2-8694a4342d32/illustration_page_1/a1cdnslltarer1fdjdkr.png";
const PAGES_TO_GENERATE = [2, 3] as const;

async function main(): Promise<void> {
  // ─── Step 1: Probe DB + load existing generation ───
  console.log("→ Probing DB...");
  const gen = await db
    .select()
    .from(generations)
    .where(eq(generations.id, GEN_ID))
    .limit(1)
    .then((r) => r[0]);
  if (!gen) {
    throw new Error(`Generation ${GEN_ID} not found.`);
  }
  console.log(`  ✓ Generation status: ${gen.status}, coverUrl: ${gen.coverUrl?.slice(-40) ?? "MISSING"}`);

  if (!gen.bibleJson) throw new Error("bibleJson missing");
  if (!gen.storyJson) throw new Error("storyJson missing");
  if (!gen.coverUrl) throw new Error("coverUrl missing");

  const bible = gen.bibleJson as Bible;
  const story = gen.storyJson as StoryOutput;

  // Load photos for the order
  const photoRows = await db
    .select({ url: photosTable.url })
    .from(photosTable)
    .where(eq(photosTable.orderId, ORDER_ID));
  const photoUrls = photoRows
    .map((r) => r.url)
    .filter((u): u is string => typeof u === "string" && u.length > 0);
  if (photoUrls.length === 0) throw new Error("No customer photos for order.");
  console.log(`  ✓ Loaded ${photoUrls.length} photo(s)`);

  // ─── Step 2: Insert missing bookPage for page 1 (URL already exists) ───
  const page1 = story.pages.find((p) => p.number === 1);
  if (!page1) throw new Error("Story page 1 missing");

  const existingPage1 = await db
    .select({ id: bookPages.id })
    .from(bookPages)
    .where(eq(bookPages.generationId, GEN_ID))
    .limit(50);
  const existingPageNumbers = new Set(
    existingPage1.map((r) => r.id), // we'll re-query by pageNumber below
  );

  // Re-query specifically by pageNumber to dedupe
  const existingByPage = await db
    .select({ pageNumber: bookPages.pageNumber })
    .from(bookPages)
    .where(eq(bookPages.generationId, GEN_ID));
  const have = new Set(existingByPage.map((r) => r.pageNumber));

  if (!have.has(1)) {
    console.log("\n→ Inserting bookPage row for page 1 (using preserved Cloudinary URL)...");
    const page1Prompts = buildIllustrationPrompt({
      bible,
      scene: page1.scene,
      pageNumber: 1,
      hasReferencePhotos: true,
      charactersOnPage: page1.charactersOnPage,
      keyObjectOrDetail: page1.keyObjectOrDetail,
    });
    await db.insert(bookPages).values({
      generationId: GEN_ID,
      pageNumber: 1,
      storyText: page1.text,
      illustrationUrl: PAGE_1_URL,
      illustrationPrompt: page1Prompts.positive.slice(0, 2000),
      illustrationProvider: "nano-banana-2-edit",
      illustrationGeneratedAt: new Date(),
    });
    console.log("  ✓ Page 1 bookPage row inserted");
  } else {
    console.log("\n  (page 1 bookPage row already exists)");
  }

  // ─── Step 3: Generate pages 2 + 3 ───
  for (const pageNum of PAGES_TO_GENERATE) {
    if (have.has(pageNum)) {
      console.log(`\n  (page ${pageNum} already exists — skipping)`);
      continue;
    }
    const page = story.pages.find((p) => p.number === pageNum);
    if (!page) {
      console.log(`⚠️  Page ${pageNum} missing in story — skipping`);
      continue;
    }
    console.log(
      `\n→ Page ${pageNum}: "${page.scene.slice(0, 60)}..." (chars: ${JSON.stringify(page.charactersOnPage)})`,
    );
    const pagePrompts = buildIllustrationPrompt({
      bible,
      scene: page.scene,
      pageNumber: pageNum,
      hasReferencePhotos: true,
      charactersOnPage: page.charactersOnPage,
      keyObjectOrDetail: page.keyObjectOrDetail,
    });
    console.log(`  prompt length: ${pagePrompts.positive.length} chars`);
    const pageResult = await generateBodyIllustration({
      orderId: ORDER_ID,
      pageNumber: pageNum,
      positivePrompt: pagePrompts.positive,
      negativePrompt: pagePrompts.negative,
      coverImageUrl: gen.coverUrl,
      customerPhotoUrls: photoUrls,
    });
    console.log(`  ✓ Page ${pageNum} URL: ${pageResult.url}`);

    await db.insert(bookPages).values({
      generationId: GEN_ID,
      pageNumber: pageNum,
      storyText: page.text,
      illustrationUrl: pageResult.url,
      illustrationPrompt: pagePrompts.positive.slice(0, 2000),
      illustrationProvider: pageResult.modelId,
      illustrationGeneratedAt: new Date(),
    });
  }

  // ─── Step 4: Mark awaiting_review ───
  await db
    .update(generations)
    .set({
      status: "awaiting_review",
      updatedAt: new Date(),
      completedAt: new Date(),
    })
    .where(eq(generations.id, GEN_ID));

  console.log("\n✅ Recovery complete.");
  console.log(`   Order ID:      ${ORDER_ID}`);
  console.log(`   Generation ID: ${GEN_ID}`);
  console.log(`   Admin URL:     https://hadouta-admin.vercel.app/orders/${GEN_ID}`);
  console.log(`   Cover:         ${gen.coverUrl}`);
  console.log(`   Page 1:        ${PAGE_1_URL}`);

  void existingPageNumbers;
}

main()
  .catch((err) => {
    console.error("\n❌ Recovery failed:", err);
    process.exit(1);
  })
  .then(() => process.exit(0));
