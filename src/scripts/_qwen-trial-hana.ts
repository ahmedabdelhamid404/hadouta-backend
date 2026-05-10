// Qwen-Image-Edit-2511 trial: regenerate Hana's cover + first 3 pages on
// `fal-ai/qwen-image-edit-2511` (Apache 2.0 license, Alibaba Dec 2025) for
// side-by-side comparison vs the Nano Banana 2 run that produced trash output.
//
// Reuses the existing story + Bible + customer photo (no text re-spend).
// Creates a NEW generation row so admin shows both runs side-by-side.
// Cost: ~4 × $0.04 = ~$0.16.
//
// Run: pnpm tsx src/scripts/_qwen-trial-hana.ts

import "dotenv/config";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { fal } from "@fal-ai/client";
import { db } from "../db/index.js";
import {
  generations,
  bookPages,
  photos as photosTable,
} from "../db/schema.js";
import { uploadImage } from "../lib/cloudinary.js";
import { buildIllustrationPrompt } from "../lib/ai/prompts/build-illustration-prompt.js";
import type { Bible } from "../lib/ai/schemas/bible.js";
import type { StoryOutput } from "../lib/ai/schemas/story.js";

const SOURCE_GEN_ID = "dfb7d9d5-7ff7-4a24-83ce-bd645251d17e"; // The trash Hana run
const ORDER_ID = "76e6226a-452e-47d6-9209-b53717d6d1cd";
const QWEN_ENDPOINT = "fal-ai/qwen-image-edit-2511";
const PAGES_TO_RENDER = [1, 2, 3] as const;

async function downloadAsBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function callQwen(args: {
  positivePrompt: string;
  negativePrompt: string;
  imageUrls: string[];
}): Promise<{ url: string; contentType: string }> {
  // Qwen-Image-Edit-2511 endpoint shape per fal.ai docs (verified 2026-05-08):
  //   - prompt: string (required)
  //   - image_urls: string[] (required for edit mode)
  //   - negative_prompt: string (optional — REAL field, unlike Nano Banana 2)
  //   - image_size: enum "portrait_4_3" matches our 3:4 aspect choice
  //   - num_inference_steps: 28 default; bumped slightly for quality
  //   - guidance_scale: 4.5 default
  //   - num_images: 1
  //   - output_format: png
  const result = await fal.subscribe(QWEN_ENDPOINT, {
    input: {
      prompt: args.positivePrompt,
      image_urls: args.imageUrls,
      negative_prompt: args.negativePrompt || "",
      image_size: "portrait_4_3" as const,
      num_inference_steps: 32,
      guidance_scale: 4.5,
      num_images: 1,
      output_format: "png" as const,
    },
    logs: false,
  });
  const image = (
    result as { data?: { images?: Array<{ url?: string; content_type?: string }> } }
  ).data?.images?.[0];
  if (!image?.url) {
    throw new Error(
      `Qwen returned no image. Response: ${JSON.stringify(result.data ?? null).slice(0, 500)}`,
    );
  }
  return { url: image.url, contentType: image.content_type ?? "image/png" };
}

