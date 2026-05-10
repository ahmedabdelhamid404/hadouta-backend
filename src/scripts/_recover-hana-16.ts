// Recovery script for the Hana 16-page E2E test that timed out at the fal.ai
// illustration phase. Story + Bible are already persisted in the generation row;
// this script re-runs the 17 illustrations, persists bookPages, assembles PDF,
// marks awaiting_review.
//
// Run: pnpm tsx src/scripts/_recover-hana-16.ts

import "dotenv/config";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  generations,
  bookPages,
  photos as photosTable,
} from "../db/schema.js";
import { buildIllustrationPrompt } from "../lib/ai/prompts/build-illustration-prompt.js";
import { generateAllIllustrations } from "../lib/ai/illustration-generator.js";
import { assembleBookPdf } from "../lib/pdf/render-book.js";
import type { Bible } from "../lib/ai/schemas/bible.js";
import type { StoryOutput } from "../lib/ai/schemas/story.js";

const GEN_ID = "dfb7d9d5-7ff7-4a24-83ce-bd645251d17e";
const ORDER_ID = "76e6226a-452e-47d6-9209-b53717d6d1cd";

async function dbRetry<T>(label: string, fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      console.warn(
        `  ⚠️  [${label}] attempt ${i}/${attempts}: ${(err as Error).message?.slice(0, 100) ?? err}`,
      );
      if (i < attempts) await new Promise((r) => setTimeout(r, 2000 * i));
    }
  }
  throw lastErr;
}

async function main(): Promise<void> {
  console.log(`Recovering Hana generation ${GEN_ID}...\n`);

  // ─── Load existing state ───
  const gen = await dbRetry("load generation", () =>
    db.select().from(generations).where(eq(generations.id, GEN_ID)).limit(1).then((r) => r[0]),
  );
  if (!gen) throw new Error(`Generation ${GEN_ID} not found.`);
  if (!gen.bibleJson) throw new Error("bibleJson missing");
  if (!gen.storyJson) throw new Error("storyJson missing");
  console.log(`  ✓ Generation status: ${gen.status}`);

  const bible = gen.bibleJson as Bible;
  const story = gen.storyJson as StoryOutput;
  console.log(`  ✓ Story: "${story.title}" (${story.pages.length} pages)`);
  console.log(`  ✓ Bible supportingChars: ${bible.characterBible.supportingCharacters.length}`);

  // Skip if already populated (recovery is idempotent)
  const existingPages = await dbRetry("count bookPages", () =>
    db.select({ pageNumber: bookPages.pageNumber }).from(bookPages).where(eq(bookPages.generationId, GEN_ID)),
  );
  const havePages = new Set(existingPages.map((r) => r.pageNumber));
  if (havePages.size === story.pages.length && gen.coverUrl) {
    console.log(`  (all ${havePages.size} bookPages + cover already present — skipping illustration step)`);
  } else {
    // Load photo URLs
    const photoRows = await dbRetry("load photos", () =>
      db.select({ url: photosTable.url }).from(photosTable).where(eq(photosTable.orderId, ORDER_ID)),
    );
    const photoUrls = photoRows
      .map((r) => r.url)
      .filter((u): u is string => typeof u === "string" && u.length > 0);
    if (photoUrls.length === 0) throw new Error("No customer photos for order.");

    // Build all prompts
    console.log(`\n→ Building illustration prompts...`);
    const coverPrompts = buildIllustrationPrompt({
      bible,
      scene: story.coverDescription,
      pageNumber: 0,
      hasReferencePhotos: true,
    });
    // Skip already-rendered pages
    const pagesToRender = story.pages.filter((p) => !havePages.has(p.number));
    const pageInputs = pagesToRender.map((p) => ({
      pageNumber: p.number,
      positivePrompt: buildIllustrationPrompt({
        bible,
        scene: p.scene,
        pageNumber: p.number,
        hasReferencePhotos: true,
        charactersOnPage: p.charactersOnPage,
        keyObjectOrDetail: p.keyObjectOrDetail,
      }).positive,
      negativePrompt: "",
    }));
    console.log(`  ✓ Cover (${coverPrompts.positive.length} chars) + ${pageInputs.length} body prompts to render (${havePages.size} already done)`);

    // Generate
    console.log(`\n→ Generating illustrations (Nano Banana 2, concurrency=5)...`);
    const startedAt = Date.now();
    const batch = await generateAllIllustrations({
      orderId: ORDER_ID,
      cover: { positivePrompt: coverPrompts.positive, negativePrompt: "" },
      pages: pageInputs,
      customerPhotoUrls: photoUrls,
    });
    console.log(`  ✓ Done in ${(batch.totalDurationMs / 1000).toFixed(1)}s`);

    // Persist cover URL
    await dbRetry("update coverUrl", () =>
      db.update(generations).set({ coverUrl: batch.cover.url, updatedAt: new Date() }).where(eq(generations.id, GEN_ID)),
    );

    // Persist bookPages (only the new ones)
    console.log(`\n→ Inserting ${batch.pages.length} bookPage rows...`);
    for (const pageResult of batch.pages) {
      const storyPage = story.pages.find((p) => p.number === pageResult.pageNumber);
      const promptInput = pageInputs.find((p) => p.pageNumber === pageResult.pageNumber);
      if (!storyPage || !promptInput) continue;
      await dbRetry(`bookPages page ${pageResult.pageNumber}`, () =>
        db.insert(bookPages).values({
          generationId: GEN_ID,
          pageNumber: pageResult.pageNumber,
          storyText: storyPage.text,
          illustrationUrl: pageResult.url,
          illustrationPrompt: promptInput.positivePrompt.slice(0, 2000),
          illustrationProvider: pageResult.modelId,
          illustrationGeneratedAt: new Date(),
        }),
      );
    }
    console.log(`  ✓ All ${batch.pages.length} bookPages inserted`);
  }

  // ─── PDF assembly ───
  console.log(`\n→ Assembling PDF...`);
  const pdfResult = await assembleBookPdf({ generationId: GEN_ID });
  console.log(`  ✓ PDF URL: ${pdfResult.pdfUrl}`);
  console.log(`  ✓ PDF size: ${(pdfResult.bytes / 1024).toFixed(1)} KB`);

  // ─── Mark awaiting_review ───
  await dbRetry("mark awaiting_review", () =>
    db.update(generations).set({
      status: "awaiting_review",
      updatedAt: new Date(),
      completedAt: new Date(),
    }).where(eq(generations.id, GEN_ID)),
  );

  console.log("\n✅ Recovery complete.");
  console.log(`   Order ID:      ${ORDER_ID}`);
  console.log(`   Generation ID: ${GEN_ID}`);
  console.log(`   Admin URL:     https://hadouta-admin.vercel.app/orders/${GEN_ID}`);
  console.log(`   PDF:           ${pdfResult.pdfUrl}`);
}

main()
  .catch((err) => {
    console.error("\n❌ Recovery failed:", err);
    process.exit(1);
  })
  .then(() => process.exit(0));
