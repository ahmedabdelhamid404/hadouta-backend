// ITERATION 3 — Direct Google AI Studio API (no more fal.ai).
//
// Two changes from iter 2:
//   1. Switch from fal.ai → Google AI Studio direct via @google/genai SDK
//      Model: gemini-3.1-flash-image-preview (= Nano Banana 2 on Google direct)
//   2. Add per-page POSE + EXPRESSION + GAZE direction derived from each
//      page's emotionalBeat — explicitly forbids the smile-and-face-camera
//      default that's been making every illustration feel artificial.
//
// Cost: covered by Google credit (founder has substantial budget there).
// fal.ai budget exhausted after iter 2.
//
// Run: pnpm tsx src/scripts/_iter3_google_direct.ts

import "dotenv/config";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { GoogleGenAI } from "@google/genai";
import { db } from "../db/index.js";
import {
  generations,
  bookPages,
  photos as photosTable,
} from "../db/schema.js";
import { uploadImage } from "../lib/cloudinary.js";

const ITER2_GEN_ID = "TBD"; // filled from iter 2 admin URL when it lands
const SOURCE_GEN_ID = "68d5add6-48da-4a3e-baf3-054ad2162326"; // watercolor baseline (used if iter2 not given)
const ORDER_ID = "76e6226a-452e-47d6-9209-b53717d6d1cd";
const MODEL = "gemini-3.1-flash-image-preview";
const PAGES_TO_REFINE = [1, 3] as const;

// CLI override: pass iter2 generation id as first arg, otherwise use baseline.
const sourceGenIdArg = process.argv[2] ?? SOURCE_GEN_ID;

/** Apply Cloudinary URL transform to shrink the image to ~1024px wide,
 *  JPEG q75. Drops typical iPhone/PNG payload from 3-5MB → ~150-300KB,
 *  preventing the Google API headers-timeout we hit on iter 3 attempt 1. */
function shrinkCloudinaryUrl(url: string): string {
  if (!url.includes("res.cloudinary.com") || !url.includes("/upload/")) {
    return url;
  }
  if (url.includes("/upload/c_") || url.includes("/upload/w_")) {
    return url; // already transformed
  }
  return url.replace("/upload/", "/upload/c_limit,w_1024,f_jpg,q_75/");
}

async function fetchAsBase64(url: string): Promise<{ data: string; mimeType: string }> {
  const shrunk = shrinkCloudinaryUrl(url);
  const res = await fetch(shrunk);
  if (!res.ok) throw new Error(`Failed to fetch: ${res.status}`);
  const ct = res.headers.get("content-type") ?? "image/jpeg";
  const buf = Buffer.from(await res.arrayBuffer());
  console.log(`    fetched ${(buf.length / 1024).toFixed(0)}KB (${ct})`);
  return { data: buf.toString("base64"), mimeType: ct };
}

