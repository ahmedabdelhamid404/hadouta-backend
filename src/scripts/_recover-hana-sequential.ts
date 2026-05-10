// Sequential recovery (2026-05-06): generates Hana book illustrations
// ONE AT A TIME with per-call retry. Slower than the concurrent batch but
// resilient to single fal.ai timeouts (which kill the whole concurrent
// batch). Each completed page is persisted immediately — re-runs are
// idempotent and skip already-rendered pages.
//
// Run: pnpm tsx src/scripts/_recover-hana-sequential.ts

import "dotenv/config";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  generations,
  bookPages,
  photos as photosTable,
} from "../db/schema.js";
import { buildIllustrationPrompt } from "../lib/ai/prompts/build-illustration-prompt.js";
import {
  generateCoverIllustration,
  generateBodyIllustration,
} from "../lib/ai/illustration-generator.js";
import { assembleBookPdf } from "../lib/pdf/render-book.js";
import type { Bible } from "../lib/ai/schemas/bible.js";
import type { StoryOutput } from "../lib/ai/schemas/story.js";

const GEN_ID = "dfb7d9d5-7ff7-4a24-83ce-bd645251d17e";
const ORDER_ID = "76e6226a-452e-47d6-9209-b53717d6d1cd";

async function withRetry<T>(label: string, fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const msg = (err as Error)?.message?.slice(0, 120) ?? String(err);
      console.warn(`    ⚠️  [${label}] attempt ${i}/${attempts}: ${msg}`);
      if (i < attempts) {
        const wait = 5000 * i;
        console.warn(`    waiting ${wait / 1000}s before retry...`);
        await new Promise((r) => setTimeout(r, wait));
      }
    }
  }
  throw lastErr;
}

async function main(): Promise<void> {
  console.log(`Sequential recovery for ${GEN_ID}\n`);

  // Load state
  const gen = await db
    .select()
    .from(generations)
    .where(eq(generations.id, GEN_ID))
    .limit(1)
    .then((r) => r[0]);
  if (!gen?.bibleJson || !gen?.storyJson) throw new Error("Missing bible or story JSON");
  const bible = gen.bibleJson as Bible;
  const story = gen.storyJson as StoryOutput;
  console.log(`✓ Story "${story.title}" — ${story.pages.length} pages`);

  const photoRows = await db
    .select({ url: photosTable.url })
    .from(photosTable)
    .where(eq(photosTable.orderId, ORDER_ID));
  const photoUrls = photoRows
    .map((r) => r.url)
    .filter((u): u is string => typeof u === "string" && u.length > 0);
  if (photoUrls.length === 0) throw new Error("No customer photos");
  console.log(`✓ ${photoUrls.length} customer photo(s)`);

  // Existing pages — skip these
  const existingPages = await db
    .select({ pageNumber: bookPages.pageNumber })
    .from(bookPages)
    .where(eq(bookPages.generationId, GEN_ID));
  const havePages = new Set(existingPages.map((r) => r.pageNumber));
  console.log(`✓ ${havePages.size} pages already rendered (will skip)`);

  let coverUrl = gen.coverUrl;

  // ─── Cover (skip if already rendered) ───
  if (!coverUrl) {
    console.log(`\n→ Cover...`);
    const coverPrompts = buildIllustrationPrompt({
      bible,
      scene: story.coverDescription,
      pageNumber: 0,
      hasReferencePhotos: true,
    });
    const coverResult = await withRetry("cover", () =>
      generateCoverIllustration({
        orderId: ORDER_ID,
        positivePrompt: coverPrompts.positive,
        negativePrompt: "",
        customerPhotoUrls: photoUrls,
      }),
    );
    coverUrl = coverResult.url;
    await db
      .update(generations)
      .set({ coverUrl, updatedAt: new Date() })
      .where(eq(generations.id, GEN_ID));
    console.log(`  ✓ Cover: ${coverUrl}`);
  } else {
    console.log(`\n  (cover already rendered — skipping)`);
  }

  // ─── Body pages SEQUENTIALLY ───
  for (const page of story.pages) {
    if (havePages.has(page.number)) {
      console.log(`  (page ${page.number} already done — skipping)`);
      continue;
    }
    console.log(`\n→ Page ${page.number}/${story.pages.length}: "${page.scene.slice(0, 60)}..."`);
    const prompt = buildIllustrationPrompt({
      bible,
      scene: page.scene,
      pageNumber: page.number,
      hasReferencePhotos: true,
      charactersOnPage: page.charactersOnPage,
      keyObjectOrDetail: page.keyObjectOrDetail,
    });
    const result = await withRetry(`page ${page.number}`, () =>
      generateBodyIllustration({
        orderId: ORDER_ID,
        pageNumber: page.number,
        positivePrompt: prompt.positive,
        negativePrompt: "",
        coverImageUrl: coverUrl!,
        customerPhotoUrls: photoUrls,
      }),
    );
    console.log(`  ✓ ${result.url}`);

    await db.insert(bookPages).values({
      generationId: GEN_ID,
      pageNumber: page.number,
      storyText: page.text,
      illustrationUrl: result.url,
      illustrationPrompt: prompt.positive.slice(0, 2000),
      illustrationProvider: result.modelId,
      illustrationGeneratedAt: new Date(),
    });
  }

  // ─── PDF ───
  console.log(`\n→ Assembling PDF...`);
  const pdfResult = await assembleBookPdf({ generationId: GEN_ID });
  console.log(`  ✓ PDF: ${pdfResult.pdfUrl} (${(pdfResult.bytes / 1024).toFixed(1)} KB)`);

  // ─── Mark awaiting_review ───
  await db
    .update(generations)
    .set({
      status: "awaiting_review",
      updatedAt: new Date(),
      completedAt: new Date(),
    })
    .where(eq(generations.id, GEN_ID));

  console.log(`\n✅ COMPLETE`);
  console.log(`   Admin URL: https://hadouta-admin.vercel.app/orders/${GEN_ID}`);
  console.log(`   PDF URL:   ${pdfResult.pdfUrl}`);
}

main()
  .catch((err) => {
    console.error("\n❌ Failed:", err);
    process.exit(1);
  })
  .then(() => process.exit(0));