async function main(): Promise<void> {
  const key = process.env.FAL_KEY;
  if (!key) throw new Error("FAL_KEY not set");
  fal.config({ credentials: key });

  console.log(`Qwen-Image-Edit-2511 trial — Hana cover + pages 1-3\n`);

  // ─── Load source generation (Hana's existing story + Bible) ───
  const sourceGen = await db
    .select()
    .from(generations)
    .where(eq(generations.id, SOURCE_GEN_ID))
    .limit(1)
    .then((r) => r[0]);
  if (!sourceGen?.bibleJson || !sourceGen?.storyJson) {
    throw new Error("Source generation missing story/bible");
  }
  const bible = sourceGen.bibleJson as Bible;
  const story = sourceGen.storyJson as StoryOutput;
  console.log(`✓ Source: "${story.title}"`);
  console.log(
    `  supportingChars: ${bible.characterBible.supportingCharacters.map((s) => s.name).join(", ")}`,
  );

  // ─── Load customer photos ───
  const photoRows = await db
    .select({ url: photosTable.url })
    .from(photosTable)
    .where(eq(photosTable.orderId, ORDER_ID));
  const photoUrls = photoRows
    .map((r) => r.url)
    .filter((u): u is string => typeof u === "string" && u.length > 0);
  if (photoUrls.length === 0) throw new Error("No customer photos");
  console.log(`✓ ${photoUrls.length} customer photo(s)`);

  // ─── Create new Qwen-trial generation row ───
  const newGenId = randomUUID();
  console.log(`\n→ Creating Qwen trial generation ${newGenId}...`);
  await db.insert(generations).values({
    id: newGenId,
    orderId: ORDER_ID,
    status: "generating_illustrations",
    storyJson: story,
    bibleJson: bible,
    illustrationsCount: 1 + PAGES_TO_RENDER.length,
    estimatedCostCents: 16, // 4 × $0.04
    startedAt: new Date(),
  });

  // ─── Cover ───
  console.log(`\n→ Cover (Qwen)...`);
  const coverPrompts = buildIllustrationPrompt({
    bible,
    scene: story.coverDescription,
    pageNumber: 0,
    hasReferencePhotos: true,
  });
  const startedAt = Date.now();
  const coverImage = await callQwen({
    positivePrompt: coverPrompts.positive,
    negativePrompt: bible.styleBible.negativeStyle, // Use bible's negative style now that Qwen accepts it
    imageUrls: photoUrls,
  });
  console.log(`  Raw URL: ${coverImage.url}`);
  // Upload to our Cloudinary so it appears in admin like other generations
  const coverBuf = await downloadAsBuffer(coverImage.url);
  const coverUploaded = await uploadImage(
    coverBuf,
    ORDER_ID,
    "illustration_cover_qwen",
    coverImage.contentType,
  );
  console.log(`  ✓ Stored: ${coverUploaded.url}`);
  await db
    .update(generations)
    .set({ coverUrl: coverUploaded.url, updatedAt: new Date() })
    .where(eq(generations.id, newGenId));

  // ─── Body pages 1, 2, 3 ───
  for (const pageNum of PAGES_TO_RENDER) {
    const page = story.pages.find((p) => p.number === pageNum);
    if (!page) {
      console.log(`⚠️ Page ${pageNum} missing — skipping`);
      continue;
    }
    console.log(`\n→ Page ${pageNum} (Qwen): "${page.scene.slice(0, 60)}..."`);
    const prompts = buildIllustrationPrompt({
      bible,
      scene: page.scene,
      pageNumber: pageNum,
      hasReferencePhotos: true,
      charactersOnPage: page.charactersOnPage,
      keyObjectOrDetail: page.keyObjectOrDetail,
    });
    const pageImage = await callQwen({
      positivePrompt: prompts.positive,
      negativePrompt: bible.styleBible.negativeStyle,
      imageUrls: photoUrls,
    });
    console.log(`  Raw URL: ${pageImage.url}`);
    const pageBuf = await downloadAsBuffer(pageImage.url);
    const pageUploaded = await uploadImage(
      pageBuf,
      ORDER_ID,
      `illustration_page_${pageNum}_qwen`,
      pageImage.contentType,
    );
    console.log(`  ✓ Stored: ${pageUploaded.url}`);

    await db.insert(bookPages).values({
      generationId: newGenId,
      pageNumber: pageNum,
      storyText: page.text,
      illustrationUrl: pageUploaded.url,
      illustrationPrompt: prompts.positive.slice(0, 2000),
      illustrationProvider: "qwen-image-edit-2511",
      illustrationGeneratedAt: new Date(),
    });
  }

  // ─── Mark awaiting_review (no PDF — only 3 of 16 body pages rendered) ───
  await db
    .update(generations)
    .set({
      status: "awaiting_review",
      updatedAt: new Date(),
      completedAt: new Date(),
    })
    .where(eq(generations.id, newGenId));

  const totalSec = (Date.now() - startedAt) / 1000;
  console.log(`\n✅ Qwen trial complete in ${totalSec.toFixed(1)}s.`);
  console.log(`   Generation ID: ${newGenId}`);
  console.log(`   Admin URL:     https://hadouta-admin.vercel.app/orders/${newGenId}`);
  console.log(`\n   Compare side-by-side with the Nano Banana run:`);
  console.log(`   https://hadouta-admin.vercel.app/orders/${SOURCE_GEN_ID}`);
}

main()
  .catch((err) => {
    console.error("\n❌ Trial failed:", err);
    process.exit(1);
  })
  .then(() => process.exit(0));
