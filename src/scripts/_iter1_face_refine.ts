// ITERATION 1 — Two-stage face refinement on Nano Banana 2.
//
// Hypothesis: cartoon-transfer websites achieve perfect face fidelity because
// they do img2img with low denoising — keeping the input photo's facial
// geometry while changing render style. We replicate that here by treating
// the EXISTING illustration as the "scene" and the customer photo as the
// "face source," and asking Nano Banana 2 to edit ONLY the protagonist's
// face to match the photo while preserving everything else.
//
// Inputs: cover + page 1 + page 3 from the watercolor trial generation
// (68d5add6-...). For each, pass [illustration, customer_photo] as
// image_urls with a focused face-refinement prompt.
//
// Cost: 3 × $0.08 = ~$0.24
//
// Run: pnpm tsx src/scripts/_iter1_face_refine.ts

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

const SOURCE_GEN_ID = "68d5add6-48da-4a3e-baf3-054ad2162326"; // watercolor trial
const ORDER_ID = "76e6226a-452e-47d6-9209-b53717d6d1cd";
const NANO_BANANA_2_EDIT = "fal-ai/nano-banana-2/edit";
const PAGES_TO_REFINE = [1, 3] as const; // page 1 = Hena+Mama, page 3 = Hena+Sara

async function downloadAsBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

function buildFaceRefinePrompt(args: {
  childName: string;
  isCover: boolean;
  charactersOnPage: string[];
}): string {
  const otherChars = args.charactersOnPage.filter((c) => c !== args.childName);
  const otherCharsClause =
    otherChars.length > 0
      ? `Other characters present in this illustration (${otherChars.join(", ")}) MUST keep their distinct faces from Image 1 — do NOT apply Image 2's face to them.`
      : `${args.childName} is alone in this illustration.`;

  return [
    `[FACE REFINEMENT TASK — surgical edit, preserve everything else]`,
    ``,
    `Image 1 is the existing illustration. Image 2 is a reference photo of ${args.childName}.`,
    ``,
    `Your task: edit ONLY the face of ${args.childName} (the protagonist) in Image 1 so it matches the face in Image 2 EXACTLY. Preserve every other element of Image 1: the watercolor style, the scene, the composition, the colors, the supporting characters, the props, the backgrounds, the lighting, the pose, the clothing — all unchanged.`,
    ``,
    `${otherCharsClause}`,
    ``,
    `Match in ${args.childName}'s face: eye shape, eye color, eye spacing, nose shape and width, mouth shape and smile, jaw line, face shape, hair color, hair texture, hair styling, skin tone, eyebrows, any dimples or freckles or distinguishing features visible in Image 2. The painted/watercolor surface treatment of the face stays from Image 1, but the underlying facial GEOMETRY must match Image 2.`,
    ``,
    `Critical constraints:`,
    `- Output is the SAME illustration as Image 1 with ONLY the protagonist's face refined to match Image 2's identity.`,
    `- Keep the soft watercolor style: visible brush strokes, wet-on-wet bleeds, cream paper texture. Image 2 is a sharp digital photo — do NOT make Image 1 photorealistic.`,
    `- Do NOT change the pose, expression direction, body, clothing, background, supporting characters, or any other part of the image.`,
    `- Eyes painted with crisp edges to anchor identity; rest of face soft watercolor.`,
    `- No text, letters, or typography anywhere.`,
    `${args.isCover ? `- Cover composition: subject upper two-thirds, neutral lower third (PDF cover layout).` : ``}`,
  ]
    .filter(Boolean)
    .join("\n");
}

