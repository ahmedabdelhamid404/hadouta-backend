// hadouta-backend/src/scripts/run-phase-1-iteration-4.ts
//
// Phase 1 iteration 4 (2026-05-06) — final iteration. Addresses iteration-3
// founder + AI-engineer review findings:
//
//   1. Mother on page 1 looked like a teenager / older sister, not a 30+ mom
//   2. The ribbon-tying action moment was missing — they were just sitting
//   3. The wrong character (mother) wore the red ribbon
//   4. Accessory drift: red ribbon on cover/p16, red headband on p8
//   5. Teacher on page 8 looked too young
//   6. Classmates on page 8 were anonymous backs-of-heads
//   7. Page 16 atmosphere was muted instead of dramatic golden-hour
//   8. Page 16 emotion read as worried-contemplative not satisfied-content
//
// Iteration 4 strategy:
//   - Pixar movie references for age/type registers (Encanto's Abuela for the
//     mother, Frozen's Oaken for adult body proportions, etc.) — Pixar is biased
//     toward youthful Pixar-cuteness; explicit movie references push it harder
//   - Hard age-marker visuals (fine smile lines, slight grey at temples,
//     fuller adult build, visibly TALLER than Hanine)
//   - Explicit dynamic-moment language for the ribbon-tying action
//   - Accessory unified to "red satin ribbon" everywhere; "headband" word banned
//   - 2 named classmates with face-forward distinctive features
//   - Dramatic light language for page 16 with sun-rays + warm honey-colored glow
//
// Run: pnpm tsx src/scripts/run-phase-1-iteration-4.ts

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

// ─── Outfit lock — single description used everywhere, no drift ───
const OUTFIT_DESCRIPTION =
  "navy-blue school uniform: long-sleeve fitted top with a crisp white peter-pan " +
  "collar, knee-length pleated navy skirt, white knee-high school socks, polished " +
  "dark-brown school shoes. A single thin RED SATIN RIBBON tied in a small bow " +
  "at the side of her hair (NOT a headband, NOT a hairband — specifically a thin " +
  "ribbon tied in a small visible bow)";

const OUTFIT_BY_PAGE: Record<number, string> = {
  0: `${OUTFIT_DESCRIPTION}. She wears a small beige leather school satchel slung diagonally across her body. The OUTFIT IS THE EXACT SAME on every page of this book.`,
  1: `${OUTFIT_DESCRIPTION} — but the red ribbon is NOT YET in her hair on this page; the ribbon is being held in her mother's hands mid-tie. Hanine's hair is currently loose and unbound, the mother is in the act of tying the ribbon for the first time. The OUTFIT IS THE EXACT SAME as on every other page in this book.`,
  8: `${OUTFIT_DESCRIPTION}. She has the SAME red ribbon tied at the side of her hair in a small bow as on the cover and final pages — NOT a headband, NOT a wide band, the SAME thin satin ribbon-bow throughout this entire book.`,
  16: `${OUTFIT_DESCRIPTION}. She still has the SAME red satin ribbon tied at the side of her hair in a small bow as on the cover — outfit and accessory unchanged from earlier in this book.`,
};

