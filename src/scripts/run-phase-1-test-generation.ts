// hadouta-backend/src/scripts/run-phase-1-test-generation.ts
//
// Phase 1 quick-cycle test (2026-05-05) — regenerate 3 pages of an existing
// order using the new flux-kontext-pixar provider. Reuses the persisted Bible
// + customer photos. Output URLs are logged for side-by-side comparison.
//
// Per docs/superpowers/specs/2026-05-05-phase-1-pixar-kontext-quick-cycle-design.md
// License posture: BFL Flux.1 [dev] §1(c)(ii) research/evaluation carve-out.
// Outputs are NOT delivered to end users — they land on Cloudinary as test
// artifacts and are inspected manually for founder side-by-side comparison.
//
// Run: pnpm tsx src/scripts/run-phase-1-test-generation.ts

import "dotenv/config";
import { and, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { generations, photos as photosTable } from "../db/schema.js";
import {
  generateBodyIllustration,
  generateCoverIllustration,
} from "../lib/ai/illustration-generator.js";
import { buildIllustrationPrompt } from "../lib/ai/prompts/build-illustration-prompt.js";
import type { Bible } from "../lib/ai/schemas/bible.js";

const TARGET_GENERATION_ID = "fad8f418-6464-43df-9ce2-06488b58c8a5";

// Body page selections — array indices into story.pages, picked by controller
// for face-prominent + scene-class diversity:
//   idx 7  → body page 8  ("introducing herself to the class")
//   idx 15 → body page 16 ("waking up in the morning, sunlight through window")
const BODY_PAGE_INDICES = [7, 15] as const;

async function main(): Promise<void> {
  const gen = await db
    .select()
    .from(generations)
    .where(eq(generations.id, TARGET_GENERATION_ID))
    .limit(1)
    .then((r) => r[0]);
  if (!gen) {
    throw new Error(`Generation ${TARGET_GENERATION_ID} not found.`);
  }
  if (!gen.bibleJson) {
    throw new Error("Generation has no bibleJson — cannot rerun.");
  }
  if (!gen.storyJson) {
    throw new Error("Generation has no storyJson — cannot rerun.");
  }

  const bible = gen.bibleJson as Bible;
  const story = gen.storyJson as {
    title?: string;
    coverScene?: string;
    pages?: Array<{ scene: string; text: string }>;
  };
  const orderId = gen.orderId;
  const pages = story.pages ?? [];

  // Load main-child photo URLs for this order (multi-angle references for
  // flux-kontext-pixar). Mirrors loadMainChildPhotoUrls() in generate-book.ts:
  // filter by ownerType = 'main_child' and read photos.url.
  const photoRows = await db
    .select({ url: photosTable.url })
    .from(photosTable)
    .where(
      and(
        eq(photosTable.orderId, orderId),
        eq(photosTable.ownerType, "main_child"),
      ),
    );
  const photoUrls = photoRows
    .map((r) => r.url)
    .filter((u): u is string => typeof u === "string" && u.length > 0);
  if (photoUrls.length === 0) {
    throw new Error(
      `Order ${orderId} has no main_child customer photo URLs in photos table.`,
    );
  }
  console.log(
    `Loaded ${photoUrls.length} customer photo(s) for order ${orderId}.`,
  );

  // ─── Cover ───
  const coverScene =
    story.coverScene ??
    pages[0]?.scene ??
    "Egyptian child opening a magical book.";
  const coverPrompt = buildIllustrationPrompt({
    bible,
    scene: coverScene,
    pageNumber: 0,
  });
  console.log("\n→ Generating Phase 1 cover with flux-kontext-pixar...");
  const coverResult = await generateCoverIllustration({
    orderId,
    positivePrompt: coverPrompt.positive,
    negativePrompt: coverPrompt.negative,
    customerPhotoUrls: photoUrls,
    provider: "flux-kontext-pixar",
  });
  console.log("   Cover URL:", coverResult.url);
  console.log("   Took:", coverResult.durationMs, "ms");

  // ─── Body pages ───
  for (const idx of BODY_PAGE_INDICES) {
    const page = pages[idx];
    if (!page) {
      console.log(
        `\n⚠️ Page index ${idx} not in storyJson.pages — skipping.`,
      );
      continue;
    }
    const pageNumber = idx + 1; // 1-indexed body page
    const pagePrompt = buildIllustrationPrompt({
      bible,
      scene: page.scene,
      pageNumber,
    });
    console.log(
      `\n→ Generating Phase 1 page ${pageNumber} (idx ${idx}) with flux-kontext-pixar...`,
    );
    console.log(`   Scene: ${page.scene.slice(0, 80)}...`);
    const pageResult = await generateBodyIllustration({
      orderId,
      pageNumber,
      positivePrompt: pagePrompt.positive,
      negativePrompt: pagePrompt.negative,
      coverImageUrl: coverResult.url,
      customerPhotoUrls: photoUrls,
      provider: "flux-kontext-pixar",
    });
    console.log("   Page URL:", pageResult.url);
    console.log("   Took:", pageResult.durationMs, "ms");
  }

  console.log("\n✅ Phase 1 test generation complete.");
  console.log(
    "   Compare these URLs side-by-side with the existing pages in the admin queue:",
  );
  console.log(
    `   https://hadouta-admin.vercel.app/orders/${TARGET_GENERATION_ID}`,
  );
}

main()
  .catch((err) => {
    console.error("❌ Phase 1 generation failed:", err);
    process.exit(1);
  })
  .then(() => process.exit(0));
