// hadouta-backend/src/scripts/run-phase-1-iteration-2.ts
//
// Phase 1 iteration 2 (2026-05-06) — addresses founder feedback after iteration 1:
//   1. Same scene across 3 pictures → strong page-specific composition language
//   2. One image looked "AI-edited photo" not Pixar → LoRA scale 0.85 → 0.95 +
//      Pixar trigger word frontloaded + anti-watercolor negatives countering Bible's
//      anti-3D negativeStyle
//   3. Hero alone, no other characters → inject supporting characters per scene
//      (the Bible's supportingCharacters array was empty — bug in Bible-gen step)
//   4. Cross-page outfit continuity → hardcoded outfit string, "same as previous
//      pages" language, lock state explicitly
//
// Strategy: bypass buildIllustrationPrompt entirely. The Bible was generated for
// the watercolor pipeline and contains anti-3D negatives + empty supporting
// characters. For Phase 1 iteration we construct the prompts inline with
// Pixar-friendly overrides; production refactor of buildIllustrationPrompt to
// support multi-provider register is Sprint 3 work.
//
// Generates: cover + 3 body pages (page 1 bedroom, page 8 classroom, page 16
// waking up). Inserts a NEW generation row pointing at the same order, assembles
// PDF via existing render-book pipeline, patches status back to awaiting_review
// so admin queue shows it.
//
// License posture: §1(c)(ii) BFL Flux.1 [dev] research/evaluation carve-out.
// Outputs are NOT delivered to end users (the new generation row is for founder
// review only; orderId points to an already-delivered order so customer is
// unaffected).
//
// Run: pnpm tsx src/scripts/run-phase-1-iteration-2.ts

import "dotenv/config";
import { randomUUID } from "node:crypto";
import { db } from "../db/index.js";
import {
  generations,
  bookPages,
  photos as photosTable,
} from "../db/schema.js";
import { eq, and } from "drizzle-orm";
import {
  generateCoverIllustration,
  generateBodyIllustration,
} from "../lib/ai/illustration-generator.js";
import { assembleBookPdf } from "../lib/pdf/render-book.js";

// Source generation — has Hanine's storyJson, bibleJson, customer photos.
const SOURCE_GENERATION_ID = "fad8f418-6464-43df-9ce2-06488b58c8a5";

// Iteration 2 page selection — domestic + multi-character + emotional bookend.
const SELECTED_BODY_PAGES = [1, 8, 16] as const;

// Hardcoded outfit lock for state continuity (Bible's outfit was "bright green
// top with fabric bow" which is wrong for a school-day arc). Pages 1 + 8 share
// the school-day outfit; page 16 (waking up next morning at home) is pajamas.
const OUTFIT_BY_PAGE: Record<number, string> = {
  0: "navy-blue school uniform with white peter-pan collar, knee-length pleated skirt, white school socks, dark brown school shoes, beige school satchel slung on her shoulder, red ribbon tied in her curly dark-brown hair (the iconic school-day look established for the entire book)",
  1: "navy-blue school uniform with white peter-pan collar, knee-length pleated skirt, white school socks (just dressed for school), red ribbon being tied in her curly dark-brown hair by her mother — the SAME school-day outfit she will wear on every other school-day page in this book",
  8: "the SAME navy-blue school uniform with white peter-pan collar, pleated skirt, white socks, red ribbon in her curly dark-brown hair as in the bedroom-with-mother and arrival-at-school pages — outfit and hair styling are unchanged from earlier in the same school day",
  16: "soft pink cotton pajamas with a small white star pattern, hair untied and slightly tousled — she has changed for sleep at the end of the school day; this is a different time and a different outfit from the school-uniform pages",
};