// ─── Supporting characters with Pixar movie references for age register ───
const SUPPORTING_BY_PAGE: Record<number, string> = {
  0: "",

  1:
    "MOTHER — A clearly ADULT EGYPTIAN WOMAN in her mid-30s, rendered in the " +
    "Pixar 3D adult-mom register (think Mirabel's mother Julieta in Encanto, " +
    "or Anna's mother Queen Iduna in Frozen — that mature warm Pixar-mom look). " +
    "She is VISIBLY MUCH TALLER than 5-year-old Hanine: an adult woman next to " +
    "a small child, the height difference is obvious. Her face is mature: a " +
    "longer oval face shape with defined adult cheekbones, fine smile lines at " +
    "the corners of her warm brown eyes, a softer fuller adult jawline (NOT a " +
    "child's round face). Her hair is long wavy chestnut-brown, loosely " +
    "gathered at the back with a few tendrils framing her face. Skin tone " +
    "slightly lighter than Hanine's. She wears a simple knee-length cream-" +
    "colored cotton housedress with small embroidered flowers at the neckline " +
    "and a thin lavender shawl resting on her shoulders. " +
    "She must read UNAMBIGUOUSLY as a 35-year-old MOTHER, NOT as a teenager, " +
    "NOT as a sister, NOT as a young aunt. Her face is fully MATURE, an adult " +
    "woman, with the gentle wisdom of motherhood in her expression. " +
    "Her hands are CURRENTLY mid-motion of tying the red satin ribbon into " +
    "Hanine's hair: the ribbon is visible in her fingers, looped around the " +
    "side of Hanine's hair, hands paused in the act of forming the bow. This " +
    "is a DYNAMIC mid-action moment, NOT a static cuddle. Both hands are " +
    "raised at Hanine's hair-level, fingers actively manipulating the ribbon. " +
    "Her face shows tender pride and focus — she is concentrating on the bow " +
    "while her eyes shine with motherly love. The ribbon is in her hands, " +
    "NOT in her own hair, NOT around her own neck.",

  8:
    "TEACHER — A clearly MIDDLE-AGED EGYPTIAN WOMAN in her mid-40s, rendered " +
    "in the Pixar 3D adult-teacher register (think the school teachers in " +
    "Inside Out / Turning Red — kind motherly-but-professional authority " +
    "figures, clearly older). " +
    "Her face is mature with visible smile lines at her eyes, a softer fuller " +
    "adult jawline, kind warm brown eyes. Her hair is dark with subtle grey " +
    "strands at her temples, pulled into a low neat bun. She wears a soft " +
    "olive-green long-sleeve cardigan over a high-necked cream blouse, a small " +
    "silver pin at the collar, a long modest skirt. She is visibly TALLER and " +
    "FULLER-FRAMED than Hanine — an adult standing next to a small child. " +
    "She must read UNAMBIGUOUSLY as a 45-year-old TEACHER, NOT as a teenager, " +
    "NOT as a young intern, NOT as an older sister. " +
    "Her body language: she stands slightly behind and to the side of Hanine, " +
    "one open hand gestured warmly toward the class as if presenting Hanine, " +
    "her other hand resting protectively at Hanine's shoulder-blade height. " +
    "Her face is beaming with an encouraging maternal smile. " +
    "" +
    "TWO NAMED CLASSMATES — face-forward, individually visible, distinct from " +
    "Hanine and from each other:" +
    "" +
    "  CLASSMATE 1 (front-row, left side of frame): a 6-year-old EGYPTIAN GIRL " +
    "with two long black BRAIDED pigtails (CLEARLY DIFFERENT hair from Hanine's " +
    "loose curly hair), small round wire-frame glasses, light skin with " +
    "freckles across her nose, a wide front-tooth-gap smile. She is seated at " +
    "her desk in the same school uniform, leaning slightly forward toward " +
    "Hanine and waving a small welcoming hand high in the air. " +
    "" +
    "  CLASSMATE 2 (front-row, right side of frame): a 6-year-old EGYPTIAN BOY " +
    "with short cropped tightly-coiled black hair (CLEARLY DIFFERENT from " +
    "Hanine), darker olive-brown skin (DIFFERENT from Hanine's lighter Egyptian " +
    "complexion), big rounded brown eyes, dimples on both cheeks, a small gap " +
    "between his front teeth. He is seated at his desk in the same school " +
    "uniform (boy version: trousers instead of skirt), giving a small enthusiastic " +
    "thumbs-up toward Hanine with a wide smile. " +
    "" +
    "  ADDITIONAL CLASSMATES (background, less detailed): 3 more children " +
    "visible in soft focus at desks behind the named two, varied hair textures " +
    "and skin tones, all looking toward Hanine with friendly attention. " +
    "" +
    "ALL OTHER CHARACTERS (teacher, classmate-1, classmate-2, background " +
    "classmates) have FACES THAT ARE COMPLETELY DIFFERENT FROM HANINE'S FACE. " +
    "They are NOT clones of Hanine. They are NOT siblings of Hanine. They are " +
    "DIFFERENT individual people each with their own face, hair, and skin. " +
    "The reference photos provided as image_urls are ONLY for Hanine — they " +
    "must NOT be applied to any other character.",

  16: "",
};

