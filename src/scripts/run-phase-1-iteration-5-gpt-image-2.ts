// hadouta-backend/src/scripts/run-phase-1-iteration-5-gpt-image-2.ts
//
// Phase 1 iteration 5 (2026-05-06) — final empirical test: same Hanine, same
// Pixar 3D direction, same 4 pages, but using OpenAI's gpt-image-2 (released
// 2026-04-21) instead of fal.ai's Flux Kontext.
//
// Why this iteration: founder wants to verify whether gpt-image-2's native
// reasoning ("thinking before generating") fixes the instruction-following
// bugs that Flux Kontext + prompt-only resisted across iterations 2-4:
//   - Mother on P1 keeps rendering as a teenager despite age cues
//   - Ribbon-tying ACTION moment never depicts (model picks static cuddle pose)
//   - Teacher on P8 keeps rendering as ~25-year-old despite "45-year-old"
//   - Accessory drifts (ribbon vs headband)
//
// gpt-image-2 has agentic reasoning before render. THEORY: it should plan the
// scene structure (mother adult, ribbon mid-tie, teacher mature, ribbon-not-
// headband) before pixel synthesis, fixing these failures.
//
// COST ESTIMATE: ~$1.00 for the 4-page test (cover at "high" quality + 3 body
// at "medium"). Per-page cost 5-10× more than Flux Kontext, so this is a
// one-shot verification, not a production candidate.
//
// QUALITY UNCERTAINTY: gpt-image-2 launched 2 weeks ago — no published head-
// to-head vs Flux Kontext exists for our use case (photo→Pixar illustration
// with multi-photo identity preservation). This run produces the data.
//
// LICENSE POSTURE: Pure OpenAI API call, no LoRAs, no Flux derivatives. Output
// IP belongs to OpenAI per their terms; commercial use is permitted under
// OpenAI's standard API terms. No special licensing carve-out needed for this
// path (unlike Flux [dev] §1(c)(ii)).
//
// Run: pnpm tsx src/scripts/run-phase-1-iteration-5-gpt-image-2.ts