async function refineImage(args: {
  illustrationUrl: string;
  customerPhotoUrl: string;
  prompt: string;
}): Promise<{ url: string; contentType: string }> {
  const result = await fal.subscribe(NANO_BANANA_2_EDIT, {
    input: {
      prompt: args.prompt,
      image_urls: [args.illustrationUrl, args.customerPhotoUrl],
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

  console.log(`Iteration 1 — Two-stage face refinement on Nano Banana 2\n`);

  // Load source watercolor trial
  const sourceGen = await db
    .select()
    .from(generations)
    .where(eq(generations.id, SOURCE_GEN_ID))
    .limit(1)
    .then((r) => r[0]);
  if (!sourceGen?.coverUrl || !sourceGen?.storyJson) {
    throw new Error("Source generation missing cover or story");
  }
  const story = sourceGen.storyJson as {
    title: string;
    pages: Array<{
      number: number;
      text: string;
      charactersOnPage: string[];
    }>;
  };
  console.log(`✓ Source: "${story.title}"`);
  console.log(`✓ Source cover: ${sourceGen.coverUrl.split("/").slice(-1)[0]}`);

  // Load customer photo
  const photoRows = await db
    .select({ url: photosTable.url })
    .from(photosTable)
    .where(eq(photosTable.orderId, ORDER_ID));
  const photoUrls = photoRows
    .map((r) => r.url)
    .filter((u): u is string => typeof u === "string" && u.length > 0);
  if (photoUrls.length === 0) throw new Error("No customer photos");
  const customerPhotoUrl = photoUrls[0]!;
  console.log(`✓ Customer photo: ${customerPhotoUrl.split("/").slice(-1)[0]}`);

  // Load source bookPages for the pages we want to refine
  const sourcePages = await db
    .select()
    .from(bookPages)
    .where(eq(bookPages.generationId, SOURCE_GEN_ID));
  console.log(`✓ ${sourcePages.length} source bookPages\n`);

  // Create iteration generation row
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

  // ─── Refine cover ───
  console.log(`→ Refining cover (face → match customer photo)...`);
  const coverPrompt = buildFaceRefinePrompt({
    childName: "Hena",
    isCover: true,
    charactersOnPage: ["Hena"], // cover is mostly protagonist
  });
  const coverRefined = await refineImage({
    illustrationUrl: sourceGen.coverUrl,
    customerPhotoUrl,
    prompt: coverPrompt,
  });
  console.log(`  raw: ${coverRefined.url.split("/").slice(-1)[0]}`);
  const coverBuf = await downloadAsBuffer(coverRefined.url);
  const coverUploaded = await uploadImage(
    coverBuf,
    ORDER_ID,
    "illustration_cover_iter1",
    coverRefined.contentType,
  );
  console.log(`  ✓ ${coverUploaded.url}`);
  await db
    .update(generations)
    .set({ coverUrl: coverUploaded.url, updatedAt: new Date() })
    .where(eq(generations.id, iterGenId));

  // ─── Refine pages 1, 3 ───
  for (const pageNum of PAGES_TO_REFINE) {
    const sourceBookPage = sourcePages.find((p) => p.pageNumber === pageNum);
    const storyPage = story.pages.find((p) => p.number === pageNum);
    if (!sourceBookPage?.illustrationUrl || !storyPage) {
      console.log(`⚠️  Page ${pageNum} missing, skipping`);
      continue;
    }
    console.log(
      `\n→ Refining page ${pageNum} (chars: ${JSON.stringify(storyPage.charactersOnPage)})...`,
    );
    const pagePrompt = buildFaceRefinePrompt({
      childName: "Hena",
      isCover: false,
      charactersOnPage: storyPage.charactersOnPage,
    });
    const pageRefined = await refineImage({
      illustrationUrl: sourceBookPage.illustrationUrl,
      customerPhotoUrl,
      prompt: pagePrompt,
    });
    console.log(`  raw: ${pageRefined.url.split("/").slice(-1)[0]}`);
    const pageBuf = await downloadAsBuffer(pageRefined.url);
    const pageUploaded = await uploadImage(
      pageBuf,
      ORDER_ID,
      `illustration_page_${pageNum}_iter1`,
      pageRefined.contentType,
    );
    console.log(`  ✓ ${pageUploaded.url}`);
    await db.insert(bookPages).values({
      generationId: iterGenId,
      pageNumber: pageNum,
      storyText: storyPage.text,
      illustrationUrl: pageUploaded.url,
      illustrationPrompt: pagePrompt.slice(0, 2000),
      illustrationProvider: "nano-banana-2-edit-iter1",
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

  console.log(`\n✅ Iteration 1 complete.`);
  console.log(`   Generation ID: ${iterGenId}`);
  console.log(`   Admin URL:     https://hadouta-admin.vercel.app/orders/${iterGenId}`);
  console.log(`   Watercolor baseline: https://hadouta-admin.vercel.app/orders/${SOURCE_GEN_ID}`);
}

main()
  .catch((err) => {
    console.error("\n❌ Iter 1 failed:", err);
    process.exit(1);
  })
  .then(() => process.exit(0));
