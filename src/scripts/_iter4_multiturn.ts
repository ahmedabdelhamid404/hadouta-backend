// ITERATION 4 — Multi-turn conversational refinement on Google direct.
//
// Uses Google's chat-style contents history (NOT available on fal.ai):
//   Turn 1: customer photo + iter3 output + "match face anatomy fields 1-7
//           with surgical precision; render the refined image"
//   Turn 2: "Compare your output to image 1. Common drift: iris darkness,
//           hair curl/density, jaw shape. Re-render with stronger fidelity
//           to image 1's specific anatomy — do not soften toward generic
//           cute-kid features."
//
// This iterative refinement is what gives Google direct API its edge over
// single-shot endpoints — the model sees its own output, sees where it
// drifted, corrects.
//
// Builds on iter 3 (pose/expression direction already correct) so iter 4
// focuses purely on face-anatomy reinforcement.
//
// Run: pnpm tsx src/scripts/_iter4_multiturn.ts

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

const ITER3_GEN_ID = "69611877-d4b6-4f80-999b-0ab008bb22c5";
const SOURCE_GEN_ID = "68d5add6-48da-4a3e-baf3-054ad2162326";
const ORDER_ID = "76e6226a-452e-47d6-9209-b53717d6d1cd";
const MODEL = "gemini-3.1-flash-image-preview";
const PAGES_TO_REFINE = [1, 3] as const;

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

const TURN_1_PROMPT_TEMPLATE = (childName: string, isCover: boolean, otherCharsClause: string) => `
Image 1 is a sharp digital photo of ${childName} — the ABSOLUTE IDENTITY GROUND TRUTH.
Image 2 is the existing watercolor illustration — the SCENE / STYLE / POSE source.

Your task: produce a refined version of image 2 where ${childName}'s face matches image 1's facial anatomy with surgical precision. Watercolor style preserved.

Match these features from image 1 PRECISELY (do not generalize toward "generic cute kid"):

EYES — exactly the same eye shape (almond/round/hooded/monolid as in image 1), exactly the same iris color (note the EXACT shade — if image 1 has dark almost-black brown eyes, do not render lighter brown; if image 1 has greenish-hazel, do not render plain brown), exact same eye spacing relative to face width, exact same upper/lower lid shape.

NOSE — exact same bridge width, tip shape, nostril visibility as in image 1.

JAW + CHIN — exact same shape (rounded/pointed/heart/oval), do not soften toward "round cute kid jaw" if image 1 has a more defined chin.

EYEBROWS — exact same shape, density, arch as image 1.

HAIR — exact same color, texture (curly/wavy/straight - match the curl pattern), length, hairline shape, and any visible parting/styling.

SKIN — exact same skin tone (warmth + depth). If image 1 is medium olive, do not render lighter ivory or darker bronze.

LIPS — exact same lip shape and proportions (the EXPRESSION can change per the scene, but the underlying lip shape is image 1's).

PRESERVE from image 2: watercolor medium, brush texture, paper grain, color palette, lighting, scene, composition, supporting characters' distinct faces.

${otherCharsClause}

${isCover ? "Cover composition: subject upper two-thirds, neutral lower third." : ""}

Output: the watercolor illustration with ${childName}'s face rendered field-by-field to match image 1. NOT photorealistic — keep the soft watercolor surface, but the underlying GEOMETRY of the face must be image 1's.
`.trim();

const TURN_2_PROMPT = (childName: string) => `
Compare your previous output to image 1 (the reference photo of ${childName}). Common drift in face refinement that you may have produced:

1. IRIS COLOR DRIFT — the iris in your output may be too generic-brown. Pull it to match image 1's exact eye color, including any subtle warmth/coolness.
2. HAIR CURL/TEXTURE LOSS — if image 1 has tightly curled or coily hair, your output may have softened it to wavy or smooth. Restore the exact curl density and pattern from image 1.
3. JAW SOFTENING — child illustration models tend to soften jaws toward "round cute kid" default. If image 1 has a more defined or angular chin, restore that exact shape.
4. SKIN TONE WARMTH SHIFT — your output may have shifted toward a generic warm-tan tone. Match image 1's exact tone, neither lighter nor warmer.
5. EYE SPACING NORMALIZATION — your output may have moved eye spacing toward "average kid face" proportions. Match image 1's exact spacing.

Re-render the same illustration with these specific corrections applied. Watercolor style preserved. Do NOT change the pose, scene, supporting characters, or any other aspect of your previous output — only correct ${childName}'s face anatomy toward image 1.

Output the corrected image.
`.trim();