// Supporting characters per page — derived from story scene text since Bible's
// supportingCharacters array is empty. Egyptian-cultural specific descriptions.
const SUPPORTING_BY_PAGE: Record<number, string> = {
  0: "", // cover: hero solo, iconic posture
  1: "MOTHER (Egyptian woman in her early 30s, warm complexion, soft long dark-brown hair tied loosely back, gentle eyes, wearing a simple cream-colored housedress with a thin shawl draped on her shoulders, kneeling slightly to be at her daughter's height, hands gently tying a red ribbon in Hanine's hair, soft loving expression — Pixar 3D rendered)",
  8: "TEACHER (Middle-aged Egyptian woman, kind warm face, dark hair pulled into a low neat bun, wearing a soft modest cardigan over a long-sleeve blouse, standing slightly behind Hanine with one open welcoming hand gesture, gentle smile — Pixar 3D rendered). CLASSMATES (5–6 Egyptian children ages 5–7, mixed boys and girls in similar school uniforms, seated at small wooden desks in a sunny Cairo classroom, looking at Hanine with curious friendly smiles, one girl waving — Pixar 3D rendered)",
  16: "", // page 16: waking up alone in bed
};

// Composition direction per page — emphasizes scene differentiation.
const COMPOSITION_BY_PAGE: Record<number, string> = {
  0: "Wide hero composition. Hanine centered, slightly looking up with confidence, schoolbag visible. Cairo school courtyard backdrop with soft morning light. Iconic opening illustration — distinct from any interior scene.",
  1: "Indoor warm-domestic composition. Tight-mid framing. Hanine seated or standing at her bedroom mirror; mother kneeling beside her. Soft window-morning-light from upper-left. Visible bedroom props (bed with pink quilt, small bookshelf, framed family photo, school bag on chair). Mother's hands actively tying the ribbon — the action is the focal point. Camera at child's eye level.",
  8: "Wide classroom composition. Hanine standing near front of classroom, slight 3/4 view, addressing the class with a small brave smile. Teacher standing supportively behind/beside her. Classmates visible at desks in foreground/middle ground, all looking at Hanine. Sunny Cairo classroom interior with chalkboard, Arabic alphabet poster on wall, schoolbags on floor. Camera at child's eye level. Distinct from any home-interior scene.",
  16: "Tight intimate close-up. Hanine in bed, just opened her eyes, small content smile. Soft golden morning light streaming through bedroom window onto her pillow. Pink quilt visible. Bedside table with small lamp. Camera tight on her face and upper body. Distinct, more intimate composition than any other page.",
};

const SCENE_BY_PAGE: Record<number, string> = {
  0: "Hanine, the Egyptian girl from the reference photos, on her first day of school — standing confidently in a sunny Cairo school courtyard holding her beige school satchel. Iconic poster-style opening shot of a brave little girl beginning a new chapter, ready to enter through the school gates.",
  1: "Hanine standing in her warmly-lit bedroom on the morning of her first day of school. Her mother is kneeling beside her, gently tying a red ribbon in her curly dark-brown hair. Hanine's school uniform is neatly worn; her schoolbag waits on the chair behind her. The mother's expression is loving and reassuring. Hanine looks slightly nervous but hopeful.",
  8: "Hanine standing at the front of her new sunny Cairo classroom, introducing herself to the class with a brave small smile. Her teacher stands warmly beside her with a welcoming gesture. Her classmates — Egyptian children ages 5–7 in similar uniforms — sit at small desks looking at her with curious friendly smiles. One classmate is waving in welcome.",
  16: "Hanine in her bed the next morning, just waking up, sunlight streaming through her bedroom window onto her pillow. She is wearing soft pink pajamas with a small white star pattern; her hair is untied and slightly tousled. Her face shows a content small smile — she is feeling confident and ready for whatever is next.",
};

