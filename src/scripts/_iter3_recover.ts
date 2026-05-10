// Recovery: persist iter3's already-generated cover + page 1 to DB
// (the run failed mid-script when bookPages.illustration_provider exceeded
// varchar(30) — but the images themselves are uploaded to Cloudinary).
// Then render page 3 to complete the iteration.
//
// Run: pnpm tsx src/scripts/_iter3_recover.ts

import "dotenv/config";
import { randomUUID } from "node:crypto";
import { eq, desc } from "drizzle-orm";
import { GoogleGenAI } from "@google/genai";
import { db } from "../db/index.js";
import {
  generations,
  bookPages,
  photos as photosTable,
} from "../db/schema.js";
import { uploadImage } from "../lib/cloudinary.js";

const ORDER_ID = "76e6226a-452e-47d6-9209-b53717d6d1cd";
const SOURCE_GEN_ID = "68d5add6-48da-4a3e-baf3-054ad2162326";
const MODEL = "gemini-3.1-flash-image-preview";

// Already-generated outputs from the failed iter3 run
const COVER_URL_GENERATED =
  "https://res.cloudinary.com/dvewybhzv/image/upload/v1778321457/hadouta/orders/76e6226a-452e-47d6-9209-b53717d6d1cd/illustration_cover_iter3/gil2etoqtlaeo52o9loh.jpg";
const PAGE_1_URL_GENERATED =
  "https://res.cloudinary.com/dvewybhzv/image/upload/v1778321519/hadouta/orders/76e6226a-452e-47d6-9209-b53717d6d1cd/illustration_page_1_iter3/x0urwf52olccg4ypik4j.jpg";

function shrinkCloudinaryUrl(url: string): string {
  if (!url.includes("res.cloudinary.com") || !url.includes("/upload/")) return url;
  if (url.includes("/upload/c_") || url.includes("/upload/w_")) return url;
  return url.replace("/upload/", "/upload/c_limit,w_1024,f_jpg,q_75/");
}

async function fetchAsBase64(url: string): Promise<{ data: string; mimeType: string }> {
  const res = await fetch(shrinkCloudinaryUrl(url));
  if (!res.ok) throw new Error(`Failed to fetch: ${res.status}`);
  const ct = res.headers.get("content-type") ?? "image/jpeg";
  const buf = Buffer.from(await res.arrayBuffer());
  console.log(`    fetched ${(buf.length / 1024).toFixed(0)}KB`);
  return { data: buf.toString("base64"), mimeType: ct };
}

function poseDirectionFromBeat(beat: string, charactersOnPage: string[], protagonist: string): string {
  const beatLower = beat.toLowerCase();
  const otherChars = charactersOnPage.filter((c) => c !== protagonist);
  const lookingTarget = otherChars.length > 0 ? otherChars[0] : "the action she is performing";

  if (beatLower.includes("anticipat") || beatLower.includes("excited") || beatLower.includes("new beginning"))
    return `${protagonist} is looking ahead at what's coming next, brows slightly raised, lips parted in quiet anticipation — NOT smiling broadly, NOT facing the camera. Her gaze is forward toward the action.`;
  if (beatLower.includes("attempt") && beatLower.includes("fail"))
    return `${protagonist} is looking down or at her hands or at ${lookingTarget}, brow slightly furrowed, mouth in a soft frown or pursed expression — NOT smiling, NOT facing the camera.`;
  if (beatLower.includes("choice") || beatLower.includes("inner") || beatLower.includes("dark"))
    return `${protagonist} is contemplative, vulnerable — eyes possibly cast down or to the side — NOT smiling, NOT facing the camera. Interior moment.`;
  if (beatLower.includes("connection") || beatLower.includes("warmth") || beatLower.includes("belonging") || beatLower.includes("introduc") || beatLower.includes("meet") || beatLower.includes("friend"))
    return `${protagonist} is looking at ${lookingTarget} with quiet warmth, a soft natural expression — NOT a posed broad smile, NOT facing the camera. Her gaze is on the other person.`;
  if (beatLower.includes("courage") || beatLower.includes("brave") || beatLower.includes("decisive"))
    return `${protagonist} is looking forward or at ${lookingTarget}, jaw set, eyes focused — NOT smiling, NOT facing the camera. Summoned courage, not performance.`;
  if (beatLower.includes("notic") || beatLower.includes("observ"))
    return `${protagonist} is looking at ${lookingTarget} — eyes focused on the observed subject — NOT smiling at the camera. Attention is OUT there, not on us.`;
  return `${protagonist} engaged in the scene's action — looking at ${lookingTarget} or at what she's doing. Expression natural to "${beat}" — NOT default smile, NOT facing camera.`;
}