async function multiTurnRefine(args: {
  childName: string;
  isCover: boolean;
  charactersOnPage: string[];
  customerPhoto: { data: string; mimeType: string };
  illustration: { data: string; mimeType: string };
}): Promise<{ data: string; mimeType: string }> {
  const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_AI_API_KEY! });

  const otherChars = args.charactersOnPage.filter((c) => c !== args.childName);
  const otherCharsClause = otherChars.length > 0
    ? `Other characters in image 2 (${otherChars.join(", ")}) keep their distinct faces — do NOT apply image 1's face to ${otherChars.join(" or ")}.`
    : `${args.childName} is alone.`;

  // === Turn 1 ===
  console.log(`    turn 1: anatomy precision pass...`);
  const turn1 = await ai.models.generateContent({
    model: MODEL,
    contents: [{
      role: "user",
      parts: [
        { inlineData: args.customerPhoto },
        { inlineData: args.illustration },
        { text: TURN_1_PROMPT_TEMPLATE(args.childName, args.isCover, otherCharsClause) },
      ],
    }],
    config: { responseModalities: ["IMAGE"], temperature: 0.4 },
  });

  let turn1Image: { data: string; mimeType: string } | null = null;
  for (const cand of turn1.candidates ?? []) {
    for (const part of cand.content?.parts ?? []) {
      if (part.inlineData?.data && part.inlineData?.mimeType) {
        turn1Image = { data: part.inlineData.data, mimeType: part.inlineData.mimeType };
        break;
      }
    }
    if (turn1Image) break;
  }
  if (!turn1Image) throw new Error("Turn 1: no image returned");
  console.log(`    turn 1 ok (${(turn1Image.data.length * 0.75 / 1024).toFixed(0)}KB out)`);

  // === Turn 2 — multi-turn correction with conversation history ===
  console.log(`    turn 2: drift correction pass...`);
  const turn2 = await ai.models.generateContent({
    model: MODEL,
    contents: [
      // Original user request
      {
        role: "user",
        parts: [
          { inlineData: args.customerPhoto },
          { inlineData: args.illustration },
          { text: TURN_1_PROMPT_TEMPLATE(args.childName, args.isCover, otherCharsClause) },
        ],
      },
      // Model's response from turn 1
      {
        role: "model",
        parts: [{ inlineData: turn1Image }],
      },
      // Critique + correction request
      {
        role: "user",
        parts: [{ text: TURN_2_PROMPT(args.childName) }],
      },
    ],
    config: { responseModalities: ["IMAGE"], temperature: 0.3 },
  });

  for (const cand of turn2.candidates ?? []) {
    for (const part of cand.content?.parts ?? []) {
      if (part.inlineData?.data && part.inlineData?.mimeType) {
        const out = { data: part.inlineData.data, mimeType: part.inlineData.mimeType };
        console.log(`    turn 2 ok (${(out.data.length * 0.75 / 1024).toFixed(0)}KB out)`);
        return out;
      }
    }
  }
  // Fall back to turn 1 output if turn 2 didn't return an image
  console.log(`    ⚠️  turn 2 returned no image, using turn 1 output`);
  return turn1Image;
}

