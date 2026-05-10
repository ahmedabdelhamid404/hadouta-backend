// ITER 6 — Same as iter 5 (multi-turn + role-assignment + 5-min retries +
// resumable + face-visible) PLUS aspectRatio: "3:4" hard constraint to
// stop Google from rendering tall images.
//
// Run: pnpm tsx src/scripts/_iter6_aspect.ts
// Resumable: pnpm tsx src/scripts/_iter6_aspect.ts <existing_gen_id>

import "dotenv/config";
import { randomUUID } from "node:crypto";
import * as https from "node:https";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  generations,
  bookPages,
  photos as photosTable,
} from "../db/schema.js";
import { uploadImage } from "../lib/cloudinary.js";

const SOURCE_GEN_ID = "68d5add6-48da-4a3e-baf3-054ad2162326"; // watercolor baseline
const ORDER_ID = "76e6226a-452e-47d6-9209-b53717d6d1cd";
const PRIMARY_MODEL = "gemini-3.1-flash-image-preview";
const PAGES_TO_DO = [1, 3] as const;
const ASPECT_RATIO = "3:4"; // portrait, locks Google to consistent children's-book shape

// Allow resuming with an existing gen id passed as CLI arg
const argGenId = process.argv[2];

interface InlineImage { data: string; mimeType: string }
interface ContentPart { text?: string; inlineData?: InlineImage; rawModelPart?: Record<string, unknown> }
interface ContentTurn { role: "user" | "model"; parts: ContentPart[] }
interface ApiResult { image: InlineImage; rawParts: Array<Record<string, unknown>> }

function shrinkCloudinaryUrl(url: string): string {
  if (!url.includes("res.cloudinary.com") || !url.includes("/upload/")) return url;
  if (url.includes("/upload/c_") || url.includes("/upload/w_")) return url;
  return url.replace("/upload/", "/upload/c_limit,w_768,f_jpg,q_70/");
}

async function fetchAsBase64(url: string): Promise<InlineImage> {
  const res = await fetch(shrinkCloudinaryUrl(url));
  if (!res.ok) throw new Error(`fetch ${res.status}`);
  const ct = res.headers.get("content-type") ?? "image/jpeg";
  const buf = Buffer.from(await res.arrayBuffer());
  console.log(`    fetched ${(buf.length / 1024).toFixed(0)}KB`);
  return { data: buf.toString("base64"), mimeType: ct };
}

function callGoogleApiOnce(contents: ContentTurn[]): Promise<ApiResult> {
  return new Promise((resolve, reject) => {
    const apiKey = process.env.GOOGLE_AI_API_KEY!;
    const restContents = contents.map((turn) => ({
      role: turn.role,
      parts: turn.parts.map((part) => {
        if (part.rawModelPart) return part.rawModelPart;
        if (part.inlineData) return { inline_data: { mime_type: part.inlineData.mimeType, data: part.inlineData.data } };
        return { text: part.text };
      }),
    }));
    const body = JSON.stringify({
      contents: restContents,
      generationConfig: {
        responseModalities: ["IMAGE"],
        temperature: 0.4,
        imageConfig: { aspectRatio: ASPECT_RATIO },
      },
    });
    const url = new URL(`https://generativelanguage.googleapis.com/v1beta/models/${PRIMARY_MODEL}:generateContent?key=${apiKey}`);
    const req = https.request(
      {
        hostname: url.hostname,
        path: url.pathname + url.search,
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
        timeout: 1_200_000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const responseBody = Buffer.concat(chunks).toString("utf8");
          if (res.statusCode !== 200) {
            const e = new Error(`Google ${res.statusCode}: ${responseBody.slice(0, 200)}`) as Error & { statusCode?: number };
            e.statusCode = res.statusCode;
            return reject(e);
          }
          try {
            const json = JSON.parse(responseBody) as { candidates?: Array<{ content?: { parts?: Array<Record<string, unknown>> } }> };
            for (const cand of json.candidates ?? []) {
              const rawParts = cand.content?.parts ?? [];
              for (const part of rawParts) {
                const camel = part.inlineData as { data?: string; mimeType?: string } | undefined;
                if (camel?.data && camel?.mimeType) return resolve({ image: { data: camel.data, mimeType: camel.mimeType }, rawParts });
                const snake = part.inline_data as { data?: string; mime_type?: string } | undefined;
                if (snake?.data && snake?.mime_type) return resolve({ image: { data: snake.data, mimeType: snake.mime_type }, rawParts });
              }
            }
            reject(new Error(`No image: ${responseBody.slice(0, 200)}`));
          } catch (e) { reject(e); }
        });
      },
    );
    req.on("timeout", () => { req.destroy(); reject(new Error("Timeout 20min")); });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// Unlimited 5-min retry on Google transient errors
async function callGoogleApi(contents: ContentTurn[]): Promise<ApiResult> {
  let attempt = 0;
  while (true) {
    attempt++;
    try { return await callGoogleApiOnce(contents); }
    catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      const msg = (err as Error).message?.slice(0, 100);
      console.log(`      attempt ${attempt} → ${status ?? "err"}: ${msg}`);
      if (status && status !== 503 && status !== 429 && status !== 500) throw err;
      console.log(`      retry in 5min (attempt ${attempt + 1})...`);
      await new Promise((r) => setTimeout(r, 5 * 60_000));
    }
  }
}