function buildIter3Prompt(args: {
  childName: string;
  isCover: boolean;
  charactersOnPage: string[];
  emotionalBeat: string;
}): string {
  const otherChars = args.charactersOnPage.filter((c) => c !== args.childName);
  const otherCharsClause = otherChars.length > 0
    ? `Other characters in image 2 (${otherChars.join(", ")}) keep their distinct faces — do NOT apply image 1's face to ${otherChars.join(" or ")}.`
    : `${args.childName} is alone.`;
  const poseDirection = args.isCover
    ? `${args.childName} on the cover may be looking forward at the reader (this is the only acceptable place for camera-direct gaze), with a natural genuine expression — NOT a posed plastic smile.`
    : poseDirectionFromBeat(args.emotionalBeat, args.charactersOnPage, args.childName);

  return [
    `Image 1 = sharp digital photo of ${args.childName} (IDENTITY SOURCE).`,
    `Image 2 = existing watercolor illustration (SCENE/STYLE/COMPOSITION SOURCE).`,
    ``,
    `=== POSE + EXPRESSION + GAZE (CRITICAL — DO NOT DEFAULT TO SMILING-AT-CAMERA) ===`,
    `Page emotional beat: "${args.emotionalBeat}"`,
    poseDirection,
    `Children in real life are NOT always smiling at the reader. They look down, sideways, at other characters, at objects. Their expressions are concentrated, curious, sad, focused — appropriate to whatever they are doing. If existing pose in image 2 has ${args.childName} smiling at camera but emotional beat is "${args.emotionalBeat}" — CHANGE the pose and expression to match.`,
    ``,
    `=== FACE IDENTITY MATCH (from Image 1) ===`,
    `1. Eye shape, eye spacing, iris color`,
    `2. Nose bridge width and tip shape`,
    `3. Jaw line and chin shape`,
    `4. Eyebrow shape and thickness`,
    `5. Hair color (exact), hairline, texture`,
    `6. Skin tone (exact)`,
    `7. Mouth/lip shape (NOT expression — just the lip shape)`,
    ``,
    `=== PRESERVE FROM IMAGE 2 ===`,
    `- Watercolor medium, brush texture, paper grain, paint bleed`,
    `- Color palette, lighting, setting, props, supporting characters`,
    `- Soft watercolor style — do NOT photorealize`,
    ``,
    otherCharsClause,
    `Output: watercolor scene from image 2, ${args.childName}'s face from image 1 (geometry-matched), NATURAL pose for "${args.emotionalBeat}". No text/typography. Eyes crisper than rest of face.`,
  ].join("\n");
}

async function generateImage(args: {
  prompt: string;
  customerPhoto: { data: string; mimeType: string };
  illustration: { data: string; mimeType: string };
}): Promise<{ data: string; mimeType: string }> {
  const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_AI_API_KEY! });
  const response = await ai.models.generateContent({
    model: MODEL,
    contents: [{
      role: "user",
      parts: [
        { inlineData: args.customerPhoto },
        { inlineData: args.illustration },
        { text: args.prompt },
      ],
    }],
    config: { responseModalities: ["IMAGE"], temperature: 0.4 },
  });
  for (const cand of response.candidates ?? []) {
    for (const part of cand.content?.parts ?? []) {
      if (part.inlineData?.data && part.inlineData?.mimeType) {
        return { data: part.inlineData.data, mimeType: part.inlineData.mimeType };
      }
    }
  }
  throw new Error("No image returned");
}