/** Translate the story's emotionalBeat into concrete pose/expression direction. */
function poseDirectionFromBeat(beat: string, charactersOnPage: string[], protagonist: string): string {
  const beatLower = beat.toLowerCase();
  const otherChars = charactersOnPage.filter((c) => c !== protagonist);
  const lookingTarget = otherChars.length > 0 ? otherChars[0] : "the action she is performing";

  // Heuristic mapping from common emotionalBeat language to gaze + expression.
  // Default = NOT smiling, NOT facing camera.
  if (beatLower.includes("anticipat") || beatLower.includes("excited")) {
    return `${protagonist} is looking ahead at what's coming next, brows slightly raised, lips parted in quiet anticipation — NOT smiling broadly, NOT facing the camera. Her gaze is forward toward the action.`;
  }
  if (beatLower.includes("attempt") && beatLower.includes("fail")) {
    return `${protagonist} is looking down or at her hands or at ${lookingTarget}, brow slightly furrowed, mouth in a soft frown or pursed expression — NOT smiling, NOT facing the camera. Her body posture shows the frustration of a failed attempt.`;
  }
  if (beatLower.includes("choice") || beatLower.includes("inner") || beatLower.includes("dark moment")) {
    return `${protagonist} is in a contemplative, vulnerable expression — eyes possibly cast down or to the side, mouth slightly parted or pressed in thought — NOT smiling, NOT facing the camera. This is an interior moment of decision.`;
  }
  if (beatLower.includes("connection") || beatLower.includes("warmth") || beatLower.includes("belonging")) {
    return `${protagonist} is looking at ${lookingTarget} with quiet warmth, a soft natural expression — perhaps a small genuine smile if the scene calls for it, but NOT a posed broad smile, NOT facing the camera. Her gaze is on the other person, not on us.`;
  }
  if (beatLower.includes("courage") || beatLower.includes("brave") || beatLower.includes("decisive")) {
    return `${protagonist} is looking forward at the challenge or at ${lookingTarget}, jaw set, eyes focused, mouth in a determined line — NOT smiling, NOT facing the camera. The pose shows summoned courage, not performance.`;
  }
  if (beatLower.includes("disorient") || beatLower.includes("isolat") || beatLower.includes("lonel")) {
    return `${protagonist} is looking around, slightly lost, eyes wide and uncertain, mouth slightly open or pressed thin — NOT smiling, NOT facing the camera. The body language shows isolation.`;
  }
  if (beatLower.includes("notic") || beatLower.includes("observ")) {
    return `${protagonist} is looking at ${lookingTarget} — eyes focused on the observed subject, slightly thoughtful expression — NOT smiling at the camera. Her attention is OUT there, not on us.`;
  }
  if (beatLower.includes("introduc") || beatLower.includes("meet")) {
    return `${protagonist} is looking at ${lookingTarget} with curious interest, perhaps a tentative small smile, body slightly turned toward them — NOT facing the camera straight-on. The pose is mid-interaction, not posed for a portrait.`;
  }

  // Default fallback
  return `${protagonist} is engaged in the action of the scene — looking at ${lookingTarget} or at what she's doing. Her expression should be natural to this specific moment ("${beat}") — NOT a default smile, NOT facing the camera. Do not pose her for a portrait; render her as if she's caught mid-action.`;
}

