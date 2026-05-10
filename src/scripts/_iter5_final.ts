// ITERATION 5 — Final iteration combining all fixes:
//   1. Direct REST API call (bypass @google/genai SDK that hung iter 4)
//      with explicit AbortSignal(10 min) for upload tolerance
//   2. FACE-VISIBLE pose direction enforcement — every pose direction now
//      includes "three-quarter view at minimum, NEVER pure back-of-head"
//      (fix for iter 3 page 1 / page 2 back-angle bug)
//   3. Reversed reference order [photo, illustration]
//   4. Field-by-field anatomy match (iter 2 win)
//   5. Per-page emotional pose direction (iter 3 win)
//   6. Multi-turn refinement: turn 1 first-pass, turn 2 drift-correction
//
// All previous wins stacked + the back-angle bug fixed.
// Source: watercolor baseline (clean start, not iter 3 which had pose bug).
//
// Run: pnpm tsx src/scripts/_iter5_final.ts

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
const FALLBACK_MODEL = "gemini-2.5-flash-image"; // older Nano Banana, less loaded
const PAGES_TO_REFINE = [1, 3] as const;
const apiUrlFor = (model: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

// =========================================================================
// FIX FOR THE BACK-OF-HEAD BUG: every pose direction now ENFORCES face
// visibility. "NOT facing the camera" is no longer an open-ended permission
// to face away — it's a constraint that the model must satisfy WITHIN the
// space of "face is still visible enough for identity to land."
// =========================================================================

const FACE_VISIBILITY_FLOOR =
  "ABSOLUTE CONSTRAINT: Hena's face MUST be visible enough that a viewer can recognize her identity. Three-quarter view at minimum (where you see one full eye, both eyebrows, the nose, and most of the mouth). NEVER a pure back-of-head shot. NEVER a pure side profile that hides one eye and most of the face. NEVER an over-the-shoulder shot where her face is turned away. The face is the load-bearing element of identity for the entire book — if her face isn't visible, the page fails its purpose.";

/**
 * Translates a page's emotional beat + characters into a NARRATIVE PROSE
 * paragraph describing Hena's whole face/body state in one coherent
 * sentence. This format wins over bullet lists per Google's official
 * "describe, don't list" guidance + AI Engineer audit 2026-05-09.
 * Returns a single paragraph that goes inside the SCENE block.
 */
function sceneNarrativeFromBeat(
  beat: string,
  charactersOnPage: string[],
  protagonist: string,
): string {
  const beatLower = beat.toLowerCase();
  const otherChars = charactersOnPage.filter((c) => c !== protagonist);
  const otherClause = otherChars.length > 0 ? ` ${otherChars.join(" and ")} are present in the scene with their own distinct faces, separate from ${protagonist}.` : "";

  if (beatLower.includes("anticipat") || beatLower.includes("excited") || beatLower.includes("new beginning")) {
    return `${protagonist} is caught mid-step, moving forward into the scene with quiet purpose. Her face is in three-quarter view, turned toward what's ahead of her. Her brows are slightly raised in interest, her eyes look forward at the path before her. Her lips are softly closed in a calm, neutral line — she is contemplating what comes next, not posing for a viewer.${otherClause}`;
  }
  if (beatLower.includes("attempt") && beatLower.includes("fail")) {
    return `${protagonist} is in three-quarter view, her eyes cast downward at her hands. Her brow is gently furrowed in disappointment. Her lips are pressed softly together in a small frown — the corners of her mouth turn slightly downward. She holds her body small, the posture of a quiet setback.${otherClause}`;
  }
  if (beatLower.includes("choice") || beatLower.includes("inner") || beatLower.includes("dark")) {
    return `${protagonist} is in three-quarter view, gazing thoughtfully off to the side, deep in her own thoughts. Her brows are gently drawn together. Her lips are softly closed in a calm, neutral line — neither happy nor sad, simply still, the expression of someone working through a quiet inner moment.${otherClause}`;
  }
  if (beatLower.includes("connection") || beatLower.includes("warmth") || beatLower.includes("belonging")) {
    return `${protagonist} is in three-quarter view, looking warmly at the other person nearby. Her eyes are soft. Her lips are softly closed with the corners barely upturned — a private, gentle smile of belonging, the kind that comes from real connection. Her body is angled toward the other character.${otherClause}`;
  }
  if (beatLower.includes("introduc") || beatLower.includes("meet") || beatLower.includes("friend")) {
    return `${protagonist} is in three-quarter view, looking curiously at the new face she's just met. Her brows are slightly raised with interest. Her lips are softly parted in mid-greeting, mouth corners neutral or just barely lifted — the cautious openness of meeting someone new, not a posed grin. Her body is slightly turned toward the other person.${otherClause}`;
  }
  if (beatLower.includes("lonel") || beatLower.includes("isolat") || beatLower.includes("disorient")) {
    return `${protagonist} is in three-quarter view, her eyes wide and uncertain, looking around the unfamiliar space. Her lips are softly parted in quiet worry, her mouth corners pulled slightly down or held flat — the small, contained expression of being alone in a place that isn't yet home. Her body is held small.${otherClause}`;
  }
  if (beatLower.includes("courage") || beatLower.includes("brave") || beatLower.includes("decisive")) {
    return `${protagonist} is in three-quarter view, her eyes focused on the challenge before her, her jaw set with quiet determination. Her lips are pressed into a firm, calm line — the expression of summoned courage, not bravado. Her body is upright, ready.${otherClause}`;
  }
  if (beatLower.includes("notic") || beatLower.includes("observ")) {
    return `${protagonist} is in three-quarter view, her gaze focused on what she has just noticed in the scene, her face thoughtful and present. Her lips are softly parted in quiet observation, mouth corners neutral. Her attention is entirely on what she sees, not on the viewer.${otherClause}`;
  }
  if (beatLower.includes("joy") || beatLower.includes("happ") || beatLower.includes("celebrat")) {
    return `${protagonist} is in three-quarter view, eyes bright and crinkled with genuine joy reacting to the scene around her. Her mouth is open in a real, unposed laugh — the eyes lead the joy, the smile follows from the eyes. Her body is engaged in the moment.${otherClause}`;
  }
  return `${protagonist} is in three-quarter view, engaged in the scene's action — looking at the action she's performing. Her face is calm and attentive, her lips softly closed in a natural neutral expression, brows relaxed. Her body is angled into the scene, not toward the viewer.${otherClause}`;
}

/**
 * Prompt restructure per AI Engineer audit 2026-05-09:
 * - Frames task as GENERATE-FROM-SCRATCH, not EDIT
 * - Image 1 = IDENTITY REFERENCE ONLY (face/skin/hair, NOT expression/pose)
 * - Image 2 = STYLE REFERENCE ONLY (watercolor medium, NOT character/expression/composition)
 * - Scene is a single narrative paragraph in positive prose, no NOT-negatives
 * - Mouth state described as part of whole-face narrative, not separate field
 */
function buildIter5Prompt(args: {
  childName: string;
  isCover: boolean;
  charactersOnPage: string[];
  emotionalBeat: string;
  storyScene: string; // the page.scene string from story
}): string {
  const sceneNarrative = args.isCover
    ? `${args.childName} is rendered as the iconic cover character: in three-quarter view with her face turned slightly toward the viewer, a warm natural expression — eyes open and engaged, lips softly closed with corners just gently lifted in a quiet, real smile (not a posed-for-camera grin). She is in the upper two-thirds of the frame; the lower third is neutral, untouched watercolor paper.`
    : sceneNarrativeFromBeat(args.emotionalBeat, args.charactersOnPage, args.childName);

  return `You are illustrating one page of a soft Egyptian watercolor children's storybook. Render the scene below as a fresh, original watercolor painting from scratch — do NOT copy any input image's composition, pose, or expression. Treat the inputs only as the references described below.

ROLE OF EACH INPUT IMAGE — read carefully:

Image 1 is the IDENTITY REFERENCE for ${args.childName}. Use it ONLY to learn her facial structure (eye shape, nose, jaw, lip geometry), her skin tone, her hair color, and her hair texture. Ignore her expression, her pose, the lighting, her clothing, and her background in image 1 — those have nothing to do with this scene.

Image 2 is the STYLE REFERENCE. Use it ONLY to match the watercolor medium, brushwork, wet-on-wet bleeds, color palette, and warm cream paper texture. Ignore the character, the expression, the pose, and the composition shown in image 2 — those come entirely from the scene description below, not from image 2.

SCENE — paint this exactly as described, painting ${args.childName} freshly from her identity in image 1:

${sceneNarrative}

Specific page action and setting: ${args.storyScene}

Composition: ${args.childName}'s face is fully readable in the frame — three-quarter view at minimum, with both eyes, the nose, and most of the mouth visible. She fills approximately 60% of the frame's vertical height. The remaining 40% holds the setting and any supporting characters as supporting context. Her face is anchored at one of the four rule-of-thirds intersections, never dead-centered.

Lighting: warm golden afternoon light filtering softly into the scene, gentle directional lighting with luminous edges, ambient watercolor glow.

Style execution: visible brush strokes, wet-on-wet bleeds where colors meet, cold-press paper texture showing through warm cream washes, soft pencil under-drawing visible at edges. The painterly handmade feel of a printed Egyptian children's book — Tomie dePaola's *Strega Nona* and Helen Oxenbury's *We're Going on a Bear Hunt* applied to Egyptian children and Cairo apartment settings.

Output: a single complete watercolor illustration of the scene above, painting ${args.childName} freshly from her identity in image 1 in the watercolor style of image 2. No text, letters, numbers, or typography anywhere in the image.`;
}

const TURN_2_CRITIQUE = (childName: string) => `
Look at your previous output and compare ${childName}'s face there to image 1 (her identity reference photo).

Re-assert the input roles: image 1 is the IDENTITY REFERENCE for ${childName}'s face only — its expression, pose, lighting, clothing must not influence the output. Image 2 is the STYLE REFERENCE only — its character, expression, pose, and composition must not influence the output. Both roles still hold.

Re-render the same scene with these specific face corrections to make ${childName} more clearly recognizable as the child in image 1: pull her eye shape closer to image 1's exact shape, pull her iris color closer to image 1's exact color, restore image 1's exact hair texture and curl pattern, match image 1's exact skin tone, and restore image 1's specific jaw and chin shape (do not soften toward a generic round face).

Keep the same scene, same pose narrative, same composition, same watercolor style. Only refine ${childName}'s face geometry to be a more faithful match to image 1.
`.trim();

function shrinkCloudinaryUrl(url: string): string {
  if (!url.includes("res.cloudinary.com") || !url.includes("/upload/")) return url;
  if (url.includes("/upload/c_") || url.includes("/upload/w_")) return url;
  // Aggressive shrink — w_768 + q_70 keeps it under 100KB per image
  return url.replace("/upload/", "/upload/c_limit,w_768,f_jpg,q_70/");
}

async function fetchAsBase64(url: string): Promise<{ data: string; mimeType: string }> {
  const res = await fetch(shrinkCloudinaryUrl(url));
  if (!res.ok) throw new Error(`Failed to fetch: ${res.status}`);
  const ct = res.headers.get("content-type") ?? "image/jpeg";
  const buf = Buffer.from(await res.arrayBuffer());
  console.log(`    fetched ${(buf.length / 1024).toFixed(0)}KB`);
  return { data: buf.toString("base64"), mimeType: ct };
}

interface InlineImage {
  data: string;
  mimeType: string;
}
// ContentPart now also tracks raw model parts so we can replay them with
// any thought_signature / thoughtSignature fields intact in multi-turn.
interface ContentPart {
  text?: string;
  inlineData?: InlineImage;
  // raw part object captured from a previous Google response — used when
  // replaying model role in multi-turn so thought_signature is preserved
  rawModelPart?: Record<string, unknown>;
}
interface ContentTurn {
  role: "user" | "model";
  parts: ContentPart[];
}

interface ApiResult {
  image: InlineImage;
  rawParts: Array<Record<string, unknown>>;
}

function callGoogleApiOnce(model: string, contents: ContentTurn[]): Promise<ApiResult> {
  return new Promise((resolve, reject) => {
    const apiKey = process.env.GOOGLE_AI_API_KEY!;
    const restContents = contents.map((turn) => ({
      role: turn.role,
      parts: turn.parts.map((part) => {
        // If we have a raw model part captured from a previous response, replay it as-is
        // (preserves thought_signature / thoughtSignature for chain-of-thought integrity).
        if (part.rawModelPart) {
          return part.rawModelPart;
        }
        if (part.inlineData) {
          return {
            inline_data: {
              mime_type: part.inlineData.mimeType,
              data: part.inlineData.data,
            },
          };
        }
        return { text: part.text };
      }),
    }));
    const body = JSON.stringify({
      contents: restContents,
      generationConfig: { responseModalities: ["IMAGE"], temperature: 0.4 },
    });
    const url = new URL(`${apiUrlFor(model)}?key=${apiKey}`);
    const req = https.request(
      {
        hostname: url.hostname,
        path: url.pathname + url.search,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
        timeout: 1_200_000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const responseBody = Buffer.concat(chunks).toString("utf8");
          if (res.statusCode !== 200) {
            const err = new Error(
              `Google API ${res.statusCode}: ${responseBody.slice(0, 200)}`,
            ) as Error & { statusCode?: number };
            err.statusCode = res.statusCode;
            return reject(err);
          }
          try {
            const json = JSON.parse(responseBody) as {
              candidates?: Array<{
                content?: {
                  parts?: Array<Record<string, unknown>>;
                };
              }>;
            };
            for (const cand of json.candidates ?? []) {
              const rawParts = cand.content?.parts ?? [];
              for (const part of rawParts) {
                const camel = part.inlineData as { data?: string; mimeType?: string } | undefined;
                if (camel?.data && camel?.mimeType) {
                  return resolve({
                    image: { data: camel.data, mimeType: camel.mimeType },
                    rawParts,
                  });
                }
                const snake = part.inline_data as { data?: string; mime_type?: string } | undefined;
                if (snake?.data && snake?.mime_type) {
                  return resolve({
                    image: { data: snake.data, mimeType: snake.mime_type },
                    rawParts,
                  });
                }
              }
            }
            reject(new Error(`No image: ${responseBody.slice(0, 300)}`));
          } catch (err) {
            reject(err);
          }
        });
      },
    );
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Timeout 20min"));
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

/**
 * Retry on primary model only — no fallback to other models (per founder's
 * brand-consistency call: every customer's book renders on the same model).
 * Backoff: 0s, 10s, 30s, 60s, 120s — 5 attempts total, ~3.5 min max wait.
 */
async function callGoogleApi(contents: ContentTurn[]): Promise<ApiResult> {
  const waits: number[] = [0, 10_000, 30_000, 60_000, 120_000];
  let lastErr: unknown = null;
  for (let i = 0; i < waits.length; i++) {
    const wait = waits[i] ?? 0;
    if (wait > 0) {
      console.log(`      retry in ${wait / 1000}s (attempt ${i + 1}/${waits.length})...`);
      await new Promise((r) => setTimeout(r, wait));
    }
    try {
      return await callGoogleApiOnce(PRIMARY_MODEL, contents);
    } catch (err) {
      lastErr = err;
      const status = (err as { statusCode?: number }).statusCode;
      const msg = (err as Error).message?.slice(0, 100);
      console.log(`      attempt ${i + 1}/${waits.length} → ${status ?? "err"}: ${msg}`);
      if (status && status !== 503 && status !== 429 && status !== 500) {
        throw err;
      }
    }
  }
  throw lastErr;
}

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
      { text: buildIter5Prompt(args) },
    ],
  }];

  console.log(`    turn 1 (anatomy + face-visible)...`);
  const t0 = Date.now();
  const turn1 = await callGoogleApi(turn1Contents);
  console.log(`    turn 1 done in ${((Date.now() - t0) / 1000).toFixed(0)}s`);

  // Multi-turn: replay turn 1's RAW parts as the model role (preserves
  // thoughtSignature for chain-of-thought integrity that Gemini requires).
  const turn2Contents: ContentTurn[] = [
    ...turn1Contents,
    {
      role: "model",
      parts: turn1.rawParts.map((rawPart) => ({ rawModelPart: rawPart })),
    },
    { role: "user", parts: [{ text: TURN_2_CRITIQUE(args.childName) }] },
  ];

  console.log(`    turn 2 (drift correction self-critique with raw parts)...`);
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
  console.log(`Iteration 5 — FINAL: REST + face-visible + multi-turn\n`);

  const sourceGen = await db
    .select()
    .from(generations)
    .where(eq(generations.id, SOURCE_GEN_ID))
    .limit(1)
    .then((r) => r[0]);
  if (!sourceGen?.coverUrl || !sourceGen?.storyJson) throw new Error("Source missing");

  const story = sourceGen.storyJson as {
    title: string;
    coverDescription?: string;
    pages: Array<{
      number: number;
      text: string;
      scene: string;
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

  const sourcePages = await db
    .select()
    .from(bookPages)
    .where(eq(bookPages.generationId, SOURCE_GEN_ID));

  console.log(`→ Pre-fetching customer photo...`);
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
  console.log(`\n→ Cover (multi-turn + face-visible)...`);
  const coverIllustration = await fetchAsBase64(sourceGen.coverUrl);
  const coverGenerated = await multiTurnRefine({
    childName: "Hena",
    isCover: true,
    charactersOnPage: ["Hena"],
    emotionalBeat: "iconic cover composition",
    storyScene: story.coverDescription ?? "Hena on the cover of her book",
    customerPhoto,
    illustration: coverIllustration,
  });
  const coverBuf = Buffer.from(coverGenerated.data, "base64");
  const coverUploaded = await uploadImage(
    coverBuf,
    ORDER_ID,
    "illustration_cover_iter5",
    coverGenerated.mimeType,
  );
  console.log(`  ✓ ${coverUploaded.url}`);
  await db
    .update(generations)
    .set({ coverUrl: coverUploaded.url, updatedAt: new Date() })
    .where(eq(generations.id, iterGenId));

  for (const pageNum of PAGES_TO_REFINE) {
    const sourceBookPage = sourcePages.find((p) => p.pageNumber === pageNum);
    const storyPage = story.pages.find((p) => p.number === pageNum);
    if (!sourceBookPage?.illustrationUrl || !storyPage) continue;
    console.log(`\n→ Page ${pageNum} | beat: "${storyPage.emotionalBeat}"`);
    const pageIllustration = await fetchAsBase64(sourceBookPage.illustrationUrl);
    const pageGenerated = await multiTurnRefine({
      childName: "Hena",
      isCover: false,
      charactersOnPage: storyPage.charactersOnPage,
      emotionalBeat: storyPage.emotionalBeat,
      storyScene: storyPage.scene,
      customerPhoto,
      illustration: pageIllustration,
    });
    const pageBuf = Buffer.from(pageGenerated.data, "base64");
    const pageUploaded = await uploadImage(
      pageBuf,
      ORDER_ID,
      `illustration_page_${pageNum}_iter5`,
      pageGenerated.mimeType,
    );
    console.log(`  ✓ ${pageUploaded.url}`);
    await db.insert(bookPages).values({
      generationId: iterGenId,
      pageNumber: pageNum,
      storyText: storyPage.text,
      illustrationUrl: pageUploaded.url,
      illustrationPrompt: buildIter5Prompt({
        childName: "Hena",
        isCover: false,
        charactersOnPage: storyPage.charactersOnPage,
        emotionalBeat: storyPage.emotionalBeat,
        storyScene: storyPage.scene,
      }).slice(0, 2000),
      illustrationProvider: "gemini-3.1-iter5-multi",
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

  console.log(`\n✅ Iter 5 complete (final).`);
  console.log(`   Generation ID: ${iterGenId}`);
  console.log(`   Admin URL:     https://hadouta-admin.vercel.app/orders/${iterGenId}`);
}

main()
  .catch((err) => {
    console.error("\n❌ Iter 5 failed:", err);
    process.exit(1);
  })
  .then(() => process.exit(0));
