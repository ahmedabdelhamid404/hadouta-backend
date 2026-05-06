// hadouta-backend/src/scripts/run-phase-1-iteration-3.ts
//
// Phase 1 iteration 3 (2026-05-06) — addresses founder feedback after iteration 2:
//   1. SUPPORTING CHARACTERS (mother, teacher, classmates) all looked like Hanine
//      → photos passed as image_urls were applied to EVERY face in scene because
//      prompt didn't disambiguate which character is the photo subject. Fix:
//      explicit "photos = ONLY Hanine, NOT any other character" language +
//      strong physically-distinct features for supporting characters + negative
//      prompt against face copying.
//   2. BLACK/BROKEN PAGE 16 (10KB file = empty image) → prompt collapsed the
//      model: "intimate close-up + soft golden morning light + pajamas she's
//      never worn in references" was contradictory. Fix: bright sunny scene,
//      wider framing, simpler outfit transition.
//   3. POSES FELT STIFF / SCENE FELT EMPTY → add explicit pose + facial
//      expression direction per page; add specific environmental props for
//      warmth; emphasize the emotional moment of each scene.
//
// What's preserved from iteration 2 (don't break what's working):
//   - Path D architecture (Flux Kontext + Pixar LoRA, no per-customer training)
//   - Hardcoded outfit lock for cross-page continuity
//   - Per-page scene differentiation
//   - 60/40 hero-vs-setting composition
//
// Run: pnpm tsx src/scripts/run-phase-1-iteration-3.ts

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

const SOURCE_GENERATION_ID = "fad8f418-6464-43df-9ce2-06488b58c8a5";
const SELECTED_BODY_PAGES = [1, 8, 16] as const;

// Outfit lock (continuity). Iteration 3: page 16 outfit simplified — keep her
// in the same school-day clothes since it's the SAME school day from morning
// (page 1) through evening reflection (page 16). Avoids the photo-reference
// mismatch that broke page 16 in iteration 2.
const OUTFIT_BY_PAGE: Record<number, string> = {
  0: "navy-blue school uniform with white peter-pan collar, knee-length pleated skirt, white school socks, dark brown school shoes, beige school satchel slung on her shoulder, red ribbon tied in her curly dark-brown hair (the iconic school-day look established for the entire book)",
  1: "navy-blue school uniform with white peter-pan collar, knee-length pleated skirt, white school socks (just dressed for school), red ribbon being tied in her curly dark-brown hair by her mother — the SAME school-day outfit she will wear on every other page in this book",
  8: "the SAME navy-blue school uniform with white peter-pan collar, pleated skirt, white socks, red ribbon in her curly dark-brown hair as in the bedroom-with-mother and arrival-at-school pages — outfit and hair styling are unchanged from earlier in the same school day",
  16: "navy-blue school uniform with white peter-pan collar, pleated skirt, white socks, red ribbon in her curly dark-brown hair — the SAME outfit as throughout this book; she has just come home and is ready for whatever comes next, but has not yet changed clothes",
};

// Iteration 3: supporting characters now have STRONGLY DISTINCT physical
// features so the model has clear differentiation signal vs Hanine's photo.
// Also added explicit "DIFFERENT FACE FROM HANINE" + age cue + body type cue.
const SUPPORTING_BY_PAGE: Record<number, string> = {
  0: "",
  1:
    "MOTHER (Egyptian woman in her early 30s — VERY DIFFERENT face from Hanine: " +
    "ADULT woman with a longer oval face shape, defined cheekbones, mature " +
    "features, NOT a child's face. She has long straight chestnut-brown hair " +
    "loosely tied back with a few wisps escaping (clearly different from " +
    "Hanine's short curly hair), darker skin than Hanine's, soft gentle " +
    "almond-shaped brown eyes with subtle laugh lines. Wearing a simple " +
    "cream-colored long-sleeve housedress with small floral embroidery at the " +
    "collar, a thin lavender shawl draped on her shoulders. She is kneeling " +
    "with maternal warmth, hands gently and lovingly tying the red ribbon in " +
    "Hanine's hair. Her face shows tender pride — soft smile, slightly misty " +
    "eyes, head tilted with affection. Pixar 3D rendered with the same style " +
    "language as Hanine but rendered as a CLEARLY DIFFERENT and OLDER PERSON.",
  8:
    "TEACHER (Middle-aged Egyptian woman, mid 40s — VERY DIFFERENT face from " +
    "Hanine: ADULT woman with a round warm face, soft full cheeks, kind eyes " +
    "with crow's-foot smile lines, slightly fuller build. Dark hair pulled " +
    "into a low neat bun with a pencil tucked above her ear, wearing a soft " +
    "olive-green cardigan over a long-sleeve cream blouse with a small silver " +
    "pin at the collar. She stands slightly behind Hanine with one open " +
    "welcoming hand gesture, beaming smile, head tilted slightly toward " +
    "Hanine in encouragement). " +
    "CLASSMATES (5–6 Egyptian children ages 5–7 — EACH WITH DISTINCT faces, " +
    "hair, and skin tones, all DIFFERENT from Hanine and each other: one boy " +
    "with curly black hair and round face, one girl with long straight black " +
    "hair in two braids and lighter skin, one boy with short cropped hair and " +
    "freckles, one girl with a shoulder-length bob and glasses, one boy with " +
    "wavy hair and dimples. All in similar school uniforms, seated at small " +
    "wooden desks, looking at Hanine with curious friendly smiles, one girl " +
    "in front waving a tiny welcoming hand, one boy giving a thumbs-up. Pixar " +
    "3D rendered, all in the same style as Hanine but as CLEARLY DIFFERENT " +
    "INDIVIDUAL CHILDREN, NOT clones of Hanine.",
  16: "",
};