function buildIter3Prompt(args: {
  childName: string;
  isCover: boolean;
  charactersOnPage: string[];
  emotionalBeat: string;
}): string {
  const otherChars = args.charactersOnPage.filter((c) => c !== args.childName);
  const otherCharsClause =
    otherChars.length > 0
      ? `Other characters in image 2 (${otherChars.join(", ")}) keep their existing distinct faces — do NOT apply image 1's face to ${otherChars.join(" or ")}.`
      : `${args.childName} is alone in this scene.`;

  const poseDirection = args.isCover
    ? `${args.childName} on the cover may be looking forward at the reader (this is the only acceptable place for camera-direct gaze), with a natural genuine expression — NOT a posed plastic smile.`
    : poseDirectionFromBeat(args.emotionalBeat, args.charactersOnPage, args.childName);

  return [
    `Image 1 is a sharp digital photo of ${args.childName} — the IDENTITY SOURCE.`,
    `Image 2 is the existing watercolor illustration — the SCENE / STYLE / COMPOSITION SOURCE.`,
    ``,
    `Your task: produce an image that has Image 1's FACE on ${args.childName} composed into Image 2's scene, with a NATURAL pose and expression appropriate to the emotional moment of this specific page.`,
    ``,
    `=== POSE + EXPRESSION + GAZE DIRECTION (CRITICAL — DO NOT DEFAULT TO SMILING-AT-CAMERA) ===`,
    ``,
    `Page emotional beat: "${args.emotionalBeat}"`,
    ``,
    poseDirection,
    ``,
    `Children in real life — and in great children's books — are NOT always smiling at the reader. They look down, sideways, at other characters, at objects, into the distance. Their expressions are concentrated, curious, sad, surprised, focused, vulnerable — appropriate to whatever they are actually doing in the moment.`,
    ``,
    `If the existing pose in Image 2 has ${args.childName} smiling and facing the camera but the emotional beat is "${args.emotionalBeat}" — you MUST change the pose and expression to match the beat. Do not preserve a wrong pose.`,
    ``,
    `=== FACE IDENTITY MATCH (from Image 1) ===`,
    ``,
    `Match these features from image 1, in order of importance:`,
    `1. Eye shape, eye spacing, and iris color`,
    `2. Nose bridge width and tip shape`,
    `3. Jaw line and chin shape`,
    `4. Eyebrow shape and thickness`,
    `5. Hair color (match exactly), hairline, and hair texture`,
    `6. Skin tone (match exactly)`,
    `7. Mouth width and lip shape (NOT the smile expression — just the lip shape)`,
    ``,
    `=== PRESERVE FROM IMAGE 2 ===`,
    ``,
    `- Watercolor medium, brush texture, paper grain, paint bleed`,
    `- Color palette, lighting direction, shadow style`,
    `- Setting, props, and the specific scene`,
    `- Supporting characters (their distinct faces, clothing, poses)`,
    `- Composition framing (but the protagonist's head/body angle CAN change to match the new pose direction)`,
    `- Soft watercolor style — do NOT photorealize`,
    ``,
    otherCharsClause,
    ``,
    `Output: a watercolor illustration matching image 2's scene and style, with ${args.childName}'s face from image 1 (geometry-matched), in a natural pose and expression for this specific emotional beat ("${args.emotionalBeat}"). No text, letters, or typography anywhere. Eyes painted with crisper edges to anchor identity; rest of face soft watercolor.`,
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
    contents: [
      {
        role: "user",
        parts: [
          { inlineData: args.customerPhoto },
          { inlineData: args.illustration },
          { text: args.prompt },
        ],
      },
    ],
    config: {
      responseModalities: ["IMAGE"],
      temperature: 0.4,
    },
  });

  // Extract image from response
  const candidates = response.candidates ?? [];
  for (const cand of candidates) {
    const parts = cand.content?.parts ?? [];
    for (const part of parts) {
      if (part.inlineData?.data && part.inlineData?.mimeType) {
        return { data: part.inlineData.data, mimeType: part.inlineData.mimeType };
      }
    }
  }
  throw new Error(
    `No image in Google response. Candidates: ${JSON.stringify(candidates).slice(0, 500)}`,
  );
}

