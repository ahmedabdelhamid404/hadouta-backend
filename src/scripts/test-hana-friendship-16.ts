// End-to-end test (2026-05-06): full 16-page book with all Sprint 3 audit
// fixes applied (Bible-gen Pixar-3D + buildIllustrationPrompt sectioned
// rewrite + Arabic glossary triggers + describePhoto rewrite + sandwich-
// bottom re-anchors + age-matched few-shot shuffle + 4th example).
//
// Child: Hana, 5y, girl. Theme: Friendship. Moral: Cooperation.
// Photo: /home/ahmed/Downloads/WhatsApp Image 2026-05-04 at 11.45.19 PM.jpeg
//
// Output: visible in admin panel at https://hadouta-admin.vercel.app
//
// Run: pnpm tsx src/scripts/test-hana-friendship-16.ts

import "dotenv/config";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { generateObject } from "ai";
import { openai } from "@ai-sdk/openai";

import { db } from "../db/index.js";
import {
  orders,
  themes,
  moralValues,
  photos as photosTable,
  generations,
  bookPages,
} from "../db/schema.js";
import { uploadImage } from "../lib/cloudinary.js";
import { buildStorySystemPrompt } from "../lib/ai/prompts/story-system-prompt.js";
import { storyOutputSchema } from "../lib/ai/schemas/story.js";
import { generateBible } from "../lib/ai/bible-generator.js";
import { buildIllustrationPrompt } from "../lib/ai/prompts/build-illustration-prompt.js";
import { generateAllIllustrations } from "../lib/ai/illustration-generator.js";
import { assembleBookPdf } from "../lib/pdf/render-book.js";

const PHOTO_PATH =
  "/home/ahmed/Downloads/WhatsApp Image 2026-05-04 at 11.45.19 PM.jpeg";

const CHILD_NAME = "هَنَا";
const CHILD_AGE_EXACT = 5;
const CHILD_AGE_BAND = "5-7" as const;
const CHILD_GENDER = "girl" as const;
const PAGE_COUNT = 16;
const THEME_SLUG = "friendship";
const MORAL_NAME_AR = "التعاون";

// Small helper: retry a DB write up to N times with backoff. Defends against
// the transient Neon ETIMEDOUT we hit on the previous test run after a long-
// running fal.ai call held the connection open past Neon's idle window.
async function dbRetry<T>(label: string, fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      console.warn(
        `  ⚠️  [${label}] attempt ${i}/${attempts} failed: ${(err as Error).message?.slice(0, 100) ?? err}`,
      );
      if (i < attempts) {
        const backoffMs = 1000 * 2 ** (i - 1);
        await new Promise((r) => setTimeout(r, backoffMs));
      }
    }
  }
  throw lastErr;
}