// Heart-warming pose + emotional moment direction per page.
const POSE_BY_PAGE: Record<number, string> = {
  0:
    "Hanine standing confidently in the courtyard, slight three-quarter view, " +
    "head turned toward the viewer with a small brave smile. Her stance is " +
    "centered and balanced; one hand grips the schoolbag strap on her shoulder, " +
    "the other rests loosely at her side. Her eyes are bright with anticipation. " +
    "The pose says: 'I'm ready, even though I'm a little nervous.'",
  1:
    "Hanine seated at the edge of her bed, leaning slightly into her mother's " +
    "gentle hands. Her shoulders are relaxed, her face turned slightly toward " +
    "her mother with a soft trusting half-smile, eyes lifted in warm trust. " +
    "Her hands rest in her lap, fingers loosely interlaced. The mother kneels " +
    "facing her, hands working the ribbon with care, gaze fixed lovingly on " +
    "her daughter's hair. The two are emotionally connected — a quiet, tender " +
    "morning ritual. The pose says: 'I am loved and prepared.'",
  8:
    "Hanine standing at the front of the classroom, tiny but composed, hands " +
    "clasped lightly in front of her. Her face shows brave determination — a " +
    "soft smile that's just a little uncertain, eyes bright and looking " +
    "directly at the class. Her shoulders are pulled back slightly with " +
    "courage. The teacher beside her has one hand at Hanine's shoulder-blade " +
    "level (not touching, just present and supportive), eyes warm with pride. " +
    "Classmates lean forward slightly with curiosity. The pose says: 'I am " +
    "introducing myself, and the world is welcoming me back.'",
  16:
    "Hanine sitting cross-legged on her bedroom floor at the end of the day, " +
    "looking through the bedroom window with a soft contented smile, eyes " +
    "thoughtful and bright with the satisfaction of a day well-survived. Her " +
    "schoolbag rests beside her, the red ribbon still in her hair. Her hands " +
    "are folded in her lap. Warm late-afternoon light streams through the " +
    "window onto her face and the bedroom floor. The pose says: 'I did it. " +
    "Tomorrow I'll do it again.'",
};

// Specific environmental warmth props per page.
const SCENE_PROPS_BY_PAGE: Record<number, string> = {
  0:
    "Sunny Egyptian school courtyard backdrop with a warm-stone arched gateway, " +
    "a few other children walking in pairs in the distance, a soft tree casting " +
    "dappled light, a scattering of fallen leaves, a tiny bird on a windowsill, " +
    "warm morning sunlight glowing on the courtyard pavement.",
  1:
    "Cozy Egyptian girl's bedroom with: a single bed against the wall covered " +
    "with a pink-and-cream quilt, two soft pillows, a small plush bear sitting " +
    "by the headboard. A wooden dresser with: a framed family photo (slightly " +
    "blurred so you can tell it's family without seeing faces), a tiny perfume " +
    "bottle, a small jewelry tray. A patterned rug with warm earthy colors on " +
    "the floor. Lace curtains glowing in the morning light by an open window. " +
    "A small bookshelf with picture books visible. Hanine's beige schoolbag " +
    "waiting on a wooden chair near the door. A watercolor painting of a " +
    "flower hung above the bed. The room feels warm, lived-in, deeply loved.",
  8:
    "Sunny Cairo classroom interior with: a green chalkboard at the front with " +
    "Arabic letters lightly visible in chalk, an Arabic alphabet poster on the " +
    "side wall, child-made paper crafts hung on a string from one corner of " +
    "the ceiling, small wooden desks in two rows with tiny chairs, schoolbags " +
    "piled neatly on the floor by the back wall, sunlight streaming through " +
    "tall windows with sheer curtains, fine chalk dust drifting visibly in the " +
    "sunbeams. A small potted plant on the teacher's desk. The classroom feels " +
    "warm, alive, welcoming.",
  16:
    "Hanine's bedroom (same room as page 1, recognizable continuity): the " +
    "same bed with pink-and-cream quilt, the same wooden dresser, the same " +
    "patterned rug, the same lace curtains. Late-afternoon golden light " +
    "streaming through the open window onto the wooden floor where Hanine " +
    "sits. Her schoolbag is dropped beside her, half-open with a notebook " +
    "peeking out. A glass of milk and a small plate with two cookies on a " +
    "tray nearby (her mother brought them). The plush bear from earlier is " +
    "now sitting next to her on the floor. The room feels content, settled, " +
    "the soft after-glow of a meaningful first day.",
};

