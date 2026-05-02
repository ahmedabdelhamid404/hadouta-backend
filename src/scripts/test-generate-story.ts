// Debug script — runs story generation against a real order and prints the
// resulting StoryOutput JSON. Persists the result to a generations row so
// Ahmed can pull it up in the (forthcoming) admin UI later.
//
// Usage:
//   pnpm tsx src/scripts/test-generate-story.ts <orderId>
//   pnpm tsx src/scripts/test-generate-story.ts             # picks latest paid order
//
// This intentionally does NOT yet generate illustrations — story-only test
// keeps iteration cycles short while we tune the system prompt + few-shots.
//
// To also kick off illustrations, pass --illustrate.

import "dotenv/config";
import { eq, desc, and, inArray, isNotNull } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  orders,
  themes,
  moralValues,
  supportingCharacters,
  generations,
  bookPages,
} from "../db/schema.js";
import { generateStory } from "../lib/ai/story-generator.js";
import { generateAllIllustrations } from "../lib/ai/illustration-generator.js";

interface CliArgs {
  orderId: string | null;
  illustrate: boolean;
}

function parseCliArgs(argv: string[]): CliArgs {
  const args = argv.slice(2);
  let orderId: string | null = null;
  let illustrate = false;
  for (const a of args) {
    if (a === "--illustrate") illustrate = true;
    else if (!a.startsWith("--")) orderId = a;
  }
  return { orderId, illustrate };
}

async function pickLatestPaidOrder(): Promise<string> {
  const rows = await db
    .select({ id: orders.id, status: orders.status, createdAt: orders.createdAt })
    .from(orders)
    .where(
      and(
        inArray(orders.status, ["paid", "in_production", "review", "delivered"]),
        isNotNull(orders.childAgeBand),
        isNotNull(orders.themeId),
        isNotNull(orders.moralValueId),
      ),
    )
    .orderBy(desc(orders.createdAt))
    .limit(1);
  const row = rows[0];
  if (!row) {
    throw new Error(
      "No completed orders found. Pass an orderId explicitly: pnpm tsx src/scripts/test-generate-story.ts <orderId>",
    );
  }
  console.log(`Picked latest order: ${row.id} (status=${row.status})`);
  return row.id;
}

async function loadOrderContext(orderId: string) {
  const orderRows = await db
    .select()
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);
  const order = orderRows[0];
  if (!order) throw new Error(`Order ${orderId} not found`);
  if (!order.themeId) throw new Error(`Order ${orderId} has no themeId`);
  if (!order.moralValueId)
    throw new Error(`Order ${orderId} has no moralValueId`);
  if (!order.childAgeBand)
    throw new Error(`Order ${orderId} has no childAgeBand`);

  const themeRows = await db
    .select()
    .from(themes)
    .where(eq(themes.id, order.themeId))
    .limit(1);
  const theme = themeRows[0];
  if (!theme) throw new Error(`Theme ${order.themeId} not found`);

  const moralRows = await db
    .select()
    .from(moralValues)
    .where(eq(moralValues.id, order.moralValueId))
    .limit(1);
  const moralValue = moralRows[0];
  if (!moralValue)
    throw new Error(`MoralValue ${order.moralValueId} not found`);

  const supportingChars = await db
    .select()
    .from(supportingCharacters)
    .where(eq(supportingCharacters.orderId, orderId));

  return { order, theme, moralValue, supportingChars };
}

async function main() {
  const cli = parseCliArgs(process.argv);
  const orderId = cli.orderId ?? (await pickLatestPaidOrder());

  console.log("\n=== Loading order context ===");
  const ctx = await loadOrderContext(orderId);
  console.log(`Order: ${orderId}`);
  console.log(`  Child: ${ctx.order.childName} (${ctx.order.childAgeBand})`);
  console.log(`  Theme: ${ctx.theme.titleAr} / ${ctx.theme.titleEn}`);
  console.log(`  Moral: ${ctx.moralValue.nameAr} / ${ctx.moralValue.nameEn}`);
  console.log(`  Supporting chars: ${ctx.supportingChars.length}`);

  // Insert generation row up front so we have an id to reference if anything blows up.
  const [generation] = await db
    .insert(generations)
    .values({
      orderId,
      status: "generating_story",
      startedAt: new Date(),
    })
    .returning();
  if (!generation) throw new Error("Failed to insert generation row");
  console.log(`\nGeneration ${generation.id} inserted (status=generating_story)`);

  console.log("\n=== Running story generator ===");
  const result = await generateStory({
    order: ctx.order,
    theme: ctx.theme,
    moralValue: ctx.moralValue,
    supportingCharacters: ctx.supportingChars,
  });

  console.log(
    `\nStory generated in ${result.durationMs}ms via ${result.provider}/${result.modelId}`,
  );
  console.log(
    `Tokens — input: ${result.inputTokens}, output: ${result.outputTokens}, est cost: ${result.estimatedCostCents !== null ? `${result.estimatedCostCents}¢ ($${(result.estimatedCostCents / 100).toFixed(4)})` : "unknown"}`,
  );

  console.log("\n=== Story JSON ===");
  console.log(JSON.stringify(result.story, null, 2));

  // Persist story + per-page rows.
  await db
    .update(generations)
    .set({
      status: cli.illustrate ? "generating_illustrations" : "story_done",
      storyJson: result.story,
      storyTokensInput: result.inputTokens,
      storyTokensOutput: result.outputTokens,
      estimatedCostCents: result.estimatedCostCents ?? null,
      updatedAt: new Date(),
    })
    .where(eq(generations.id, generation.id));

  // Insert one book_pages row per page (illustrationUrl null for now).
  for (const page of result.story.pages) {
    await db.insert(bookPages).values({
      generationId: generation.id,
      pageNumber: page.number,
      storyText: page.text,
      illustrationPrompt: page.illustrationPrompt,
    });
  }
  console.log(`\nPersisted story + ${result.story.pages.length} page rows.`);

  if (cli.illustrate) {
    console.log("\n=== Running illustration generator (cover + body pages) ===");
    const illustrations = await generateAllIllustrations({
      orderId,
      cover: { prompt: result.story.coverDescription },
      pages: result.story.pages.map((p) => ({
        pageNumber: p.number,
        prompt: p.illustrationPrompt,
      })),
    });

    console.log(
      `\nIllustrations done in ${illustrations.totalDurationMs}ms (${illustrations.pages.length + 1} images)`,
    );
    console.log(`Cover: ${illustrations.cover.url}`);
    for (const page of illustrations.pages) {
      console.log(`Page ${page.pageNumber}: ${page.url}`);
    }

    // Persist URLs back to book_pages + generation.
    await db
      .update(generations)
      .set({
        coverUrl: illustrations.cover.url,
        illustrationsCount: illustrations.pages.length + 1,
        status: "awaiting_review",
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(generations.id, generation.id));

    for (const page of illustrations.pages) {
      await db
        .update(bookPages)
        .set({
          illustrationUrl: page.url,
          illustrationProvider: page.modelId,
          illustrationGeneratedAt: new Date(),
        })
        .where(
          and(
            eq(bookPages.generationId, generation.id),
            eq(bookPages.pageNumber, page.pageNumber),
          ),
        );
    }
  }

  console.log(`\n✓ Done. Generation ID: ${generation.id}`);
  console.log(
    `Status: ${cli.illustrate ? "awaiting_review" : "story_done (pass --illustrate to render images)"}`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("\n✗ Test failed:");
  console.error(err);
  process.exit(1);
});
