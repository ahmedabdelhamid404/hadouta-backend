// Qwen-Image-Edit-2511 dual-reference trial: re-render Hana's pages 1, 2, 3
// with image_urls = [cover_url, customer_photo] instead of just [customer_photo].
//
// Hypothesis: passing the cover as a second reference gives Qwen scene-context
// anchor for HOW Hena fits among other characters, so the customer photo doesn't
// bleed into supporting-character faces. Tests whether the multi-Hena horror
// is architectural (Qwen reasoning ceiling) or fixable (just need scene anchor).
//
// Cost: 3 × $0.04 = ~$0.12. Reuses existing Qwen cover.
//
// Run: pnpm tsx src/scripts/_qwen-dual-ref-trial.ts

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

const PRIOR_QWEN_GEN_ID = "6522f0d5-4915-4882-b984-147cd78fc872"; // Has the cover we reuse
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
  if (!image?.url) throw new Error("Qwen returned no image");
  return { url: image.url, contentType: image.content_type ?? "image/png" };
}

async function main(): Promise<void> {
  const key = process.env.FAL_KEY;
  if (!key) throw new Error("FAL_KEY not set");
  fal.config({ credentials: key });

  console.log(`Qwen DUAL-REFERENCE trial — pages 1, 2, 3 with [cover, photo]\n`);

  // Load prior Qwen gen for story+bible+cover
  const priorGen = await db
    .select()
    .from(generations)
    .where(eq(generations.id, PRIOR_QWEN_GEN_ID))
    .limit(1)
    .then((r) => r[0]);
  if (!priorGen?.bibleJson || !priorGen?.storyJson || !priorGen?.coverUrl) {
    throw new Error("Prior Qwen generation missing required data");
  }
  const bible = priorGen.bibleJson as Bible;
  const story = priorGen.storyJson as StoryOutput;
  const coverUrl = priorGen.coverUrl;
  console.log(`✓ Reusing cover: ${coverUrl.split("/").slice(-1)[0]}`);
  console.log(`✓ Story: "${story.title}"\n`);

  // Load customer photos
  const photoRows = await db
    .select({ url: photosTable.url })
    .from(photosTable)
    .where(eq(photosTable.orderId, ORDER_ID));
  const photoUrls = photoRows
    .map((r) => r.url)
    .filter((u): u is string => typeof u === "string" && u.length > 0);
  if (photoUrls.length === 0) throw new Error("No customer photos");

  // KEY DIFFERENCE: image_urls includes BOTH the cover AND the customer photo.
  // Last trial passed only [customer_photo]. This trial passes [cover, photo].
  const imageUrls = [coverUrl, ...photoUrls];
  console.log(`✓ image_urls strategy: [cover, customer_photo] (${imageUrls.length} refs)\n`);

  // Create new generation row
  const newGenId = randomUUID();
  console.log(`→ Creating dual-ref generation ${newGenId}...`);
  await db.insert(generations).values({
    id: newGenId,
    orderId: ORDER_ID,
    status: "generating_illustrations",
    storyJson: story,
    bibleJson: bible,
    coverUrl, // Reuse the same cover for clean comparison
    illustrationsCount: PAGES_TO_RENDER.length,
    estimatedCostCents: 12,
    startedAt: new Date(),
  });

  const startedAt = Date.now();
  for (const pageNum of PAGES_TO_RENDER) {
    const page = story.pages.find((p) => p.number === pageNum);
    if (!page) continue;
    console.log(
      `\n→ Page ${pageNum} (chars: ${JSON.stringify(page.charactersOnPage)})`,
    );
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
      imageUrls,
    });
    const pageBuf = await downloadAsBuffer(pageImage.url);
    const pageUploaded = await uploadImage(
      pageBuf,
      ORDER_ID,
      `illustration_page_${pageNum}_qwen_dualref`,
      pageImage.contentType,
    );
    console.log(`  ✓ ${pageUploaded.url}`);

    await db.insert(bookPages).values({
      generationId: newGenId,
      pageNumber: pageNum,
      storyText: page.text,
      illustrationUrl: pageUploaded.url,
      illustrationPrompt: prompts.positive.slice(0, 2000),
      illustrationProvider: "qwen-image-edit-2511-dualref",
      illustrationGeneratedAt: new Date(),
    });
  }

  await db
    .update(generations)
    .set({
      status: "awaiting_review",
      updatedAt: new Date(),
      completedAt: new Date(),
    })
    .where(eq(generations.id, newGenId));

  const totalSec = (Date.now() - startedAt) / 1000;
  console.log(`\n✅ Dual-ref trial complete in ${totalSec.toFixed(1)}s.`);
  console.log(`   Generation ID: ${newGenId}`);
  console.log(`   Admin URL:     https://hadouta-admin.vercel.app/orders/${newGenId}`);
  console.log(`\n   3-way comparison:`);
  console.log(`   Nano Banana (trash):   https://hadouta-admin.vercel.app/orders/dfb7d9d5-7ff7-4a24-83ce-bd645251d17e`);
  console.log(`   Qwen single-ref:       https://hadouta-admin.vercel.app/orders/${PRIOR_QWEN_GEN_ID}`);
  console.log(`   Qwen dual-ref (this):  https://hadouta-admin.vercel.app/orders/${newGenId}`);
}

main()
  .catch((err) => {
    console.error("\n❌ Trial failed:", err);
    process.exit(1);
  })
  .then(() => process.exit(0));