const SCENE_BY_PAGE: Record<number, string> = {
  0: "Hanine, the Egyptian girl from the reference photos, on her first day of school — standing confidently at the entrance of a sunny Cairo school courtyard holding her beige school satchel. Iconic poster-style opening shot of a brave little girl beginning a new chapter, a slight nervous flutter visible only in her eyes — but her stance is courageous.",
  1: "The morning of Hanine's first day of school. Her mother kneels beside her in the warm cozy bedroom, hands tying a red ribbon in Hanine's curly hair. Hanine is dressed in her school uniform; her schoolbag waits on the chair behind her. The mother's expression is loving and protective. Hanine is leaning into her mother's gentle care with quiet trust. A tender, heart-warming morning ritual.",
  8: "Hanine standing at the front of her new sunny Cairo classroom, introducing herself to the class with a brave small smile. Her teacher stands warmly beside her with a welcoming gesture. Her classmates — Egyptian children ages 5–7 in similar uniforms with DISTINCT individual faces — sit at small desks looking at her with curious friendly smiles. One classmate is waving in welcome; another gives a tiny thumbs-up. A heart-warming moment of being welcomed in.",
  16: "Hanine at home at the end of her first school day, sitting on her bedroom floor with the warm late-afternoon light streaming through the window. She is reflecting on the day with a soft contented smile, schoolbag beside her, looking through the window peacefully. She is still wearing her school uniform from earlier (no costume change). The mood is warm, satisfied, the after-glow of a day-well-survived.",
};