// ─── Per-page pose & emotional moment direction ───
const POSE_BY_PAGE: Record<number, string> = {
  0:
    "Hanine in mid-step walking confidently toward the school, slight three-quarter " +
    "dynamic stance (NOT a stiff frontal pose). Head tilted slightly with brave " +
    "anticipation, eyes bright and looking forward at the school gate, a small " +
    "courageous smile breaking on her lips. One hand grips the strap of her " +
    "satchel; the other swings naturally at her side. Her body language says: " +
    "'I'm a little nervous but I'm ready.' This is a heart-warming opening shot, " +
    "the kind of cover that makes a parent immediately feel: that's my child.",

  1:
    "Hanine sits on the edge of her bed with her hair loose, her face turned " +
    "slightly upward toward her mother who kneels close beside her. Hanine's " +
    "shoulders are gently relaxed, hands folded loosely in her lap, eyes " +
    "lifted in soft trusting affection toward her mother. A tiny half-smile " +
    "of contentment plays on Hanine's lips. " +
    "" +
    "The MOTHER kneels facing her daughter at the bed's edge, BOTH HER HANDS " +
    "RAISED at Hanine's hair-level, fingers ACTIVELY in motion of tying the " +
    "red satin ribbon — ribbon visible mid-loop, captured in the precise " +
    "moment of forming the bow. This is a dynamic action shot, the kind of " +
    "tender ritual moment Pixar films do so well (think Bambi's mother's " +
    "ear-grooming scene, or Coco's Mama Imelda's hands working). The mother's " +
    "expression is concentrated motherly love. " +
    "" +
    "The two are emotionally connected, rendered with the warmth of a real " +
    "mother-daughter morning ritual. Heart-warming, intimate, alive with " +
    "actual narrative motion (NOT a static pose).",

  8:
    "Hanine standing at the front of the classroom, small but composed, her " +
    "hands clasped lightly in front of her in a polite introductory posture. " +
    "Her face shows brave determination tempered with a touch of shyness — a " +
    "small soft smile, eyes bright and slightly wide, looking out at her new " +
    "classmates with cautious hope. Her shoulders are pulled back slightly " +
    "with summoned courage. " +
    "" +
    "The TEACHER stands warmly half-a-step behind Hanine, body angled toward " +
    "the class as if presenting her, one open hand gesture-extending toward " +
    "the classmates and the other resting protectively just behind Hanine's " +
    "shoulder, beaming with proud encouragement. " +
    "" +
    "CLASSMATE 1 (the bespectacled girl with braids and freckles) is leaning " +
    "forward at her desk, one hand raised high in welcome, her mouth open in " +
    "a delighted greeting. CLASSMATE 2 (the curly-haired boy with dimples) " +
    "is giving Hanine a small thumbs-up with a beaming smile. The OTHER " +
    "background classmates lean toward the action with curious, friendly " +
    "smiles. " +
    "" +
    "The composition captures the heart-warming MOMENT of being welcomed " +
    "into a new community — Hanine is brave, the teacher is supportive, the " +
    "classmates are warm. The body language across all characters shows " +
    "kindness and curiosity (NOT indifference, NOT cold neutrality).",

  16:
    "Hanine sits cross-legged on her bedroom floor on the round patterned " +
    "rug, having just come home at the end of her first school day. She " +
    "leans gently back on her hands behind her, head tilted upward toward " +
    "the open window with a soft warm CONTENTED smile (NOT worried, NOT " +
    "contemplative — this is the satisfied glow of a child who survived a " +
    "big day and is quietly proud). Her eyes are bright and slightly closed " +
    "with happiness, catching the warm light. The red ribbon is still tied " +
    "in her hair from the morning. Her schoolbag is dropped beside her, a " +
    "notebook half-spilled out. The plush teddy bear from her bed sits " +
    "nestled against her side, as if she dropped onto the floor and the " +
    "bear came too. " +
    "" +
    "The pose says: 'I did it today. Tomorrow I'll do it again. I am settled, " +
    "I am safe, I am proud.' Heart-warming closing image, the visual " +
    "punctuation mark on a brave first day.",
};

