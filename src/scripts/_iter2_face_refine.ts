// ITERATION 2 — Reversed reference order + stronger field-by-field face match.
//
// Iter 1 used image_urls = [illustration, photo] — illustration weighted first.
// Iter 2 reverses: image_urls = [photo, illustration] — customer photo weighted
// first, illustration becomes the "render this style" reference. Per Google's
// Gemini image guidance, autoregressive multimodal models weight the first
// reference image most heavily.
//
// Cost: 3 × $0.08 = ~$0.24 (will exhaust remaining fal.ai budget).
//
// Run: pnpm tsx src/scripts/_iter2_face_refine.ts

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

const SOURCE_GEN_ID = "68d5add6-48da-4a3e-baf3-054ad2162326"; // watercolor baseline
const ORDER_ID = "76e6226a-452e-47d6-9209-b53717d6d1cd";
const NANO_BANANA_2_EDIT = "fal-ai/nano-banana-2/edit";
const PAGES_TO_REFINE = [1, 3] as const;

async function downloadAsBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

function buildIter2Prompt(args: {
  childName: string;
  isCover: boolean;
  charactersOnPage: string[];
}): string {
  const otherChars = args.charactersOnPage.filter((c) => c !== args.childName);
  const otherCharsClause =
    otherChars.length > 0
      ? `Other characters in Image 2 (${otherChars.join(", ")}) keep their existing distinct faces — do NOT apply Image 1's face to ${otherChars.join(" or ")}.`
      : `${args.childName} is alone in this scene.`;

  // ITER 2 KEY CHANGE: Image 1 = customer photo (highest weight), Image 2 = illustration.
  // Field-by-field face match instruction is more granular than iter 1's prose.
  return [
    `Image 1 is a sharp digital photo of ${args.childName} — the IDENTITY SOURCE.`,
    `Image 2 is the existing watercolor illustration — the SCENE / STYLE / COMPOSITION SOURCE.`,
    ``,
    `Your task: produce an image that has Image 1's FACE on ${args.childName} composed into Image 2's exact scene, style, and composition.`,
    ``,
    `Match these specific facial features from Image 1 onto ${args.childName} in the output (do NOT invent variations):`,
    `- Eye shape: same as Image 1 — almond / round / monolid / etc., exact spacing between eyes`,
    `- Eye color: exact same color as Image 1`,
    `- Eyebrow shape and density: same as Image 1`,
    `- Nose shape: same width, length, tip shape as Image 1`,
    `- Mouth shape and lip thickness: same as Image 1, including the natural smile shape`,
    `- Jaw and chin shape: same as Image 1 (round / oval / heart / square)`,
    `- Face shape and proportions overall: same as Image 1`,
    `- Skin tone: same warmth and depth as Image 1`,
    `- Hair color, hair texture, hair length, hair styling (curly / wavy / straight, ponytail / loose, any bow / ribbon / accessories): same as Image 1`,
    `- Distinguishing features in Image 1 (dimples, freckles, gap teeth, ear shape, earrings if visible): preserve them all`,
    ``,
    `Take from Image 2 (do NOT invent variations):`,
    `- The watercolor style (visible brush strokes, wet-on-wet bleeds, cream paper texture)`,
    `- The composition and pose of ${args.childName}`,
    `- The setting, props, lighting, color palette`,
    `- The supporting characters if any (their distinct faces unchanged)`,
    `- ${args.isCover ? "The cover composition with subject upper two-thirds" : "The body-page framing"}`,
    ``,
    otherCharsClause,
    ``,
    `Output: same illustration as Image 2 with ${args.childName}'s face replaced field-by-field by Image 1's face. Watercolor stylized — but the underlying face GEOMETRY must match Image 1 unmistakably (the goal is a viewer instantly recognizes ${args.childName} as the child in Image 1).`,
    ``,
    `Constraints: keep watercolor style; eyes painted with crisper edges than rest of face; no text or typography anywhere; no photorealism; do not change anything in Image 2 outside ${args.childName}'s face region.`,
  ]
    .filter(Boolean)
    .join("\n");
}

async function refineImage(args: {
  customerPhotoUrl: string;
  illustrationUrl: string;
  prompt: string;
}): Promise<{ url: string; contentType: string }> {
  const result = await fal.subscribe(NANO_BANANA_2_EDIT, {
    input: {
      prompt: args.prompt,
      // ITER 2 CRITICAL CHANGE: photo first (Image 1), illustration second (Image 2)
      image_urls: [args.customerPhotoUrl, args.illustrationUrl],
      aspect_ratio: "3:4" as const,
      output_format: "png" as const,
      num_images: 1,
    },
    logs: false,
  });
  const image = (
    result as { data?: { images?: Array<{ url?: string; content_type?: string }> } }
  ).data?.images?.[0];
  if (!image?.url) throw new Error("No image returned");
  return { url: image.url, contentType: image.content_type ?? "image/png" };
}