async function uploadWithRetry(buf: Buffer, ownerType: string, contentType: string, label: string): Promise<{ url: string; contentType: string; fileSize: number; publicId: string }> {
  for (let i = 0; i < 3; i++) {
    try {
      console.log(`    [${label}] cloudinary upload attempt ${i + 1}/3...`);
      const res = await uploadImage(buf, ORDER_ID, ownerType, contentType);
      console.log(`    [${label}] uploaded ✓`);
      return res;
    } catch (err) {
      console.log(`    [${label}] upload failed: ${(err as Error).message?.slice(0, 100)}`);
      if (i === 2) throw err;
      await new Promise((r) => setTimeout(r, 5_000 * (i + 1)));
    }
  }
  throw new Error("unreachable");
}

function sceneNarrativeFromBeat(beat: string, charactersOnPage: string[], protagonist: string): string {
  const beatLower = beat.toLowerCase();
  const otherChars = charactersOnPage.filter((c) => c !== protagonist);
  const otherClause = otherChars.length > 0 ? ` ${otherChars.join(" and ")} are present in the scene with their own distinct faces, separate from ${protagonist}.` : "";

  if (beatLower.includes("anticipat") || beatLower.includes("excited") || beatLower.includes("new beginning"))
    return `${protagonist} is caught mid-step, moving forward into the scene with quiet purpose. Her face is in three-quarter view, turned toward what's ahead of her. Her brows are slightly raised in interest, her eyes look forward at the path before her. Her lips are softly closed in a calm, neutral line — she is contemplating what comes next, not posing for a viewer.${otherClause}`;
  if (beatLower.includes("attempt") && beatLower.includes("fail"))
    return `${protagonist} is in three-quarter view, her eyes cast downward at her hands. Her brow is gently furrowed in disappointment. Her lips are pressed softly together in a small frown — the corners of her mouth turn slightly downward.${otherClause}`;
  if (beatLower.includes("choice") || beatLower.includes("inner") || beatLower.includes("dark"))
    return `${protagonist} is in three-quarter view, gazing thoughtfully off to the side, deep in her own thoughts. Her brows are gently drawn together. Her lips are softly closed in a calm, neutral line — neither happy nor sad, simply still.${otherClause}`;
  if (beatLower.includes("connection") || beatLower.includes("warmth") || beatLower.includes("belonging"))
    return `${protagonist} is in three-quarter view, looking warmly at the other person nearby. Her eyes are soft. Her lips are softly closed with the corners barely upturned — a private, gentle smile of belonging.${otherClause}`;
  if (beatLower.includes("introduc") || beatLower.includes("meet") || beatLower.includes("friend"))
    return `${protagonist} is in three-quarter view, looking curiously at the new face she's just met. Her brows are slightly raised with interest. Her lips are softly parted in mid-greeting, mouth corners neutral or just barely lifted.${otherClause}`;
  if (beatLower.includes("lonel") || beatLower.includes("isolat") || beatLower.includes("disorient"))
    return `${protagonist} is in three-quarter view, her eyes wide and uncertain. Her lips are softly parted in quiet worry, her mouth corners pulled slightly down or held flat — the small, contained expression of being alone in a place that isn't yet home.${otherClause}`;
  if (beatLower.includes("courage") || beatLower.includes("brave") || beatLower.includes("decisive"))
    return `${protagonist} is in three-quarter view, her eyes focused on the challenge before her, her jaw set with quiet determination. Her lips are pressed into a firm, calm line.${otherClause}`;
  if (beatLower.includes("notic") || beatLower.includes("observ"))
    return `${protagonist} is in three-quarter view, her gaze focused on what she has just noticed in the scene, her face thoughtful and present. Her lips are softly parted in quiet observation, mouth corners neutral.${otherClause}`;
  return `${protagonist} is in three-quarter view, engaged in the scene's action — looking at the action she's performing. Her face is calm and attentive, her lips softly closed in a natural neutral expression.${otherClause}`;
}

