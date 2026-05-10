// Watercolor revert trial: regenerate Hana's Bible with the new watercolor
// styleBible defaults (per AI Engineer audit 2026-05-08), then render cover
// + first 3 body pages on Nano Banana 2 (back to the locked production
// model — no more Qwen experimentation). Apples-to-apples comparison vs
// the trash Pixar Hana run.
//
// Cost: ~$0.02 (Bible regen) + 4 × $0.08 (Nano Banana) = ~$0.34
//
// Run: pnpm tsx src/scripts/_watercolor-trial-hana.ts

import "dotenv/config";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  generations,
  bookPages,
  photos as photosTable,
} from "../db/schema.js";
import { generateBible } from "../lib/ai/bible-generator.js";
import { buildIllustrationPrompt } from "../lib/ai/prompts/build-illustration-prompt.js";
import {
  generateCoverIllustration,
  generateBodyIllustration,
} from "../lib/ai/illustration-generator.js";
import type { StoryOutput } from "../lib/ai/schemas/story.js";

const SOURCE_GEN_ID = "dfb7d9d5-7ff7-4a24-83ce-bd645251d17e"; // The trash Hana run (has story we reuse)
const ORDER_ID = "76e6226a-452e-47d6-9209-b53717d6d1cd";
const PAGES_TO_RENDER = [1, 2, 3] as const;

async function main(): Promise<void> {
  console.log(`Watercolor revert trial — Hana cover + pages 1-3 on Nano Banana 2\n`);

  // ─── Load source story (reuse, don't regen) ───
  const sourceGen = await db
    .select()
    .from(generations)
    .where(eq(generations.id, SOURCE_GEN_ID))
    .limit(1)
    .then((r) => r[0]);
  if (!sourceGen?.storyJson) throw new Error("Source generation missing story");
  const story = sourceGen.storyJson as StoryOutput;
  console.log(`✓ Source story: "${story.title}"`);

  // ─── Load customer photos ───
  const photoRows = await db
    .select({ url: photosTable.url })
    .from(photosTable)
    .where(eq(photosTable.orderId, ORDER_ID));
  const photoUrls = photoRows
    .map((r) => r.url)
    .filter((u): u is string => typeof u === "string" && u.length > 0);
  if (photoUrls.length === 0) throw new Error("No customer photos");
  console.log(`✓ ${photoUrls.length} customer photo(s)`);

  // ─── Generate NEW Bible with watercolor styleBible defaults ───
  console.log(`\n→ Generating NEW watercolor Bible (gpt-4o + vision)...`);
  const bible = await generateBible({
    story,
    wizardData: {
      childName: "هَنَا",
      childAgeBand: "5-7",
      childAgeExact: 5,
      childGender: "girl",
      theme: "الصداقة",
      moralValue: "التعاون",
      photoUrl: photoUrls[0]!,
      personaId: null,
    },
  });
  console.log(`  ✓ styleBible.medium: ${bible.styleBible.medium.slice(0, 130)}...`);
  console.log(`  ✓ styleBible.negativeStyle: ${bible.styleBible.negativeStyle.slice(0, 110)}...`);
  console.log(`  ✓ supportingCharacters: ${bible.characterBible.supportingCharacters.length}`);
  for (const sc of bible.characterBible.supportingCharacters) {
    console.log(`    - ${sc.name} (${sc.relationship})`);
  }

  // ─── Persist new generation row ───
  const newGenId = randomUUID();
  console.log(`\n→ Creating watercolor trial generation ${newGenId}...`);
  await db.insert(generations).values({
    id: newGenId,
    orderId: ORDER_ID,
    status: "generating_illustrations",
    storyJson: story,
    bibleJson: bible,
    illustrationsCount: 1 + PAGES_TO_RENDER.length,
    estimatedCostCents: 34,
    startedAt: new Date(),
  });

  // ─── Cover ───
  console.log(`\n→ Cover (Nano Banana 2 + watercolor)...`);
  const coverPrompts = buildIllustrationPrompt({
    bible,
    scene: story.coverDescription,
    pageNumber: 0,
    hasReferencePhotos: true,
  });
  console.log(`  prompt length: ${coverPrompts.positive.length} chars`);
  const coverResult = await generateCoverIllustration({
    orderId: ORDER_ID,
    positivePrompt: coverPrompts.positive,
    negativePrompt: bible.styleBible.negativeStyle,
    customerPhotoUrls: photoUrls,
  });
  console.log(`  ✓ Cover: ${coverResult.url}`);
  await db
    .update(generations)
    .set({ coverUrl: coverResult.url, updatedAt: new Date() })
    .where(eq(generations.id, newGenId));

  // ─── Body pages 1, 2, 3 ───
  for (const pageNum of PAGES_TO_RENDER) {
    const page = story.pages.find((p) => p.number === pageNum);
    if (!page) continue;
    console.log(
      `\n→ Page ${pageNum} (chars: ${JSON.stringify(page.charactersOnPage)})`,
    );
    const pagePrompts = buildIllustrationPrompt({
      bible,
      scene: page.scene,
      pageNumber: pageNum,
      hasReferencePhotos: true,
      charactersOnPage: page.charactersOnPage,
      keyObjectOrDetail: page.keyObjectOrDetail,
    });
    const pageResult = await generateBodyIllustration({
      orderId: ORDER_ID,
      pageNumber: pageNum,
      positivePrompt: pagePrompts.positive,
      negativePrompt: bible.styleBible.negativeStyle,
      coverImageUrl: coverResult.url,
      customerPhotoUrls: photoUrls,
    });
    console.log(`  ✓ Page ${pageNum}: ${pageResult.url}`);

    await db.insert(bookPages).values({
      generationId: newGenId,
      pageNumber: pageNum,
      storyText: page.text,
      illustrationUrl: pageResult.url,
      illustrationPrompt: pagePrompts.positive.slice(0, 2000),
      illustrationProvider: pageResult.modelId,
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
    .where(eq(generations.id, newGenId));

  console.log(`\n✅ Watercolor trial complete.`);
  console.log(`   Generation ID: ${newGenId}`);
  console.log(`   Admin URL:     https://hadouta-admin.vercel.app/orders/${newGenId}`);
  console.log(`\n   4-way comparison:`);
  console.log(`   Pixar trash (Nano Banana):    https://hadouta-admin.vercel.app/orders/dfb7d9d5-7ff7-4a24-83ce-bd645251d17e`);
  console.log(`   Pixar Qwen single-ref:        https://hadouta-admin.vercel.app/orders/6522f0d5-4915-4882-b984-147cd78fc872`);
  console.log(`   Pixar Qwen dual-ref:          https://hadouta-admin.vercel.app/orders/e54f9061-b41c-42cf-9feb-fceb66329f06`);
  console.log(`   Watercolor Nano Banana (THIS): https://hadouta-admin.vercel.app/orders/${newGenId}`);
}

main()
  .catch((err) => {
    console.error("\n❌ Trial failed:", err);
    process.exit(1);
  })
  .then(() => process.exit(0));
