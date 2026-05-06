// Quick test (2026-05-06): exercise the Sprint 3 Bible-gen + buildIllustrationPrompt
// rewrites end-to-end against a fresh order with the new boy-photo Ahmed sent.
// Generates 1 cover + 3 body illustrations (story has 4 pages — schema minimum —
// only first 3 body pages get rendered to keep cost low and feedback fast).
//
// Photo: /home/ahmed/Downloads/WhatsApp Image 2026-05-06 at 9.52.18 PM.jpeg
// Output: visible in admin panel at https://hadouta-admin.vercel.app
//
// Run: pnpm tsx src/scripts/test-pixar-3-page-birthday.ts

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
import {
  generateCoverIllustration,
  generateBodyIllustration,
} from "../lib/ai/illustration-generator.js";

const PHOTO_PATH =
  "/home/ahmed/Downloads/WhatsApp Image 2026-05-06 at 9.52.18 PM.jpeg";

const CHILD_NAME = "آدم";
const CHILD_AGE_EXACT = 5;
const CHILD_AGE_BAND = "5-7" as const;
const CHILD_GENDER = "boy" as const;
const PAGE_COUNT = 4; // schema minimum; we render cover + first 3 only.
const BODY_PAGES_TO_RENDER = [1, 2, 3] as const;
const THEME_SLUG = "birthday";
const MORAL_NAME_AR = "الكرم"; // Generosity — natural birthday-arc fit.