function buildPrompt(args: {
  childName: string;
  isCover: boolean;
  charactersOnPage: string[];
  emotionalBeat: string;
  storyScene: string;
}): string {
  const sceneNarrative = args.isCover
    ? `${args.childName} is rendered as the iconic cover character: in three-quarter view with her face turned slightly toward the viewer, a warm natural expression — eyes open and engaged, lips softly closed with corners just gently lifted in a quiet, real smile (not a posed-for-camera grin).`
    : sceneNarrativeFromBeat(args.emotionalBeat, args.charactersOnPage, args.childName);

  return `You are illustrating one page of a soft Egyptian watercolor children's storybook. Render the scene below as a fresh, original watercolor painting from scratch — do NOT copy any input image's composition, pose, or expression.

ROLE OF EACH INPUT IMAGE:
Image 1 is the IDENTITY REFERENCE for ${args.childName}. Use it ONLY to learn her facial structure, skin tone, hair color, and hair texture. Ignore her expression, pose, lighting, clothing, and background in image 1.
Image 2 is the STYLE REFERENCE. Use it ONLY to match the watercolor medium, brushwork, wet-on-wet bleeds, color palette, and warm cream paper texture. Ignore the character, expression, pose, and composition shown in image 2.

SCENE — paint this exactly as described:
${sceneNarrative}
Specific page action: ${args.storyScene}

ASPECT RATIO: 3:4 portrait (taller than wide). The image is fixed at this exact ratio — compose accordingly.

Composition: ${args.childName}'s face fully readable — three-quarter view minimum, both eyes and nose visible. She fills approximately 60% of frame height. Face anchored at a rule-of-thirds intersection.

Lighting: warm golden afternoon light, gentle directional lighting with luminous edges, ambient watercolor glow.

Style: visible brush strokes, wet-on-wet bleeds, cold-press paper texture, in the soft watercolor warmth of Tomie dePaola's *Strega Nona* applied to Egyptian children and Cairo apartment settings.

Output: a single watercolor illustration in 3:4 portrait aspect ratio with ${args.childName}'s face from image 1 and the watercolor style of image 2. No text, letters, or typography anywhere.`;
}

const TURN_2_CRITIQUE = (childName: string) => `Look at your previous output and compare ${childName}'s face there to image 1.

Re-assert the input roles: image 1 is the IDENTITY REFERENCE only — its expression and pose must not influence the output. Image 2 is the STYLE REFERENCE only — its character and expression must not influence the output.

Re-render the same scene with these specific corrections to make ${childName} more clearly recognizable: pull her eye shape closer to image 1's exact shape, pull her iris color closer to image 1's exact color, restore image 1's exact hair texture and curl pattern, match image 1's exact skin tone, restore image 1's specific jaw and chin shape (do not soften toward generic round).

Keep the same scene, same pose narrative, same composition, same watercolor style, same 3:4 aspect ratio. Only refine ${childName}'s face geometry.`;

async function multiTurnRefine(args: {
  childName: string;
  isCover: boolean;
  charactersOnPage: string[];
  emotionalBeat: string;
  storyScene: string;
  customerPhoto: InlineImage;
  illustration: InlineImage;
}): Promise<InlineImage> {
  const turn1Contents: ContentTurn[] = [{
    role: "user",
    parts: [
      { inlineData: args.customerPhoto },
      { inlineData: args.illustration },
      { text: buildPrompt(args) },
    ],
  }];
  console.log(`    turn 1...`);
  const t0 = Date.now();
  const turn1 = await callGoogleApi(turn1Contents);
  console.log(`    turn 1 done in ${((Date.now() - t0) / 1000).toFixed(0)}s`);

  const turn2Contents: ContentTurn[] = [
    ...turn1Contents,
    { role: "model", parts: turn1.rawParts.map((rp) => ({ rawModelPart: rp })) },
    { role: "user", parts: [{ text: TURN_2_CRITIQUE(args.childName) }] },
  ];
  console.log(`    turn 2...`);
  const t1 = Date.now();
  try {
    const turn2 = await callGoogleApi(turn2Contents);
    console.log(`    turn 2 done in ${((Date.now() - t1) / 1000).toFixed(0)}s`);
    return turn2.image;
  } catch (err) {
    console.log(`    ⚠️  turn 2 failed: ${(err as Error).message?.slice(0, 80)} — using turn 1`);
    return turn1.image;
  }
}