import "dotenv/config";
import { randomUUID } from "node:crypto";
import { mkdtempSync, createReadStream, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import OpenAI, { toFile } from "openai";
import { db } from "../db/index.js";
import {
  generations,
  bookPages,
  photos as photosTable,
} from "../db/schema.js";
import { eq, and } from "drizzle-orm";
import { uploadImage } from "../lib/cloudinary.js";
import { assembleBookPdf } from "../lib/pdf/render-book.js";

const SOURCE_GENERATION_ID = "fad8f418-6464-43df-9ce2-06488b58c8a5";
const SELECTED_BODY_PAGES = [1, 8, 16] as const;
const MODEL = "gpt-image-2";
const SIZE: "1024x1536" = "1024x1536"; // 3:4 portrait — matches PDF aspect

// ─── Cover prompt: less prescriptive, more evocative — trust gpt-image-2's
// reasoning to plan a "stunning, breathtaking" composition. Founder explicitly
// asked for creative latitude on the cover specifically.
const COVER_PROMPT = `Create a STUNNING, BREATHTAKING children's book cover illustration in PIXAR 3D animated style — the visual register of Disney Encanto, Coco, and Inside Out. Stylized 3D rendering, soft volumetric lighting, expressive 3D-rendered facial features, smooth subsurface scattering on warm skin, warm cinematic color grading, painterly textures.

The story is "حَنِين وأول يوم في المدرسة" (Hanine and her first day of school) — a 5-year-old Egyptian girl on the morning of her first school day. The cover should make a parent gasp the moment they see it.

THE HERO: a 5-year-old EGYPTIAN GIRL whose face must EXACTLY match the reference photos provided. Her face is round with soft cheeks. Curly dark-brown shoulder-length hair, naturally textured. Warm Egyptian olive complexion. Large warm dark-brown almond-shaped eyes. Sweet open smile. The reference photos show her in casual clothes (lime green shirt, teal dress, blue hoodie); for this book cover she wears her navy-blue school uniform with a crisp white peter-pan collar, knee-length pleated navy skirt, white knee-high school socks, polished dark-brown school shoes, a small beige leather school satchel slung diagonally across her body, and a single thin RED SATIN RIBBON tied in a small bow at the side of her hair (not a headband, not a wide band — a thin satin ribbon-bow).

CREATIVE BRIEF: design a magical, cinematic, heart-warming opening illustration that captures her bravery on the threshold of a new chapter. Iconic poster-style. Use composition, light, color, and atmosphere creatively to evoke wonder, anticipation, and quiet courage. The setting should feel authentically Egyptian (warm-stone arched gateways, sandy palette, golden Cairo light, possibly a date palm or two), but YOU choose the framing — wide hero shot of her stepping toward the school, or low-angle reverence as she looks up at the schoolyard, or a magical golden-hour moment with sun-rays and floating dust motes. Surprise the viewer with creativity. Make it the kind of cover that makes a parent stop in a bookstore.

Heart-warming, hopeful, the kind of book cover where parents instantly feel "that's my child." NOT photorealistic, NOT watercolor, NOT 2D-flat — purely Pixar 3D animated.`;

// ─── Body page prompts (same shape as iteration 4, since gpt-image-2 should
// handle the detailed instruction-following BETTER than Flux Kontext did) ───

const PAGE_1_PROMPT = `Pixar 3D animated style children's book illustration — the visual register of Disney Encanto / Coco / Inside Out. Stylized 3D rendering, soft volumetric lighting, expressive faces, warm cinematic color grading.

STORYBOOK PAGE 1: The morning of Hanine's first day of school. Her mother kneels beside her in the warm cozy bedroom, hands ACTIVELY MID-MOTION of tying a red satin ribbon into Hanine's hair — a tender daily ritual captured at the exact moment of the bow being formed. Heart-warming dynamic action moment, NOT a static cuddle.

MAIN CHARACTER (Hanine): a 5-year-old EGYPTIAN GIRL whose face must EXACTLY match the reference photos. Round face, soft cheeks, curly dark-brown medium-length hair, warm Egyptian olive skin, large dark-brown almond eyes, sweet smile. Her hair is currently LOOSE and UNBOUND on this page (the ribbon is being tied for the first time, not yet in her hair). Wearing: navy-blue school uniform with crisp white peter-pan collar, knee-length pleated navy skirt, white knee-high school socks. Her small beige school satchel waits on a wooden chair near the doorway. Reference photos show her in casual clothes (lime green / teal / blue hoodie); for this scene she is in school uniform, but face/hair/skin must match references EXACTLY. The photos are ONLY for Hanine's identity, NOT for any other character.

OTHER CHARACTER — MOTHER: a clearly ADULT EGYPTIAN WOMAN in her mid-30s, rendered in the Pixar 3D adult-mom register (think Mirabel's mother Julieta in Encanto, or Anna's mother Queen Iduna in Frozen). VISIBLY MUCH TALLER than 5-year-old Hanine — an obvious adult woman next to a small child, the height difference clear. Her face is mature: longer oval shape, defined adult cheekbones, fine smile lines at her warm brown eyes, softer fuller adult jawline, NOT a child's round face. Long wavy chestnut-brown hair loosely gathered at the back with a few tendrils framing her face. Skin tone slightly lighter than Hanine's. She wears a simple knee-length cream-colored cotton housedress with small embroidered flowers at the neckline and a thin lavender shawl on her shoulders. Her face shows tender pride and motherly focus — concentrating on the bow while her eyes shine with love. She must read UNAMBIGUOUSLY as a 35-year-old MOTHER, NOT a teenager, NOT a sister, NOT a young aunt.

KEY ACTION: BOTH her hands are RAISED at Hanine's hair-level, fingers ACTIVELY in motion of forming the ribbon-bow. The red satin ribbon is visible mid-loop in her fingers, captured in the precise moment of being tied. The ribbon is in HER hands and being placed in HANINE's hair — NOT in the mother's own hair. This is a dynamic narrative moment.

SETTING: cozy Egyptian girl's bedroom with rich storybook warmth — single bed against the back wall with a pink-and-cream patchwork quilt and a small plush teddy-bear by the headboard, wooden dresser with a framed family photo (gently blurred faces), a tiny perfume bottle, a small jewelry tray, round patterned rug with warm earthy reds and creams on the wooden floor, white lace curtains glowing in warm golden morning light, small bookshelf with picture books, a small watercolor painting of a desert flower above the bed.

NEGATIVE: NO headband (it's a thin satin ribbon-bow, NOT a band), NO mother who looks like a teenager or sister, NO ribbon worn by the mother, NO static stiff cuddle pose, NO empty cold scene, NO photorealistic / watercolor / 2D-flat — purely Pixar 3D.`;

const PAGE_8_PROMPT = `Pixar 3D animated style children's book illustration — the visual register of Disney Encanto / Coco / Inside Out / Turning Red. Stylized 3D rendering, expressive faces, warm cinematic color grading.

STORYBOOK PAGE 8: Hanine standing bravely at the front of her sunny Cairo classroom, introducing herself to her new classmates. The heart-warming moment of being welcomed into a new community.

MAIN CHARACTER (Hanine): a 5-year-old EGYPTIAN GIRL whose face must EXACTLY match the reference photos. Round face, soft cheeks, curly dark-brown medium-length hair, warm Egyptian olive skin, large dark-brown almond eyes. Wearing the SAME outfit as on every other page of this book: navy-blue school uniform with crisp white peter-pan collar, knee-length pleated navy skirt, white knee-high school socks, dark-brown shoes. The SAME thin red satin ribbon tied in a small bow at the side of her hair as on the cover (NOT a headband, NOT a wide band — the SAME thin ribbon-bow throughout the book). Reference photos are ONLY for Hanine's identity, NOT for any other character.

POSE: standing at the front of the classroom, small but composed, hands clasped lightly in front of her in a polite introductory posture. Brave determination tempered with shyness — small soft smile, eyes bright and slightly wide, looking out at her new classmates with cautious hope.

OTHER CHARACTER — TEACHER: a clearly MIDDLE-AGED EGYPTIAN WOMAN in her mid-40s, rendered in the Pixar 3D adult-teacher register (kind motherly-but-professional authority figure, think the school teachers in Inside Out). Her face is mature with visible smile lines, fuller adult jawline, kind warm brown eyes. Dark hair with subtle grey strands at her temples, pulled into a low neat bun. Wearing a soft olive-green long-sleeve cardigan over a high-necked cream blouse, a small silver pin at the collar, a long modest skirt. Visibly TALLER and FULLER-FRAMED than Hanine — adult next to a small child. She must read UNAMBIGUOUSLY as a 45-year-old TEACHER, NOT as a teenager, NOT as a young intern. She stands warmly half-a-step behind Hanine, body angled toward the class as if presenting Hanine, one open hand gesturing toward the classmates and the other resting protectively just behind Hanine's shoulder, beaming with proud encouragement.

OTHER CHARACTERS — TWO NAMED CLASSMATES (face-forward, individual, distinct from Hanine and from each other):
- CLASSMATE 1 (front-row left): a 6-year-old Egyptian girl with two long black BRAIDED pigtails (clearly different hair from Hanine's loose curls), small round wire-frame glasses, light skin with freckles across her nose, wide front-tooth-gap smile, leaning forward at her desk and waving a small welcoming hand high in the air.
- CLASSMATE 2 (front-row right): a 6-year-old Egyptian boy with short cropped tightly-coiled black hair (clearly different from Hanine), darker olive-brown skin (different from Hanine's lighter complexion), big rounded brown eyes, dimples on both cheeks, giving Hanine a small enthusiastic thumbs-up with a wide smile.
- 3 BACKGROUND CLASSMATES at desks behind them in soft focus, varied hair textures and skin tones, all looking toward Hanine with friendly attention.

ALL OTHER CHARACTERS (teacher, classmate 1, classmate 2, background classmates) have FACES COMPLETELY DIFFERENT FROM HANINE'S — NOT clones, NOT siblings, NOT versions of Hanine. Each is a distinct individual.

SETTING: sunny Egyptian primary-school classroom — large green chalkboard with light Arabic letters in chalk, an Arabic alphabet poster (الألف الباء التاء) on the side wall, paper crafts hung on string from a corner of the ceiling, two rows of small wooden desks, schoolbags piled by the back wall, late-morning sunlight streaming through tall windows with sheer curtains, fine chalk dust drifting in the sunbeams, a small potted plant on the teacher's desk. Warm, alive, welcoming.

NEGATIVE: NO teacher who looks like a teenager, NO classmates that all look like Hanine, NO headband on Hanine, NO static cold composition, NO photorealistic / watercolor / 2D-flat — purely Pixar 3D.`;

const PAGE_16_PROMPT = `Pixar 3D animated style children's book illustration — the visual register of Disney Encanto / Coco / Inside Out. Stylized 3D rendering, expressive faces, warm cinematic color grading.

STORYBOOK PAGE 16: Hanine at home at the end of her first school day, sitting cross-legged on her bedroom floor in DRAMATIC LATE-AFTERNOON GOLDEN-HOUR LIGHT. She is reflecting on the day with a soft contented satisfied smile — schoolbag dropped beside her, plush teddy-bear next to her, the same school uniform and red ribbon from earlier still in place. The mood is warm, settled, the heart-warming after-glow of a brave first day.

MAIN CHARACTER (Hanine): a 5-year-old EGYPTIAN GIRL whose face must EXACTLY match the reference photos. Same face shape, hair, skin, eyes as the references. Wearing the SAME outfit as on every other page of this book: navy-blue school uniform with crisp white peter-pan collar, knee-length pleated navy skirt, white knee-high school socks, dark-brown shoes. The SAME thin red satin ribbon tied in a small bow at the side of her hair as on the cover and earlier pages (NOT a headband — the SAME thin ribbon-bow throughout the book, accessory unchanged). Reference photos show her in casual clothes; for this scene she is in school uniform, but face/hair/skin must match references EXACTLY.

POSE: sits cross-legged on the round patterned rug, leans gently back on her hands behind her, head tilted upward toward the open window with a soft warm CONTENTED smile (NOT worried, NOT contemplative — this is the satisfied glow of a child who survived a big day and is quietly proud). Eyes bright and slightly closed with happiness, catching the warm light. The pose says: "I did it today. Tomorrow I'll do it again. I am settled, I am safe, I am proud."

ATMOSPHERE — CRITICAL: DRAMATIC LATE-AFTERNOON GOLDEN-HOUR LIGHT — strong warm orange-gold sunlight streaming low through the open bedroom window, casting BRIGHT GLOWING WARM HONEY-COLORED PATCHES of light on Hanine's face, on the round patterned rug where she sits, on the wooden floorboards. Visible angled sun-rays cutting through the air with floating dust motes lit gold by the sun. The light is the EMOTIONAL CENTER of the image — warm, satisfied, the after-glow of a meaningful day. NOT a dim or muted scene — DRAMATICALLY warm and golden, the kind of light that makes a viewer feel "this child is home, safe, and proud."

SETTING: same bedroom from page 1 (recognizable continuity) — same bed with pink-and-cream quilt, same wooden dresser, same lace curtains now lit golden from behind. A glass of milk and a small plate with two cookies on a tray nearby (her mother brought them after school). The plush teddy-bear from earlier nestles next to her on the floor. Schoolbag dropped beside her, half-open with a notebook peeking out.

NEGATIVE: NO dim or muted scene (must be DRAMATIC golden-hour glow), NO worried/contemplative expression (must be content/satisfied), NO outfit change, NO accessory drift (still the thin red ribbon-bow, NOT a headband), NO photorealistic / watercolor / 2D-flat — purely Pixar 3D.`;

const PROMPT_BY_PAGE: Record<number, string> = {
  0: COVER_PROMPT,
  1: PAGE_1_PROMPT,
  8: PAGE_8_PROMPT,
  16: PAGE_16_PROMPT,
};

const QUALITY_BY_PAGE: Record<number, "high" | "medium"> = {
  0: "high", // stunning cover
  1: "medium",
  8: "medium",
  16: "medium",
};

async function downloadPhotoToFile(url: string, dir: string, idx: number): Promise<string> {
  // Node's undici fetch has been timing out (IPv6/IPv4 fallback issue) on
  // Cloudinary URLs from this machine, even when curl works fine. Shell out
  // to curl as a workaround — it consistently succeeds.
  const ext = url.toLowerCase().endsWith(".png") ? "png" : "jpg";
  const path = join(dir, `photo-${idx}.${ext}`);
  const { execFileSync } = await import("node:child_process");
  execFileSync("curl", ["-sL", "--fail", "-o", path, url], {
    timeout: 30_000,
    stdio: ["ignore", "ignore", "pipe"],
  });
  return path;
}

async function callGptImage2(args: {
  client: OpenAI;
  prompt: string;
  quality: "high" | "medium";
  photoPaths: string[];
}): Promise<{ buffer: Buffer; contentType: string }> {
  // Convert local files to OpenAI File objects per documented Node.js usage.
  const images = await Promise.all(
    args.photoPaths.map(async (p) => {
      const stream = createReadStream(p);
      const type = p.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
      return toFile(stream, null, { type });
    }),
  );

  const response = await args.client.images.edit({
    model: MODEL,
    image: images,
    prompt: args.prompt,
    size: SIZE,
    quality: args.quality,
    n: 1,
  });

  // gpt-image-2 returns base64-encoded PNG (b64_json), not a URL.
  const data = response.data;
  if (!data || data.length === 0) throw new Error("gpt-image-2 returned no image data.");
  const b64 = data[0]?.b64_json;
  if (!b64) {
    throw new Error(
      `gpt-image-2 returned no b64_json. Response: ${JSON.stringify(data[0]).slice(0, 500)}`,
    );
  }
  const buffer = Buffer.from(b64, "base64");
  return { buffer, contentType: "image/png" };
}

async function main(): Promise<void> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY not set in .env");
  }
  const client = new OpenAI();

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
  const story = sourceGen.storyJson as {
    pages?: Array<{ number?: number; text?: string }>;
  };

  // ─── Load + download customer photos ───
  const photoRows = await db
    .select()
    .from(photosTable)
    .where(and(eq(photosTable.orderId, orderId), eq(photosTable.ownerType, "main_child")));
  const photoUrls = photoRows
    .map((p) => (p as { url?: string }).url)
    .filter((u): u is string => typeof u === "string" && u.length > 0);
  if (photoUrls.length === 0) throw new Error("No main_child photos for order.");

  const tmpDir = mkdtempSync(join(tmpdir(), "hadouta-iter5-"));
  console.log(`Downloading ${photoUrls.length} reference photos to ${tmpDir}...`);
  const photoPaths = await Promise.all(
    photoUrls.map((url, i) => downloadPhotoToFile(url, tmpDir, i)),
  );

  // ─── Create new generation row ───
  const newGenId = randomUUID();
  console.log(`\nCreating new generation row ${newGenId} (iteration 5 — gpt-image-2)...`);
  await db.insert(generations).values({
    id: newGenId,
    orderId,
    status: "generating_illustrations",
    storyJson: sourceGen.storyJson,
    bibleJson: sourceGen.bibleJson,
    illustrationsCount: 4,
    estimatedCostCents: 100, // ~$1.00 estimate
    startedAt: new Date(),
  });

  // ─── Cover ───
  console.log("\n→ Generating Pixar cover with gpt-image-2 (quality=high)...");
  const coverStart = Date.now();
  const coverResult = await callGptImage2({
    client,
    prompt: PROMPT_BY_PAGE[0]!,
    quality: QUALITY_BY_PAGE[0]!,
    photoPaths,
  });
  const coverUploaded = await uploadImage(
    coverResult.buffer,
    orderId,
    "illustration_cover",
    coverResult.contentType,
  );
  console.log("   Cover URL:", coverUploaded.url);
  console.log(`   Took ${((Date.now() - coverStart) / 1000).toFixed(1)}s`);

  await db
    .update(generations)
    .set({ coverUrl: coverUploaded.url, updatedAt: new Date() })
    .where(eq(generations.id, newGenId));

  // ─── Body pages ───
  for (const pageNum of SELECTED_BODY_PAGES) {
    const storyPage = story.pages?.find((p) => p.number === pageNum);
    if (!storyPage) {
      console.log(`⚠️ Story page ${pageNum} not found — skipping.`);
      continue;
    }
    const prompt = PROMPT_BY_PAGE[pageNum];
    const quality = QUALITY_BY_PAGE[pageNum];
    if (!prompt || !quality) {
      console.log(`⚠️ No prompt/quality for page ${pageNum} — skipping.`);
      continue;
    }
    console.log(`\n→ Generating Pixar page ${pageNum} with gpt-image-2 (quality=${quality})...`);
    const pageStart = Date.now();
    const pageResult = await callGptImage2({
      client,
      prompt,
      quality,
      photoPaths,
    });
    const pageUploaded = await uploadImage(
      pageResult.buffer,
      orderId,
      `illustration_page_${pageNum}`,
      pageResult.contentType,
    );
    console.log("   Page URL:", pageUploaded.url);
    console.log(`   Took ${((Date.now() - pageStart) / 1000).toFixed(1)}s`);

    await db.insert(bookPages).values({
      generationId: newGenId,
      pageNumber: pageNum,
      storyText: storyPage.text ?? "",
      illustrationUrl: pageUploaded.url,
      illustrationPrompt: prompt.slice(0, 2000),
      illustrationProvider: "gpt-image-2",
      illustrationGeneratedAt: new Date(),
    });
  }

  // ─── PDF ───
  console.log("\n→ Assembling PDF...");
  const pdfResult = await assembleBookPdf({ generationId: newGenId });
  console.log(`   PDF URL: ${pdfResult.pdfUrl}`);
  console.log(`   PDF size: ${(pdfResult.bytes / 1024).toFixed(1)} KB`);

  // ─── Patch back to awaiting_review ───
  await db
    .update(generations)
    .set({ status: "awaiting_review", deliveredAt: null, updatedAt: new Date() })
    .where(eq(generations.id, newGenId));

  console.log("\n✅ Phase 1 iteration 5 (gpt-image-2) complete.");
  console.log(`   New generation ID: ${newGenId}`);
  console.log(`   Admin queue link: https://hadouta-admin.vercel.app/orders/${newGenId}`);
  console.log(`   PDF (direct):     ${pdfResult.pdfUrl}`);
}

main()
  .catch((err) => {
    console.error("❌ Phase 1 iteration 5 failed:", err);
    process.exit(1);
  })
  .then(() => process.exit(0));