async function main(): Promise<void> {
  // ─── Lookup theme + moral ───
  const themeRow = await db
    .select()
    .from(themes)
    .where(eq(themes.slug, THEME_SLUG))
    .limit(1)
    .then((r) => r[0]);
  if (!themeRow) {
    throw new Error(
      `Theme slug '${THEME_SLUG}' not found. Run pnpm tsx src/scripts/seed-themes.ts first.`,
    );
  }
  const moralRow = await db
    .select()
    .from(moralValues)
    .where(eq(moralValues.nameAr, MORAL_NAME_AR))
    .limit(1)
    .then((r) => r[0]);
  if (!moralRow) {
    throw new Error(
      `Moral '${MORAL_NAME_AR}' not found. Run pnpm tsx src/scripts/seed-moral-values.ts first.`,
    );
  }
  console.log(
    `→ Theme: ${themeRow.titleAr} (${themeRow.titleEn}); Moral: ${moralRow.nameAr} (${moralRow.nameEn})`,
  );

  // ─── Step 1: Create order + upload photo ───
  const orderId = randomUUID();
  console.log(`\n→ Inserting order ${orderId}...`);
  await db.insert(orders).values({
    id: orderId,
    themeId: themeRow.id,
    moralValueId: moralRow.id,
    status: "test_pixar_3page",
    style: "pixar_3d",
    childName: CHILD_NAME,
    childAgeBand: CHILD_AGE_BAND,
    childAgeExact: CHILD_AGE_EXACT,
    childGender: CHILD_GENDER,
    appearanceInputType: "photo",
    specialOccasionText: `عيد ميلاد ${CHILD_NAME} الخامس`,
    buyerName: "Test (Sprint 3 verification)",
  });

  console.log(`→ Uploading photo (${PHOTO_PATH})...`);
  const photoBuf = readFileSync(PHOTO_PATH);
  const photoUpload = await uploadImage(
    photoBuf,
    orderId,
    "main_child",
    "image/jpeg",
  );
  await db.insert(photosTable).values({
    orderId,
    ownerType: "main_child",
    url: photoUpload.url,
    contentType: photoUpload.contentType,
    fileSize: photoUpload.fileSize,
  });
  console.log(`  ✓ Photo URL: ${photoUpload.url}`);

  // ─── Step 2: Generate story (4 pages) ───
  console.log("\n→ Generating story (gpt-4o, 4 pages)...");
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
    `# Special occasion (frame the opening scene around this)`,
    `عيد ميلاد ${CHILD_NAME} الخامس — في بيت العيلة في القاهرة`,
    ``,
    `Produce the story now in the structured JSON output format. Apply all craft rules from the system prompt. Output exactly ${PAGE_COUNT} pages.`,
  ].join("\n");

  const storyGen = await generateObject({
    model: openai("gpt-4o"),
    schema: storyOutputSchema,
    system: systemPrompt,
    prompt: userPrompt,
    temperature: 0.7,
    maxTokens: 4000,
  });
  const story = storyGen.object;
  if (story.pages.length !== PAGE_COUNT) {
    throw new Error(
      `Expected ${PAGE_COUNT} pages from story gen, got ${story.pages.length}`,
    );
  }
  console.log(`  ✓ Title: ${story.title}`);
  console.log(`  ✓ ${story.pages.length} pages`);
  for (const p of story.pages) {
    console.log(
      `    p${p.number} [${p.act}] charactersOnPage=${JSON.stringify(p.charactersOnPage)} key='${p.keyObjectOrDetail}'`,
    );
  }

  // ─── Step 3: Generate Bible ───
  console.log("\n→ Generating Bible (gpt-4o + vision)...");
  const bible = await generateBible({
    story,
    wizardData: {
      childName: CHILD_NAME,
      childAgeBand: CHILD_AGE_BAND,
      childAgeExact: CHILD_AGE_EXACT,
      childGender: CHILD_GENDER,
      theme: themeRow.titleAr ?? "عيد ميلاد",
      moralValue: moralRow.nameAr ?? "الكرم",
      photoUrl: photoUpload.url,
      personaId: null,
    },
  });
  console.log(
    `  ✓ Bible — supportingCharacters: ${bible.characterBible.supportingCharacters.length}`,
  );
  for (const sc of bible.characterBible.supportingCharacters) {
    console.log(
      `    - ${sc.name} (${sc.relationship}): ${sc.appearance.slice(0, 90)}...`,
    );
  }
  console.log(`  ✓ Bible styleBible.medium: ${bible.styleBible.medium.slice(0, 100)}...`);

  // ─── Step 4: Persist generation row ───
  const genId = randomUUID();
  console.log(`\n→ Creating generation ${genId}...`);
  await db.insert(generations).values({
    id: genId,
    orderId,
    status: "generating_illustrations",
    storyJson: story,
    bibleJson: bible,
    illustrationsCount: 1 + BODY_PAGES_TO_RENDER.length,
    estimatedCostCents: 50,
    startedAt: new Date(),
  });

  // ─── Step 5: Cover ───
  console.log("\n→ Generating cover (Nano Banana 2)...");
  const coverPrompts = buildIllustrationPrompt({
    bible,
    scene: story.coverDescription,
    pageNumber: 0,
    hasReferencePhotos: true,
  });
  console.log(`  prompt length: ${coverPrompts.positive.length} chars`);
  const coverResult = await generateCoverIllustration({
    orderId,
    positivePrompt: coverPrompts.positive,
    negativePrompt: coverPrompts.negative,
    customerPhotoUrls: [photoUpload.url],
  });
  console.log(`  ✓ Cover URL: ${coverResult.url}`);
  await db
    .update(generations)
    .set({ coverUrl: coverResult.url, updatedAt: new Date() })
    .where(eq(generations.id, genId));

  // ─── Step 6: Body pages 1, 2, 3 ───
  for (const pageNum of BODY_PAGES_TO_RENDER) {
    const page = story.pages.find((p) => p.number === pageNum);
    if (!page) {
      console.log(`⚠️  Page ${pageNum} missing — skipping`);
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
      orderId,
      pageNumber: pageNum,
      positivePrompt: pagePrompts.positive,
      negativePrompt: pagePrompts.negative,
      coverImageUrl: coverResult.url,
      customerPhotoUrls: [photoUpload.url],
    });
    console.log(`  ✓ Page ${pageNum} URL: ${pageResult.url}`);

    await db.insert(bookPages).values({
      generationId: genId,
      pageNumber: pageNum,
      storyText: page.text,
      illustrationUrl: pageResult.url,
      illustrationPrompt: pagePrompts.positive.slice(0, 2000),
      illustrationProvider: pageResult.modelId,
      illustrationGeneratedAt: new Date(),
    });
  }

  // ─── Step 7: Mark awaiting_review (no PDF — only 3 of 4 pages rendered) ───
  await db
    .update(generations)
    .set({
      status: "awaiting_review",
      updatedAt: new Date(),
      completedAt: new Date(),
    })
    .where(eq(generations.id, genId));

  console.log("\n✅ Test generation complete.");
  console.log(`   Order ID:      ${orderId}`);
  console.log(`   Generation ID: ${genId}`);
  console.log(`   Admin URL:     https://hadouta-admin.vercel.app/orders/${genId}`);
  console.log(`   Cover:         ${coverResult.url}`);
}

main()
  .catch((err) => {
    console.error("\n❌ Test generation failed:", err);
    process.exit(1);
  })
  .then(() => process.exit(0));