async function main(): Promise<void> {
  console.log(`Iteration 3 — Google AI Studio direct (${MODEL})`);
  console.log(`Source: ${sourceGenIdArg}\n`);

  const sourceGen = await db
    .select()
    .from(generations)
    .where(eq(generations.id, sourceGenIdArg))
    .limit(1)
    .then((r) => r[0]);
  if (!sourceGen?.coverUrl || !sourceGen?.storyJson) {
    throw new Error("Source generation missing");
  }
  const story = sourceGen.storyJson as {
    title: string;
    pages: Array<{
      number: number;
      text: string;
      charactersOnPage: string[];
      emotionalBeat: string;
    }>;
  };
  console.log(`✓ Source: "${story.title}"`);
  console.log(`✓ Source cover: ${sourceGen.coverUrl.split("/").slice(-1)[0]}`);

  const photoRows = await db
    .select({ url: photosTable.url })
    .from(photosTable)
    .where(eq(photosTable.orderId, ORDER_ID));
  const customerPhotoUrl = photoRows
    .map((r) => r.url)
    .filter((u): u is string => typeof u === "string" && u.length > 0)[0];
  if (!customerPhotoUrl) throw new Error("No customer photos");
  console.log(`✓ Customer photo: ${customerPhotoUrl.split("/").slice(-1)[0]}`);

  const sourcePages = await db
    .select()
    .from(bookPages)
    .where(eq(bookPages.generationId, sourceGenIdArg));

  // Pre-fetch customer photo as base64 (reused across all calls)
  console.log(`\n→ Fetching customer photo as base64...`);
  const customerPhoto = await fetchAsBase64(customerPhotoUrl);

  const iterGenId = randomUUID();
  await db.insert(generations).values({
    id: iterGenId,
    orderId: ORDER_ID,
    status: "generating_illustrations",
    storyJson: sourceGen.storyJson,
    bibleJson: sourceGen.bibleJson,
    illustrationsCount: 1 + PAGES_TO_REFINE.length,
    estimatedCostCents: 0, // covered by Google credit
    startedAt: new Date(),
  });

  // Cover
  console.log(`\n→ Cover (Google direct, anti-default-smile)...`);
  const coverPrompt = buildIter3Prompt({
    childName: "Hena",
    isCover: true,
    charactersOnPage: ["Hena"],
    emotionalBeat: "iconic cover composition",
  });
  const coverIllustration = await fetchAsBase64(sourceGen.coverUrl);
  const coverGenerated = await generateImage({
    prompt: coverPrompt,
    customerPhoto,
    illustration: coverIllustration,
  });
  const coverBuf = Buffer.from(coverGenerated.data, "base64");
  const coverUploaded = await uploadImage(
    coverBuf,
    ORDER_ID,
    "illustration_cover_iter3",
    coverGenerated.mimeType,
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
      `\n→ Page ${pageNum} | beat: "${storyPage.emotionalBeat}" | chars: ${JSON.stringify(storyPage.charactersOnPage)}`,
    );
    const pagePrompt = buildIter3Prompt({
      childName: "Hena",
      isCover: false,
      charactersOnPage: storyPage.charactersOnPage,
      emotionalBeat: storyPage.emotionalBeat,
    });
    const pageIllustration = await fetchAsBase64(sourceBookPage.illustrationUrl);
    const pageGenerated = await generateImage({
      prompt: pagePrompt,
      customerPhoto,
      illustration: pageIllustration,
    });
    const pageBuf = Buffer.from(pageGenerated.data, "base64");
    const pageUploaded = await uploadImage(
      pageBuf,
      ORDER_ID,
      `illustration_page_${pageNum}_iter3`,
      pageGenerated.mimeType,
    );
    console.log(`  ✓ ${pageUploaded.url}`);
    await db.insert(bookPages).values({
      generationId: iterGenId,
      pageNumber: pageNum,
      storyText: storyPage.text,
      illustrationUrl: pageUploaded.url,
      illustrationPrompt: pagePrompt.slice(0, 2000),
      illustrationProvider: "google-gemini-3.1-flash-img",
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

  console.log(`\n✅ Iteration 3 complete (Google direct).`);
  console.log(`   Generation ID: ${iterGenId}`);
  console.log(`   Admin URL:     https://hadouta-admin.vercel.app/orders/${iterGenId}`);
  console.log(`\n   Compare:`);
  console.log(`   Watercolor baseline:  https://hadouta-admin.vercel.app/orders/${SOURCE_GEN_ID}`);
  console.log(`   Iter 1 (fal):         https://hadouta-admin.vercel.app/orders/c90aceae-63a0-4de1-9251-6330cc9e9718`);
  console.log(`   Iter 2 (fal reorder): https://hadouta-admin.vercel.app/orders/${sourceGenIdArg !== SOURCE_GEN_ID ? sourceGenIdArg : "(see latest)"}`);
  console.log(`   Iter 3 (Google):      https://hadouta-admin.vercel.app/orders/${iterGenId}`);
}

main()
  .catch((err) => {
    console.error("\n❌ Iter 3 failed:", err);
    process.exit(1);
  })
  .then(() => process.exit(0));