async function main(): Promise<void> {
  console.log(`Hana 16-page friendship/cooperation E2E test starting...\n`);

  // ─── Lookup theme + moral ───
  const themeRow = await db
    .select()
    .from(themes)
    .where(eq(themes.slug, THEME_SLUG))
    .limit(1)
    .then((r) => r[0]);
  if (!themeRow) {
    throw new Error(`Theme slug '${THEME_SLUG}' not found.`);
  }
  const moralRow = await db
    .select()
    .from(moralValues)
    .where(eq(moralValues.nameAr, MORAL_NAME_AR))
    .limit(1)
    .then((r) => r[0]);
  if (!moralRow) {
    throw new Error(`Moral '${MORAL_NAME_AR}' not found.`);
  }
  console.log(
    `→ Theme: ${themeRow.titleAr} (${themeRow.titleEn}); Moral: ${moralRow.nameAr} (${moralRow.nameEn})`,
  );

  // ─── Step 1: Create order + upload photo ───
  const orderId = randomUUID();
  console.log(`\n→ Inserting order ${orderId}...`);
  await dbRetry("orders.insert", () =>
    db.insert(orders).values({
      id: orderId,
      themeId: themeRow.id,
      moralValueId: moralRow.id,
      status: "test_hana_e2e_16",
      style: "pixar_3d",
      childName: CHILD_NAME,
      childAgeBand: CHILD_AGE_BAND,
      childAgeExact: CHILD_AGE_EXACT,
      childGender: CHILD_GENDER,
      appearanceInputType: "photo",
      buyerName: "Test (Sprint 3 E2E — Hana 16-page)",
    }),
  );

  console.log(`→ Uploading photo (${PHOTO_PATH})...`);
  const photoBuf = readFileSync(PHOTO_PATH);
  const photoUpload = await uploadImage(
    photoBuf,
    orderId,
    "main_child",
    "image/jpeg",
  );
  await dbRetry("photos.insert", () =>
    db.insert(photosTable).values({
      orderId,
      ownerType: "main_child",
      url: photoUpload.url,
      contentType: photoUpload.contentType,
      fileSize: photoUpload.fileSize,
    }),
  );
  console.log(`  ✓ Photo URL: ${photoUpload.url}`);

  // ─── Step 2: Generate story (16 pages) ───
  console.log(`\n→ Generating story (gpt-4o, ${PAGE_COUNT} pages)...`);
  const systemPrompt = buildStorySystemPrompt({
    ageBand: CHILD_AGE_BAND,
    pageCount: PAGE_COUNT,
  });
  const userPrompt = [
    `Please write a personalized Egyptian children's story for the child described below.`,
    ``,
    `**Length: exactly ${PAGE_COUNT} pages**, numbered 1..${PAGE_COUNT}. The cover is a separate field, not a page.`,
    ``,
    `# Child`,
    `- Name: ${CHILD_NAME}`,
    `- Age band: ${CHILD_AGE_BAND}`,
    `- Exact age: ${CHILD_AGE_EXACT}`,
    `- Gender: ${CHILD_GENDER}`,
    ``,
    `# Theme`,
    `- Arabic title: ${themeRow.titleAr}`,
    `- English label: ${themeRow.titleEn}`,
    `- Description: ${themeRow.descriptionAr ?? themeRow.description ?? ""}`,
    ``,
    `# Moral value to teach (through action, never declared)`,
    `- Arabic: ${moralRow.nameAr}`,
    `- English: ${moralRow.nameEn}`,
    `- Description: ${moralRow.description ?? ""}`,
    ``,
    `Produce the story now in the structured JSON output format. Apply all craft rules from the system prompt. Output exactly ${PAGE_COUNT} pages.`,
  ].join("\n");

  const storyGen = await generateObject({
    model: openai("gpt-4o"),
    schema: storyOutputSchema,
    system: systemPrompt,
    prompt: userPrompt,
    temperature: 0.7,
    maxTokens: 6000,
  });
  const story = storyGen.object;
  if (story.pages.length !== PAGE_COUNT) {
    throw new Error(
      `Expected ${PAGE_COUNT} pages from story gen, got ${story.pages.length}`,
    );
  }
  console.log(`  ✓ Title: ${story.title}`);
  console.log(`  ✓ ${story.pages.length} pages`);
  console.log(`  ✓ moralStatement: ${story.moralStatement.slice(0, 80)}...`);
  for (const p of story.pages) {
    console.log(
      `    p${p.number} [${p.act}] chars=${JSON.stringify(p.charactersOnPage)} key='${p.keyObjectOrDetail.slice(0, 50)}'`,
    );
  }

  // ─── Step 3: Generate Bible ───
  console.log(`\n→ Generating Bible (gpt-4o + vision)...`);
  const bible = await generateBible({
    story,
    wizardData: {
      childName: CHILD_NAME,
      childAgeBand: CHILD_AGE_BAND,
      childAgeExact: CHILD_AGE_EXACT,
      childGender: CHILD_GENDER,
      theme: themeRow.titleAr ?? "الصداقة",
      moralValue: moralRow.nameAr ?? "التعاون",
      photoUrl: photoUpload.url,
      personaId: null,
    },
  });
  console.log(
    `  ✓ Bible — supportingCharacters: ${bible.characterBible.supportingCharacters.length}`,
  );
  for (const sc of bible.characterBible.supportingCharacters) {
    console.log(
      `    - ${sc.name} (${sc.relationship}): ${sc.appearance.slice(0, 100)}...`,
    );
  }
  console.log(`  ✓ styleBible.medium:        ${bible.styleBible.medium.slice(0, 110)}...`);
  console.log(`  ✓ styleBible.negativeStyle: ${bible.styleBible.negativeStyle.slice(0, 110)}...`);
  console.log(`  ✓ outfit.default:           ${bible.characterBible.mainChild.outfit.default.slice(0, 110)}...`);

  // ─── Step 4: Persist generation row ───
  const genId = randomUUID();
  console.log(`\n→ Creating generation ${genId}...`);
  await dbRetry("generations.insert", () =>
    db.insert(generations).values({
      id: genId,
      orderId,
      status: "generating_illustrations",
      storyJson: story,
      bibleJson: bible,
      illustrationsCount: PAGE_COUNT + 1,
      estimatedCostCents: 145, // ~$1.42
      startedAt: new Date(),
    }),
  );

  // ─── Step 5: Build all illustration prompts (cover + 16 body pages) ───
  console.log(`\n→ Building illustration prompts...`);
  const coverPrompts = buildIllustrationPrompt({
    bible,
    scene: story.coverDescription,
    pageNumber: 0,
    hasReferencePhotos: true,
  });
  console.log(`  ✓ Cover prompt: ${coverPrompts.positive.length} chars`);
  const pageInputs = story.pages.map((p) => {
    const prompts = buildIllustrationPrompt({
      bible,
      scene: p.scene,
      pageNumber: p.number,
      hasReferencePhotos: true,
      charactersOnPage: p.charactersOnPage,
      keyObjectOrDetail: p.keyObjectOrDetail,
    });
    return {
      pageNumber: p.number,
      positivePrompt: prompts.positive,
      negativePrompt: prompts.negative,
    };
  });
  console.log(
    `  ✓ ${pageInputs.length} body prompts built (avg length: ${Math.round(pageInputs.reduce((s, p) => s + p.positivePrompt.length, 0) / pageInputs.length)} chars)`,
  );

  // ─── Step 6: Generate cover + 16 body illustrations (concurrency=5) ───
  console.log(`\n→ Generating cover + ${PAGE_COUNT} body illustrations (Nano Banana 2, concurrency=5)...`);
  const startedAt = Date.now();
  const batch = await generateAllIllustrations({
    orderId,
    cover: {
      positivePrompt: coverPrompts.positive,
      negativePrompt: coverPrompts.negative,
    },
    pages: pageInputs,
    customerPhotoUrls: [photoUpload.url],
  });
  console.log(`  ✓ All illustrations done in ${(batch.totalDurationMs / 1000).toFixed(1)}s`);
  console.log(`  ✓ Cover URL: ${batch.cover.url}`);

  // ─── Step 7: Persist cover URL + bookPages rows ───
  await dbRetry("generations.coverUrl", () =>
    db
      .update(generations)
      .set({ coverUrl: batch.cover.url, updatedAt: new Date() })
      .where(eq(generations.id, genId)),
  );

  console.log(`\n→ Inserting ${batch.pages.length} bookPage rows...`);
  for (const pageResult of batch.pages) {
    const storyPage = story.pages.find((p) => p.number === pageResult.pageNumber);
    const promptInput = pageInputs.find((p) => p.pageNumber === pageResult.pageNumber);
    if (!storyPage || !promptInput) continue;
    await dbRetry(`bookPages.insert page ${pageResult.pageNumber}`, () =>
      db.insert(bookPages).values({
        generationId: genId,
        pageNumber: pageResult.pageNumber,
        storyText: storyPage.text,
        illustrationUrl: pageResult.url,
        illustrationPrompt: promptInput.positivePrompt.slice(0, 2000),
        illustrationProvider: pageResult.modelId,
        illustrationGeneratedAt: new Date(),
      }),
    );
  }
  console.log(`  ✓ All ${batch.pages.length} bookPage rows inserted`);

  // ─── Step 8: Assemble PDF ───
  console.log(`\n→ Assembling PDF...`);
  const pdfResult = await assembleBookPdf({ generationId: genId });
  console.log(`  ✓ PDF URL: ${pdfResult.pdfUrl}`);
  console.log(`  ✓ PDF size: ${(pdfResult.bytes / 1024).toFixed(1)} KB`);

  // ─── Step 9: Mark awaiting_review ───
  await dbRetry("generations.awaiting_review", () =>
    db
      .update(generations)
      .set({
        status: "awaiting_review",
        updatedAt: new Date(),
        completedAt: new Date(),
      })
      .where(eq(generations.id, genId)),
  );

  const totalSec = (Date.now() - startedAt) / 1000;
  console.log(`\n✅ E2E test complete in ${totalSec.toFixed(1)}s.`);
  console.log(`   Order ID:      ${orderId}`);
  console.log(`   Generation ID: ${genId}`);
  console.log(`   Admin URL:     https://hadouta-admin.vercel.app/orders/${genId}`);
  console.log(`   Cover:         ${batch.cover.url}`);
  console.log(`   PDF:           ${pdfResult.pdfUrl}`);
}

main()
  .catch((err) => {
    console.error("\n❌ E2E test failed:", err);
    process.exit(1);
  })
  .then(() => process.exit(0));