// ─── Pixar prompt builder (inline, bypasses production buildIllustrationPrompt) ───
function buildPixarPrompt(args: {
  pageNumber: number;
  childAge: number;
  childGender: string;
  childAppearance: { hair?: string; skin?: string; eyes?: string };
  culturalNotes: string[];
}): { positive: string; negative: string } {
  const outfit = OUTFIT_BY_PAGE[args.pageNumber] ?? OUTFIT_BY_PAGE[0];
  const supporting = SUPPORTING_BY_PAGE[args.pageNumber] ?? "";
  const composition = COMPOSITION_BY_PAGE[args.pageNumber] ?? "";
  const scene = SCENE_BY_PAGE[args.pageNumber] ?? "";

  // Pixar trigger words FRONTLOADED so the LoRA's activation hits first.
  const styleBlock =
    "Pixar 3D animated style, in the visual register of Disney Encanto / Coco / Inside Out — stylized 3D rendering, soft volumetric lighting, expressive 3D-rendered facial features, smooth subsurface scattering on warm skin, warm cinematic color grading, painterly textures on clothing.";

  // Page-specific scene block — emphatic, differentiated.
  const sceneBlock =
    args.pageNumber === 0
      ? `COVER COMPOSITION: ${scene} ${composition}`
      : `PAGE ${args.pageNumber} COMPOSITION (this specific scene only): ${scene} ${composition} The composition, camera angle, and visible elements MUST be unique to this moment — visibly different from any other page in the book.`;

  // Character + outfit lock + identity preservation.
  const characterBlock =
    `MAIN CHARACTER (Hanine): Egyptian ${args.childGender}, ${args.childAge} years old. ` +
    `Hair: ${args.childAppearance.hair ?? "curly dark-brown shoulder-length"}. ` +
    `Skin: ${args.childAppearance.skin ?? "warm Egyptian complexion"}. ` +
    `Eyes: ${args.childAppearance.eyes ?? "large dark-brown"}. ` +
    `Wearing: ${outfit}. ` +
    `IDENTITY MUST EXACTLY MATCH the reference photos provided as image_urls — same face shape, same eye shape and color, same hair color and styling. Render the SAME girl across pages.`;

  // Supporting characters block (skip when empty).
  const supportingBlock = supporting
    ? `OTHER CHARACTERS PRESENT IN THIS SCENE (must be visibly rendered alongside Hanine, all in the SAME Pixar 3D animated style as Hanine, NOT in any other style): ${supporting}.`
    : "";

  // Cultural anchors from Bible.
  const culturalBlock =
    args.culturalNotes.length > 0
      ? `Egyptian cultural anchors (render exactly as described): ${args.culturalNotes.join("; ")}.`
      : "";

  // Composition rule per founder feedback (60/40).
  const focusBlock =
    "Composition focus: ~60% on the main character" +
    (supporting ? " and other characters in the scene" : "") +
    "; ~40% on setting, props, and atmospheric details. Do not over-detail the background — preserve the storytelling moment as the focal point.";

  const positive = [
    styleBlock,
    sceneBlock,
    characterBlock,
    supportingBlock,
    culturalBlock,
    focusBlock,
  ]
    .filter((s) => s.length > 0)
    .join(" ");

  // Strong anti-conflicting-style negatives. The Bible's negativeStyle
  // ("NOT 3D-rendered") is replaced here with Pixar-friendly negatives.
  const negative =
    "watercolor, photorealistic, real photo, AI-edited photograph, 2D-flat illustration, vector art, line drawing, sketch, anime, manga, sharp digital lines, low-poly 3D";

  return { positive, negative };
}