async function main(): Promise<void> {
  console.log(`Iteration 4 — Google multi-turn (${MODEL})`);
  console.log(`Building on iter 3: ${ITER3_GEN_ID}\n`);

  const sourceGen = await db
    .select()
    .from(generations)
    .where(eq(generations.id, SOURCE_GEN_ID))
    .limit(1)
    .then((r) => r[0]);
  const iter3Gen = await db
    .select()
    .from(generations)
    .where(eq(generations.id, ITER3_GEN_ID))
    .limit(1)
    .then((r) => r[0]);
  if (!iter3Gen?.coverUrl || !sourceGen?.storyJson) throw new Error("Source missing");

  const story = sourceGen.storyJson as {
    title: string;
    pages: Array<{
      number: number;
      text: string;
      charactersOnPage: string[];
      emotionalBeat: string;
    }>;
  };

  const photoRows = await db
    .select({ url: photosTable.url })
    .from(photosTable)
    .where(eq(photosTable.orderId, ORDER_ID));
  const customerPhotoUrl = photoRows
    .map((r) => r.url)
    .filter((u): u is string => typeof u === "string" && u.length > 0)[0]!;

  const iter3Pages = await db
    .select()
    .from(bookPages)
    .where(eq(bookPages.generationId, ITER3_GEN_ID));

  console.log(`→ Pre-fetching customer photo as base64...`);
  const customerPhoto = await fetchAsBase64(customerPhotoUrl);

  const iterGenId = randomUUID();
  await db.insert(generations).values({
    id: iterGenId,
    orderId: ORDER_ID,
    status: "generating_illustrations",
    storyJson: sourceGen.storyJson,
    bibleJson: sourceGen.bibleJson,
    illustrationsCount: 1 + PAGES_TO_REFINE.length,
    estimatedCostCents: 0,
    startedAt: new Date(),
  });

  // Cover
  console.log(`\n→ Cover (multi-turn refinement)...`);
  const coverIllustration = await fetchAsBase64(iter3Gen.coverUrl);
  const coverGenerated = await multiTurnRefine({
    childName: "Hena",
    isCover: true,
    charactersOnPage: ["Hena"],
    customerPhoto,
    illustration: coverIllustration,
  });
  const coverBuf = Buffer.from(coverGenerated.data, "base64");
  const coverUploaded = await uploadImage(
    coverBuf,
    ORDER_ID,
    "illustration_cover_iter4",
    coverGenerated.mimeType,
  );
  console.log(`  ✓ ${coverUploaded.url}`);
  await db
    .update(generations)
    .set({ coverUrl: coverUploaded.url, updatedAt: new Date() })
    .where(eq(generations.id, iterGenId));

  // Pages
  for (const pageNum of PAGES_TO_REFINE) {
    const iter3Page = iter3Pages.find((p) => p.pageNumber === pageNum);
    const storyPage = story.pages.find((p) => p.number === pageNum);
    if (!iter3Page?.illustrationUrl || !storyPage) continue;
    console.log(
      `\n→ Page ${pageNum} (multi-turn) | beat: "${storyPage.emotionalBeat}"`,
    );
    const pageIllustration = await fetchAsBase64(iter3Page.illustrationUrl);
    const pageGenerated = await multiTurnRefine({
      childName: "Hena",
      isCover: false,
      charactersOnPage: storyPage.charactersOnPage,
      customerPhoto,
      illustration: pageIllustration,
    });
    const pageBuf = Buffer.from(pageGenerated.data, "base64");
    const pageUploaded = await uploadImage(
      pageBuf,
      ORDER_ID,
      `illustration_page_${pageNum}_iter4`,
      pageGenerated.mimeType,
    );
    console.log(`  ✓ ${pageUploaded.url}`);
    await db.insert(bookPages).values({
      generationId: iterGenId,
      pageNumber: pageNum,
      storyText: storyPage.text,
      illustrationUrl: pageUploaded.url,
      illustrationPrompt: TURN_1_PROMPT_TEMPLATE("Hena", false, "").slice(0, 2000),
      illustrationProvider: "gemini-3.1-multiturn",
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

  console.log(`\n✅ Iteration 4 complete (multi-turn).`);
  console.log(`   Generation ID: ${iterGenId}`);
  console.log(`   Admin URL:     https://hadouta-admin.vercel.app/orders/${iterGenId}`);
  console.log(`\n   Iter 3 baseline:  https://hadouta-admin.vercel.app/orders/${ITER3_GEN_ID}`);
  console.log(`   Iter 4 (multi):   https://hadouta-admin.vercel.app/orders/${iterGenId}`);
}

main()
  .catch((err) => {
    console.error("\n❌ Iter 4 failed:", err);
    process.exit(1);
  })
  .then(() => process.exit(0));