// ─── Per-page environmental scene props ───
const SCENE_PROPS_BY_PAGE: Record<number, string> = {
  0:
    "Sunny early-morning Egyptian school courtyard backdrop with a warm golden-" +
    "stone arched gateway visible behind her, a single tall date palm casting " +
    "soft dappled shadows on the courtyard pavement, a few other children " +
    "walking in pairs in soft focus in the distance, a tiny bird perched on " +
    "the arched gate, scattered fallen leaves, warm morning sunlight glowing " +
    "across the entire scene with gentle lens-bloom highlights.",

  1:
    "Cozy Egyptian girl's bedroom with rich storybook warmth: a single bed " +
    "against the back wall covered with a pink-and-cream patchwork quilt, two " +
    "soft pillows arranged neatly, a small plush teddy-bear sitting by the " +
    "headboard. A wooden dresser with a framed family photo (photo gently " +
    "blurred so you can tell it's family without seeing faces), a tiny perfume " +
    "bottle, a small pearl-decorated jewelry tray. A round patterned rug with " +
    "warm earthy reds and creams on the wooden floor. White lace curtains " +
    "glowing in warm golden morning light streaming through an open window. A " +
    "small bookshelf in the corner with picture books visible. Hanine's beige " +
    "school satchel waiting on a wooden chair near the doorway. A small " +
    "watercolor painting of a desert flower hung above the bed. The room " +
    "feels deeply lived-in and loved, the kind of bedroom every Egyptian " +
    "5-year-old would dream of having.",

  8:
    "Sunny Egyptian primary-school classroom interior: a large green chalkboard " +
    "at the front with Arabic alphabet letters lightly written in chalk, a " +
    "large Arabic alphabet poster (الألف الباء التاء) on the side wall, a " +
    "row of child-made paper crafts (paper flowers, paper birds) hung on a " +
    "string from one corner of the ceiling, two rows of small wooden desks " +
    "with tiny wooden chairs arranged neatly, schoolbags piled by the back " +
    "wall. Late-morning sunlight streaming through tall windows with sheer " +
    "curtains, fine chalk dust drifting visibly in the sunbeams. A small " +
    "potted plant on the teacher's desk. The classroom feels warm, alive, " +
    "welcoming — not sterile.",

  16:
    "Hanine's bedroom in DRAMATIC LATE-AFTERNOON GOLDEN-HOUR LIGHT — strong " +
    "warm orange-gold sunlight streaming low through the open bedroom window, " +
    "casting BRIGHT GLOWING WARM HONEY-COLORED PATCHES of light on Hanine's " +
    "face, on the round patterned rug where she sits, on the wooden floorboards. " +
    "Visible angled sun-rays cutting through the air with floating dust motes " +
    "lit gold by the sun. The light is the EMOTIONAL CENTER of the image — " +
    "warm, satisfied, the after-glow of a meaningful day. The room is the same " +
    "bedroom from the morning scene (recognizable continuity): the same bed " +
    "with pink-and-cream quilt, the same dresser, the same lace curtains now " +
    "lit golden from behind. A glass of milk and a small plate with two " +
    "cookies on a tray nearby (her mother brought them after school). The " +
    "plush teddy-bear from earlier nestles next to her on the floor. NOT a " +
    "dim or muted scene — DRAMATICALLY warm and golden, the kind of light " +
    "that makes a viewer feel: this child is home, safe, and proud.",
};