async function main(): Promise<void> {
  console.log(`Iter 6 — same as iter 5 + aspectRatio "${ASPECT_RATIO}"\n`);

  const sourceGen = await db.select().from(generations).where(eq(generations.id, SOURCE_GEN_ID)).limit(1).then((r) => r[0]);
  if (!sourceGen?.coverUrl || !sourceGen?.storyJson) throw new Error("no source");
  const story = sourceGen.storyJson as {
    title: string;
    coverDescription?: string;
    pages: Array<{ number: number; text: string; scene: string; charactersOnPage: string[]; emotionalBeat: string }>;
  };

  const photoRows = await db.select({ url: photosTable.url }).from(photosTable).where(eq(photosTable.orderId, ORDER_ID));
  const customerPhotoUrl = photoRows.map((r) => r.url).filter((u): u is string => typeof u === "string" && u.length > 0)[0]!;

  const sourcePages = await db.select().from(bookPages).where(eq(bookPages.generationId, SOURCE_GEN_ID));

  // Resume or create new generation
  let iterGenId: string;
  if (argGenId) {
    iterGenId = argGenId;
    console.log(`✓ Resuming generation ${iterGenId}\n`);
  } else {
    iterGenId = randomUUID();
    await db.insert(generations).values({
      id: iterGenId,
      orderId: ORDER_ID,
      status: "generating_illustrations",
      storyJson: sourceGen.storyJson,
      bibleJson: sourceGen.bibleJson,
      illustrationsCount: 1 + PAGES_TO_DO.length,
      estimatedCostCents: 0,
      startedAt: new Date(),
    });
    console.log(`✓ Created generation ${iterGenId}\n`);
  }

  const existingGen = await db.select().from(generations).where(eq(generations.id, iterGenId)).limit(1).then((r) => r[0]);
  const existingPages = await db.select({ pageNumber: bookPages.pageNumber }).from(bookPages).where(eq(bookPages.generationId, iterGenId));
  const havePages = new Set(existingPages.map((p) => p.pageNumber));
  const haveCover = !!existingGen?.coverUrl;
  console.log(`Already done: cover=${haveCover}, pages=[${[...havePages].join(", ")}]\n`);

  console.log(`→ Pre-fetching customer photo...`);
  const customerPhoto = await fetchAsBase64(customerPhotoUrl);

  // Cover
  if (!haveCover) {
    console.log(`\n→ Cover (3:4 + multi-turn)...`);
    const coverIllustration = await fetchAsBase64(sourceGen.coverUrl);
    const generated = await multiTurnRefine({
      childName: "Hena",
      isCover: true,
      charactersOnPage: ["Hena"],
      emotionalBeat: "iconic cover composition",
      storyScene: story.coverDescription ?? "Hena on the cover",
      customerPhoto,
      illustration: coverIllustration,
    });
    const buf = Buffer.from(generated.data, "base64");
    const uploaded = await uploadWithRetry(buf, "illustration_cover_iter6", generated.mimeType, "cover");
    console.log(`  ✓ ${uploaded.url}`);
    await db.update(generations).set({ coverUrl: uploaded.url, updatedAt: new Date() }).where(eq(generations.id, iterGenId));
  } else {
    console.log(`(cover already done — skipping)`);
  }

  for (const pageNum of PAGES_TO_DO) {
    if (havePages.has(pageNum)) {
      console.log(`(page ${pageNum} already done — skipping)`);
      continue;
    }
    const sourceBookPage = sourcePages.find((p) => p.pageNumber === pageNum);
    const storyPage = story.pages.find((p) => p.number === pageNum);
    if (!sourceBookPage?.illustrationUrl || !storyPage) continue;
    console.log(`\n→ Page ${pageNum} (3:4) | beat: "${storyPage.emotionalBeat}"`);
    const illustration = await fetchAsBase64(sourceBookPage.illustrationUrl);
    const generated = await multiTurnRefine({
      childName: "Hena",
      isCover: false,
      charactersOnPage: storyPage.charactersOnPage,
      emotionalBeat: storyPage.emotionalBeat,
      storyScene: storyPage.scene,
      customerPhoto,
      illustration,
    });
    const buf = Buffer.from(generated.data, "base64");
    const uploaded = await uploadWithRetry(buf, `illustration_page_${pageNum}_iter6`, generated.mimeType, `page${pageNum}`);
    console.log(`  ✓ ${uploaded.url}`);
    await db.insert(bookPages).values({
      generationId: iterGenId,
      pageNumber: pageNum,
      storyText: storyPage.text,
      illustrationUrl: uploaded.url,
      illustrationPrompt: buildPrompt({
        childName: "Hena",
        isCover: false,
        charactersOnPage: storyPage.charactersOnPage,
        emotionalBeat: storyPage.emotionalBeat,
        storyScene: storyPage.scene,
      }).slice(0, 2000),
      illustrationProvider: "gemini-3.1-iter6-3by4",
      illustrationGeneratedAt: new Date(),
    });
  }

  await db.update(generations).set({
    status: "awaiting_review",
    updatedAt: new Date(),
    completedAt: new Date(),
  }).where(eq(generations.id, iterGenId));

  console.log(`\n✅ Iter 6 complete (3:4 aspect ratio).`);
  console.log(`   Admin URL: https://hadouta-admin.vercel.app/orders/${iterGenId}`);
}

main()
  .catch((err) => { console.error("FAILED:", err); process.exit(1); })
  .then(() => process.exit(0));
