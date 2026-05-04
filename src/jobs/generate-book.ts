// Book generation job — runs the full AI pipeline for a paid order.
// Story → persist → illustrations → persist → awaiting_review.
//
// Designed to be fire-and-forget from the Paymob webhook handler. Webhook
// returns 200 to Paymob immediately; this runs in the background. All
// errors are caught + logged + persisted to generations.errorLog so the
// admin can retry from the UI later.
//
// Idempotency: kickoffGenerationIfNeeded() checks for any existing non-terminal
// generation row for the order; if one exists, it does nothing. Prevents
// duplicate generations when the webhook fires twice (Paymob retries).

import { eq, and, inArray, desc } from "drizzle-orm";
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
import { adminEvents } from "../lib/admin-events.js";

const NON_TERMINAL_STATUSES = [
  "queued",
  "generating_story",
  "story_done",
  "generating_illustrations",
  "illustrations_done",
  "awaiting_review",
  "approved",
  "assembling_pdf",
  "delivering",
  "delivered",
] as const;

interface KickoffResult {
  generationId: string | null;
  reason: "started" | "already_running" | "order_not_paid";
}

/**
 * Checks whether the order needs a new generation, and if so, kicks one off
 * fire-and-forget. Returns immediately. Safe to call from webhook handlers.
 */
export async function kickoffGenerationIfNeeded(
  orderId: string,
): Promise<KickoffResult> {
  const orderRows = await db
    .select({ status: orders.status })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);
  const order = orderRows[0];
  if (!order || order.status !== "paid") {
    return { generationId: null, reason: "order_not_paid" };
  }

  const existing = await db
    .select({ id: generations.id, status: generations.status })
    .from(generations)
    .where(
      and(
        eq(generations.orderId, orderId),
        inArray(generations.status, [...NON_TERMINAL_STATUSES]),
      ),
    )
    .orderBy(desc(generations.createdAt))
    .limit(1);
  if (existing[0]) {
    return { generationId: existing[0].id, reason: "already_running" };
  }

  // Insert a queued row before kicking off — this is the row the rest of the
  // pipeline updates as it progresses.
  const [generation] = await db
    .insert(generations)
    .values({ orderId, status: "queued", startedAt: new Date() })
    .returning({ id: generations.id });
  if (!generation) {
    throw new Error(`Failed to insert generation row for order ${orderId}`);
  }

  // Fire and forget. The function catches its own errors + persists them.
  void runGenerationPipeline(generation.id, orderId).catch((err) => {
    console.error(
      `[jobs/generate-book] unhandled error for generation=${generation.id}`,
      err,
    );
  });

  return { generationId: generation.id, reason: "started" };
}

/**
 * Internal — full pipeline. Single-attempt; admin retries via the UI.
 * Catches all errors, persists status='failed' + errorLog so the admin sees
 * what happened.
 */
async function runGenerationPipeline(
  generationId: string,
  orderId: string,
): Promise<void> {
  try {
    console.log(
      `[jobs/generate-book] start generation=${generationId} order=${orderId}`,
    );

    await db
      .update(generations)
      .set({ status: "generating_story", updatedAt: new Date() })
      .where(eq(generations.id, generationId));

    const ctx = await loadOrderContext(orderId);

    const storyResult = await generateStory({
      order: ctx.order,
      theme: ctx.theme,
      moralValue: ctx.moralValue,
      supportingCharacters: ctx.supportingChars,
    });
    console.log(
      `[jobs/generate-book] story done: ${storyResult.story.pages.length} pages, ${storyResult.durationMs}ms, ~${storyResult.estimatedCostCents ?? "?"}¢`,
    );

    await db
      .update(generations)
      .set({
        status: "story_done",
        storyJson: storyResult.story,
        storyTokensInput: storyResult.inputTokens,
        storyTokensOutput: storyResult.outputTokens,
        estimatedCostCents: storyResult.estimatedCostCents ?? null,
        updatedAt: new Date(),
      })
      .where(eq(generations.id, generationId));

    // Persist per-page rows (without illustration URLs yet).
    for (const page of storyResult.story.pages) {
      await db.insert(bookPages).values({
        generationId,
        pageNumber: page.number,
        storyText: page.text,
        illustrationPrompt: page.scene,
      });
    }

    await db
      .update(generations)
      .set({ status: "generating_illustrations", updatedAt: new Date() })
      .where(eq(generations.id, generationId));

    const illustrations = await generateAllIllustrations({
      orderId,
      cover: { prompt: storyResult.story.coverDescription },
      pages: storyResult.story.pages.map((p) => ({
        pageNumber: p.number,
        prompt: p.scene,
      })),
    });
    console.log(
      `[jobs/generate-book] illustrations done: ${illustrations.pages.length + 1} images, ${illustrations.totalDurationMs}ms`,
    );

    // Persist illustration URLs.
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
            eq(bookPages.generationId, generationId),
            eq(bookPages.pageNumber, page.pageNumber),
          ),
        );
    }

    await db
      .update(generations)
      .set({
        status: "awaiting_review",
        coverUrl: illustrations.cover.url,
        illustrationsCount: illustrations.pages.length + 1,
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(generations.id, generationId));

    // Reflect on the order too — admin queue keys off this.
    await db
      .update(orders)
      .set({ status: "review", updatedAt: new Date() })
      .where(eq(orders.id, orderId));

    console.log(
      `[jobs/generate-book] generation=${generationId} → awaiting_review`,
    );

    // Push live notification to any connected admin SSE clients.
    adminEvents.emitEvent({
      type: "generation_status",
      generationId,
      orderId,
      status: "awaiting_review",
      childName: ctx.order.childName,
      themeTitle: ctx.theme.titleAr,
    });
  } catch (err) {
    const errorMessage =
      err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : String(err);
    console.error(
      `[jobs/generate-book] FAILED generation=${generationId}:`,
      errorMessage,
    );
    await db
      .update(generations)
      .set({
        status: "failed",
        errorLog: errorMessage.slice(0, 8000),
        updatedAt: new Date(),
      })
      .where(eq(generations.id, generationId));
    adminEvents.emitEvent({
      type: "generation_status",
      generationId,
      orderId,
      status: "failed",
    });
  }
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