async function main(): Promise<void> {
  // ─── Load source generation + photos ───
  const sourceGen = await db
    .select()
    .from(generations)
    .where(eq(generations.id, SOURCE_GENERATION_ID))
    .limit(1)
    .then((r) => r[0]);
  if (!sourceGen) throw new Error(`Source generation ${SOURCE_GENERATION_ID} not found.`);
  if (!sourceGen.bibleJson) throw new Error("Source has no bibleJson.");
  if (!sourceGen.storyJson) throw new Error("Source has no storyJson.");

  const orderId = sourceGen.orderId;
  const bible = sourceGen.bibleJson as {
    characterBible?: {
      mainChild?: {
        gender?: string;
        age?: number;
        appearance?: { hair?: string; skin?: string; eyes?: string };
      };
    };
    culturalNotes?: string[];
  };
  const story = sourceGen.storyJson as {
    title?: string;
    pages?: Array<{ number?: number; text?: string }>;
  };

  const child = bible.characterBible?.mainChild ?? {};
  const culturalNotes = bible.culturalNotes ?? [];

  // ─── Load customer photos ───
  const photoRows = await db
    .select()
    .from(photosTable)
    .where(and(eq(photosTable.orderId, orderId), eq(photosTable.ownerType, "main_child")));
  const photoUrls = photoRows
    .map((p) => (p as { url?: string }).url)
    .filter((u): u is string => typeof u === "string" && u.length > 0);
  if (photoUrls.length === 0) throw new Error("No main_child photos for order.");
  console.log(`Loaded ${photoUrls.length} reference photos for order ${orderId}.`);

  // ─── Create new generation row ───
  const newGenId = randomUUID();
  console.log(`\nCreating new generation row ${newGenId}...`);
  await db.insert(generations).values({
    id: newGenId,
    orderId,
    status: "generating_illustrations",
    storyJson: sourceGen.storyJson,
    bibleJson: sourceGen.bibleJson,
    illustrationsCount: 4, // 1 cover + 3 body
    estimatedCostCents: 50, // ~$0.50 estimate
    startedAt: new Date(),
  });

  // ─── Generate cover ───
  const coverPrompt = buildPixarPrompt({
    pageNumber: 0,
    childAge: child.age ?? 5,
    childGender: child.gender ?? "girl",
    childAppearance: child.appearance ?? {},
    culturalNotes,
  });
  console.log("\n→ Generating Pixar cover (iteration 2)...");
  const coverResult = await generateCoverIllustration({
    orderId,
    positivePrompt: coverPrompt.positive,
    negativePrompt: coverPrompt.negative,
    customerPhotoUrls: photoUrls,
    provider: "flux-kontext-pixar",
  });
  console.log("   Cover URL:", coverResult.url);

  await db
    .update(generations)
    .set({ coverUrl: coverResult.url, updatedAt: new Date() })
    .where(eq(generations.id, newGenId));

  // ─── Generate body pages ───
  for (const pageNum of SELECTED_BODY_PAGES) {
    const storyPage = story.pages?.find((p) => p.number === pageNum);
    if (!storyPage) {
      console.log(`⚠️ Story page ${pageNum} not found — skipping.`);
      continue;
    }
    const pagePrompt = buildPixarPrompt({
      pageNumber: pageNum,
      childAge: child.age ?? 5,
      childGender: child.gender ?? "girl",
      childAppearance: child.appearance ?? {},
      culturalNotes,
    });
    console.log(`\n→ Generating Pixar page ${pageNum} (iteration 2)...`);
    const pageResult = await generateBodyIllustration({
      orderId,
      pageNumber: pageNum,
      positivePrompt: pagePrompt.positive,
      negativePrompt: pagePrompt.negative,
      coverImageUrl: coverResult.url,
      customerPhotoUrls: photoUrls,
      provider: "flux-kontext-pixar",
    });
    console.log("   Page URL:", pageResult.url);

    // Insert bookPages row
    await db.insert(bookPages).values({
      generationId: newGenId,
      pageNumber: pageNum,
      storyText: storyPage.text ?? "",
      illustrationUrl: pageResult.url,
      illustrationPrompt: pagePrompt.positive.slice(0, 2000),
      illustrationProvider: pageResult.modelId,
      illustrationGeneratedAt: new Date(),
    });
  }

  // ─── Assemble PDF ───
  console.log("\n→ Assembling PDF...");
  const pdfResult = await assembleBookPdf({ generationId: newGenId });
  console.log(`   PDF URL: ${pdfResult.pdfUrl}`);
  console.log(`   PDF size: ${(pdfResult.bytes / 1024).toFixed(1)} KB`);
  console.log(`   PDF assembly took ${(pdfResult.durationMs / 1000).toFixed(1)}s`);

  // ─── Patch generation status back to awaiting_review so admin queue shows it ───
  // assembleBookPdf set status to 'delivered' — we want it visible in the
  // founder-review queue, not silently in delivered state.
  await db
    .update(generations)
    .set({ status: "awaiting_review", deliveredAt: null, updatedAt: new Date() })
    .where(eq(generations.id, newGenId));

  console.log("\n✅ Phase 1 iteration 2 complete.");
  console.log(`   New generation ID: ${newGenId}`);
  console.log(`   Admin queue link: https://hadouta-admin.vercel.app/orders/${newGenId}`);
  console.log(`   PDF (direct):     ${pdfResult.pdfUrl}`);
}

main()
  .catch((err) => {
    console.error("❌ Phase 1 iteration 2 failed:", err);
    process.exit(1);
  })
  .then(() => process.exit(0));