async function main(): Promise<void> {
  console.log(`Iter 3 RECOVERY — persist already-rendered + render page 3\n`);

  // Find the most recent iter3 generation row created by the failed run
  const recentGen = await db
    .select()
    .from(generations)
    .where(eq(generations.orderId, ORDER_ID))
    .orderBy(desc(generations.startedAt))
    .limit(5);
  const failedIter3 = recentGen.find(
    (g) =>
      g.coverUrl?.includes("illustration_cover_iter3") ||
      g.coverUrl?.includes(COVER_URL_GENERATED.split("/").slice(-1)[0]!),
  );

  let iterGenId: string;
  if (failedIter3) {
    iterGenId = failedIter3.id;
    console.log(`✓ Found failed iter3 generation: ${iterGenId} — reusing.`);
  } else {
    iterGenId = randomUUID();
    console.log(`→ Creating new iter3 generation: ${iterGenId}`);
    const sourceGen = await db
      .select()
      .from(generations)
      .where(eq(generations.id, SOURCE_GEN_ID))
      .limit(1)
      .then((r) => r[0]);
    if (!sourceGen) throw new Error("Source missing");
    await db.insert(generations).values({
      id: iterGenId,
      orderId: ORDER_ID,
      status: "generating_illustrations",
      storyJson: sourceGen.storyJson,
      bibleJson: sourceGen.bibleJson,
      coverUrl: COVER_URL_GENERATED,
      illustrationsCount: 3,
      estimatedCostCents: 0,
      startedAt: new Date(),
    });
  }

  // Make sure cover URL is set
  await db
    .update(generations)
    .set({ coverUrl: COVER_URL_GENERATED, updatedAt: new Date() })
    .where(eq(generations.id, iterGenId));

  // Load story
  const sourceGen = await db
    .select()
    .from(generations)
    .where(eq(generations.id, SOURCE_GEN_ID))
    .limit(1)
    .then((r) => r[0]);
  if (!sourceGen?.storyJson) throw new Error("Source story missing");
  const story = sourceGen.storyJson as {
    title: string;
    pages: Array<{
      number: number;
      text: string;
      charactersOnPage: string[];
      emotionalBeat: string;
    }>;
  };

  // Existing bookPages — skip if already there
  const existingPages = await db
    .select({ pageNumber: bookPages.pageNumber })
    .from(bookPages)
    .where(eq(bookPages.generationId, iterGenId));
  const havePages = new Set(existingPages.map((p) => p.pageNumber));

  // Insert page 1 if not there (using already-uploaded URL)
  if (!havePages.has(1)) {
    const page1 = story.pages.find((p) => p.number === 1)!;
    const page1Prompt = buildIter3Prompt({
      childName: "Hena",
      isCover: false,
      charactersOnPage: page1.charactersOnPage,
      emotionalBeat: page1.emotionalBeat,
    });
    await db.insert(bookPages).values({
      generationId: iterGenId,
      pageNumber: 1,
      storyText: page1.text,
      illustrationUrl: PAGE_1_URL_GENERATED,
      illustrationPrompt: page1Prompt.slice(0, 2000),
      illustrationProvider: "google-gemini-3.1-flash-img",
      illustrationGeneratedAt: new Date(),
    });
    console.log(`✓ Inserted bookPage 1 from already-rendered URL`);
  } else {
    console.log(`(page 1 already in DB)`);
  }

  // Render page 3
  if (!havePages.has(3)) {
    const page3 = story.pages.find((p) => p.number === 3)!;
    const sourcePages = await db
      .select()
      .from(bookPages)
      .where(eq(bookPages.generationId, SOURCE_GEN_ID));
    const sourcePage3 = sourcePages.find((p) => p.pageNumber === 3);
    if (!sourcePage3?.illustrationUrl) throw new Error("Source page 3 missing");

    const photoRows = await db
      .select({ url: photosTable.url })
      .from(photosTable)
      .where(eq(photosTable.orderId, ORDER_ID));
    const customerPhotoUrl = photoRows
      .map((r) => r.url)
      .filter((u): u is string => typeof u === "string" && u.length > 0)[0]!;

    console.log(`\n→ Page 3 | beat: "${page3.emotionalBeat}" | chars: ${JSON.stringify(page3.charactersOnPage)}`);
    const customerPhoto = await fetchAsBase64(customerPhotoUrl);
    const illustration = await fetchAsBase64(sourcePage3.illustrationUrl);
    const prompt = buildIter3Prompt({
      childName: "Hena",
      isCover: false,
      charactersOnPage: page3.charactersOnPage,
      emotionalBeat: page3.emotionalBeat,
    });
    const generated = await generateImage({ prompt, customerPhoto, illustration });
    const pageBuf = Buffer.from(generated.data, "base64");
    const pageUploaded = await uploadImage(
      pageBuf,
      ORDER_ID,
      "illustration_page_3_iter3",
      generated.mimeType,
    );
    console.log(`  ✓ ${pageUploaded.url}`);

    await db.insert(bookPages).values({
      generationId: iterGenId,
      pageNumber: 3,
      storyText: page3.text,
      illustrationUrl: pageUploaded.url,
      illustrationPrompt: prompt.slice(0, 2000),
      illustrationProvider: "google-gemini-3.1-flash-img",
      illustrationGeneratedAt: new Date(),
    });
  } else {
    console.log(`(page 3 already in DB)`);
  }

  await db
    .update(generations)
    .set({
      status: "awaiting_review",
      updatedAt: new Date(),
      completedAt: new Date(),
    })
    .where(eq(generations.id, iterGenId));

  console.log(`\n✅ Iter 3 recovery complete.`);
  console.log(`   Generation ID: ${iterGenId}`);
  console.log(`   Admin URL:     https://hadouta-admin.vercel.app/orders/${iterGenId}`);
}

main()
  .catch((err) => {
    console.error("\n❌ Recovery failed:", err);
    process.exit(1);
  })
  .then(() => process.exit(0));