const SCENE_BY_PAGE: Record<number, string> = {
  0:
    "Hanine, the Egyptian girl from the reference photos, on her first day of " +
    "school — caught mid-step walking confidently toward the gates of a sunny " +
    "Cairo school courtyard, holding her beige school satchel. Iconic poster-" +
    "style opening image of a brave 5-year-old beginning a new chapter. " +
    "Heart-warming, hopeful, the kind of book cover that makes parents " +
    "instantly feel: that's my child.",

  1:
    "The morning of Hanine's first day of school. Her mother kneels beside " +
    "her in the warm cozy bedroom, hands actively in motion of tying a red " +
    "satin ribbon into Hanine's hair — a tender daily ritual captured at the " +
    "exact moment of the bow being formed. Hanine is dressed in her school " +
    "uniform, leaning slightly into her mother's warm focused care. The " +
    "schoolbag waits on the chair behind her. A heart-warming, dynamic " +
    "mother-daughter ritual moment.",

  8:
    "Hanine standing bravely at the front of her new sunny Cairo classroom, " +
    "introducing herself to the class. Her teacher stands warmly beside her " +
    "with a presenting gesture. Her classmates — Egyptian children ages 5–7 " +
    "in similar uniforms with DISTINCT individual faces and features — sit " +
    "at their desks and welcome her with warm gestures (one girl waving high, " +
    "one boy giving a thumbs-up). The heart-warming moment of being welcomed " +
    "into a new community.",

  16:
    "Hanine at home at the end of her first school day, sitting cross-legged " +
    "on her bedroom floor in dramatic warm late-afternoon golden-hour light. " +
    "She is reflecting on the day with a soft contented satisfied smile, " +
    "schoolbag dropped beside her, plush teddy-bear next to her, the same " +
    "school uniform and red ribbon from earlier still in place. The mood is " +
    "warm, settled, the heart-warming after-glow of a brave first day.",
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
    "Pixar 3D animated style children's book illustration, in the visual " +
    "register of Disney Encanto / Coco / Inside Out / Turning Red — stylized " +
    "3D rendering with painterly textures, soft volumetric lighting, expressive " +
    "3D-rendered facial features, smooth subsurface scattering on warm skin, " +
    "warm cinematic color grading, the kind of image you'd find on a published " +
    "premium Pixar children's book.";

  const sceneBlock =
    args.pageNumber === 0
      ? `BOOK COVER ILLUSTRATION: ${scene}`
      : `STORYBOOK PAGE ${args.pageNumber} ILLUSTRATION (this specific moment only, " +
"unique composition different from any other page): ${scene}`;

  const characterBlock =
    `MAIN CHARACTER (Hanine): a 5-year-old EGYPTIAN GIRL. ` +
    `Hair: ${args.childAppearance.hair ?? "curly dark-brown medium-length, naturally textured, slightly tousled"}. ` +
    `Skin: ${args.childAppearance.skin ?? "warm Egyptian olive complexion"}. ` +
    `Eyes: ${args.childAppearance.eyes ?? "large warm dark-brown almond-shaped"}. ` +
    `Face shape: round, soft cheeks, sweet open smile, the SAME girl from the reference photos provided as image_urls. ` +
    `Outfit: ${outfit}. ` +
    `IDENTITY: Hanine's face must EXACTLY match the reference photos provided as image_urls — same face shape, same eye shape and color, same hair color and texture, same smile. The reference photos show her in CASUAL clothes (lime green shirt, teal dress, blue hoodie); for THIS book she is in school uniform but her face, hair, and skin must EXACTLY match the casual photo references. The reference photos are ONLY for Hanine's identity — they must NOT be applied to any other character in the scene.`;

  const supportingBlock = supporting ? `OTHER CHARACTERS IN SCENE: ${supporting}` : "";

  const poseBlock = pose ? `KEY POSE & EMOTIONAL MOMENT: ${pose}` : "";

  const propsBlock = props ? `SETTING & ENVIRONMENTAL DETAILS: ${props}` : "";

  const culturalBlock =
    args.culturalNotes.length > 0
      ? `Egyptian cultural anchors (render exactly as described): ${args.culturalNotes.join("; ")}.`
      : "";

  const focusBlock =
    "COMPOSITION FOCUS: ~60% of visual attention on the main character" +
    (supporting ? " and her interaction with the other character(s) in the scene" : "") +
    "; ~40% on setting, props, and warm atmospheric details. The image must feel HEART-WARMING and emotionally rich, with a clear single focal moment. The kind of children's book illustration that makes a parent pause and feel something. NOT a static portrait — a captured moment of life.";

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

  const negative =
    "watercolor, photorealistic, real photo, AI-edited photograph, " +
    "2D-flat illustration, vector art, line drawing, sketch, anime, manga, " +
    "sharp digital lines, low-poly 3D, " +
    "supporting characters with the same face as the main child, " +
    "duplicate child faces, multiple children all looking like the main child, " +
    "mother looking like a teenager, mother looking like a sister, mother looking like a young girl, " +
    "teacher looking like a teenager, teacher looking like a young intern, " +
    "characters all the same age, " +
    "headband, wide hairband, alice band, hair band (the accessory must be a thin satin ribbon tied in a bow, never a band), " +
    "static stiff frontal pose, lifeless body language, cold sterile scene, empty bare room, " +
    "completely black image, dark unrenderable image, washed-out empty space, " +
    "ribbon on the wrong character, ribbon worn by mother, ribbon worn by teacher";

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
  console.log(`\nCreating new generation row ${newGenId} (iteration 4 — final)...`);
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
  console.log("\n→ Generating Pixar cover (iteration 4)...");
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
    console.log(`\n→ Generating Pixar page ${pageNum} (iteration 4)...`);
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

  console.log("\n✅ Phase 1 iteration 4 (final) complete.");
  console.log(`   New generation ID: ${newGenId}`);
  console.log(`   Admin queue link: https://hadouta-admin.vercel.app/orders/${newGenId}`);
  console.log(`   PDF (direct):     ${pdfResult.pdfUrl}`);
}

main()
  .catch((err) => {
    console.error("❌ Phase 1 iteration 4 failed:", err);
    process.exit(1);
  })
  .then(() => process.exit(0));