function buildPixarPrompt(args: {
  pageNumber: number;
  childAge: number;
  childGender: string;
  childAppearance: { hair?: string; skin?: string; eyes?: string };
  culturalNotes: string[];
}): { positive: string; negative: string } {
  const outfit = OUTFIT_BY_PAGE[args.pageNumber] ?? OUTFIT_BY_PAGE[0];
  const supporting = SUPPORTING_BY_PAGE[args.pageNumber] ?? "";
  const pose = POSE_BY_PAGE[args.pageNumber] ?? "";
  const props = SCENE_PROPS_BY_PAGE[args.pageNumber] ?? "";
  const scene = SCENE_BY_PAGE[args.pageNumber] ?? "";

  const styleBlock =
    "Pixar 3D animated style, in the visual register of Disney Encanto / Coco / Inside Out — stylized 3D rendering, soft volumetric lighting, expressive 3D-rendered facial features, smooth subsurface scattering on warm skin, warm cinematic color grading, painterly textures on clothing.";

  const sceneBlock =
    args.pageNumber === 0
      ? `COVER COMPOSITION: ${scene}`
      : `PAGE ${args.pageNumber} COMPOSITION (this specific scene only): ${scene} The composition, camera angle, and visible elements MUST be unique to this moment — visibly different from any other page in the book.`;

  // CRITICAL identity-disambiguation language (iteration 3 fix).
  const characterBlock =
    `MAIN CHARACTER (Hanine): Egyptian ${args.childGender}, ${args.childAge} years old. ` +
    `Hair: ${args.childAppearance.hair ?? "curly dark-brown shoulder-length"}. ` +
    `Skin: ${args.childAppearance.skin ?? "warm Egyptian complexion"}. ` +
    `Eyes: ${args.childAppearance.eyes ?? "large dark-brown"}. ` +
    `Wearing: ${outfit}. ` +
    `IDENTITY: The reference photos provided as image_urls show ONLY Hanine — these photos are ONLY a reference for HANINE's face and identity, and MUST NOT be applied to any other character in the scene. Hanine's face must EXACTLY match the reference photos (same face shape, same eye shape and color, same hair color and styling). All OTHER characters in this scene have DIFFERENT faces from Hanine and DIFFERENT faces from each other — use the descriptions below for them, NOT the photos.`;

  const supportingBlock = supporting
    ? `OTHER CHARACTERS PRESENT IN THIS SCENE (rendered alongside Hanine in the SAME Pixar 3D style, but as VISUALLY DISTINCT INDIVIDUALS — different faces, different ages, different hair, different builds — NOT copies of Hanine, NOT siblings of Hanine, NOT versions of Hanine): ${supporting}`
    : "";

  const poseBlock = pose ? `POSE & EMOTION: ${pose}` : "";

  const propsBlock = props ? `SETTING & ENVIRONMENTAL DETAILS: ${props}` : "";

  const culturalBlock =
    args.culturalNotes.length > 0
      ? `Egyptian cultural anchors (render exactly as described): ${args.culturalNotes.join("; ")}.`
      : "";

  const focusBlock =
    "Composition focus: ~60% on the main character" +
    (supporting ? " and other characters' interaction with her" : "") +
    "; ~40% on setting, props, and atmospheric warmth. The image should feel heart-warming, emotionally rich, with a clear single focal moment. Do not over-detail; preserve the storytelling moment as the focal point.";

  const positive = [
    styleBlock,
    sceneBlock,
    characterBlock,
    supportingBlock,
    poseBlock,
    propsBlock,
    culturalBlock,
    focusBlock,
  ]
    .filter((s) => s.length > 0)
    .join(" ");

  // Iteration 3: stronger negative language against face copying onto
  // supporting characters.
  const negative =
    "watercolor, photorealistic, real photo, AI-edited photograph, " +
    "2D-flat illustration, vector art, line drawing, sketch, anime, manga, " +
    "sharp digital lines, low-poly 3D, " +
    "supporting characters with the same face as the main child, " +
    "duplicate child faces, multiple children all looking like the main child, " +
    "mother looking like a child, teacher looking like a child, " +
    "empty cold scene, sterile background, blank room, " +
    "completely black image, dark unrenderable image, washed-out empty space";

  return { positive, negative };
}

async function main(): Promise<void> {
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
    pages?: Array<{ number?: number; text?: string }>;
  };
  const child = bible.characterBible?.mainChild ?? {};
  const culturalNotes = bible.culturalNotes ?? [];

  const photoRows = await db
    .select()
    .from(photosTable)
    .where(and(eq(photosTable.orderId, orderId), eq(photosTable.ownerType, "main_child")));
  const photoUrls = photoRows
    .map((p) => (p as { url?: string }).url)
    .filter((u): u is string => typeof u === "string" && u.length > 0);
  if (photoUrls.length === 0) throw new Error("No main_child photos for order.");
  console.log(`Loaded ${photoUrls.length} reference photos for order ${orderId}.`);

  const newGenId = randomUUID();
  console.log(`\nCreating new generation row ${newGenId} (iteration 3)...`);
  await db.insert(generations).values({
    id: newGenId,
    orderId,
    status: "generating_illustrations",
    storyJson: sourceGen.storyJson,
    bibleJson: sourceGen.bibleJson,
    illustrationsCount: 4,
    estimatedCostCents: 50,
    startedAt: new Date(),
  });

  const coverPrompt = buildPixarPrompt({
    pageNumber: 0,
    childAge: child.age ?? 5,
    childGender: child.gender ?? "girl",
    childAppearance: child.appearance ?? {},
    culturalNotes,
  });
  console.log("\n→ Generating Pixar cover (iteration 3)...");
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
    console.log(`\n→ Generating Pixar page ${pageNum} (iteration 3)...`);
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

  console.log("\n→ Assembling PDF...");
  const pdfResult = await assembleBookPdf({ generationId: newGenId });
  console.log(`   PDF URL: ${pdfResult.pdfUrl}`);
  console.log(`   PDF size: ${(pdfResult.bytes / 1024).toFixed(1)} KB`);

  await db
    .update(generations)
    .set({ status: "awaiting_review", deliveredAt: null, updatedAt: new Date() })
    .where(eq(generations.id, newGenId));

  console.log("\n✅ Phase 1 iteration 3 complete.");
  console.log(`   New generation ID: ${newGenId}`);
  console.log(`   Admin queue link: https://hadouta-admin.vercel.app/orders/${newGenId}`);
  console.log(`   PDF (direct):     ${pdfResult.pdfUrl}`);
}

main()
  .catch((err) => {
    console.error("❌ Phase 1 iteration 3 failed:", err);
    process.exit(1);
  })
  .then(() => process.exit(0));