async function main(): Promise<void> {
  const key = process.env.FAL_KEY;
  if (!key) throw new Error("FAL_KEY not set");
  fal.config({ credentials: key });

  console.log(`Iteration 2 — REVERSED reference order [photo, illustration]\n`);

  const sourceGen = await db
    .select()
    .from(generations)
    .where(eq(generations.id, SOURCE_GEN_ID))
    .limit(1)
    .then((r) => r[0]);
  if (!sourceGen?.coverUrl || !sourceGen?.storyJson) {
    throw new Error("Source generation missing");
  }
  const story = sourceGen.storyJson as {
    title: string;
    pages: Array<{ number: number; text: string; charactersOnPage: string[] }>;
  };

  const photoRows = await db
    .select({ url: photosTable.url })
    .from(photosTable)
    .where(eq(photosTable.orderId, ORDER_ID));
  const customerPhotoUrl = photoRows
    .map((r) => r.url)
    .filter((u): u is string => typeof u === "string" && u.length > 0)[0];
  if (!customerPhotoUrl) throw new Error("No customer photos");

  const sourcePages = await db
    .select()
    .from(bookPages)
    .where(eq(bookPages.generationId, SOURCE_GEN_ID));

  const iterGenId = randomUUID();
  await db.insert(generations).values({
    id: iterGenId,
    orderId: ORDER_ID,
    status: "generating_illustrations",
    storyJson: sourceGen.storyJson,
    bibleJson: sourceGen.bibleJson,
    illustrationsCount: 1 + PAGES_TO_REFINE.length,
    estimatedCostCents: 24,
    startedAt: new Date(),
  });

  // Cover
  console.log(`→ Cover refinement [photo, illustration]...`);
  const coverPrompt = buildIter2Prompt({
    childName: "Hena",
    isCover: true,
    charactersOnPage: ["Hena"],
  });
  const coverRefined = await refineImage({
    customerPhotoUrl,
    illustrationUrl: sourceGen.coverUrl,
    prompt: coverPrompt,
  });
  const coverBuf = await downloadAsBuffer(coverRefined.url);
  const coverUploaded = await uploadImage(
    coverBuf,
    ORDER_ID,
    "illustration_cover_iter2",
    coverRefined.contentType,
  );
  console.log(`  ✓ ${coverUploaded.url}`);
  await db
    .update(generations)
    .set({ coverUrl: coverUploaded.url, updatedAt: new Date() })
    .where(eq(generations.id, iterGenId));

  // Pages
  for (const pageNum of PAGES_TO_REFINE) {
    const sourceBookPage = sourcePages.find((p) => p.pageNumber === pageNum);
    const storyPage = story.pages.find((p) => p.number === pageNum);
    if (!sourceBookPage?.illustrationUrl || !storyPage) continue;
    console.log(
      `\n→ Page ${pageNum} refinement (chars: ${JSON.stringify(storyPage.charactersOnPage)})...`,
    );
    const pagePrompt = buildIter2Prompt({
      childName: "Hena",
      isCover: false,
      charactersOnPage: storyPage.charactersOnPage,
    });
    const pageRefined = await refineImage({
      customerPhotoUrl,
      illustrationUrl: sourceBookPage.illustrationUrl,
      prompt: pagePrompt,
    });
    const pageBuf = await downloadAsBuffer(pageRefined.url);
    const pageUploaded = await uploadImage(
      pageBuf,
      ORDER_ID,
      `illustration_page_${pageNum}_iter2`,
      pageRefined.contentType,
    );
    console.log(`  ✓ ${pageUploaded.url}`);
    await db.insert(bookPages).values({
      generationId: iterGenId,
      pageNumber: pageNum,
      storyText: storyPage.text,
      illustrationUrl: pageUploaded.url,
      illustrationPrompt: pagePrompt.slice(0, 2000),
      illustrationProvider: "nano-banana-2-edit-iter2",
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
    .where(eq(generations.id, iterGenId));

  console.log(`\n✅ Iteration 2 complete.`);
  console.log(`   Generation ID: ${iterGenId}`);
  console.log(`   Admin URL:     https://hadouta-admin.vercel.app/orders/${iterGenId}`);
  console.log(`\n   Compare:`);
  console.log(`   Watercolor baseline: https://hadouta-admin.vercel.app/orders/${SOURCE_GEN_ID}`);
  console.log(`   Iter 1 [illust, photo]: https://hadouta-admin.vercel.app/orders/c90aceae-63a0-4de1-9251-6330cc9e9718`);
  console.log(`   Iter 2 [photo, illust]: https://hadouta-admin.vercel.app/orders/${iterGenId}`);
}

main()
  .catch((err) => {
    console.error("\n❌ Iter 2 failed:", err);
    process.exit(1);
  })
  .then(() => process.exit(0));
