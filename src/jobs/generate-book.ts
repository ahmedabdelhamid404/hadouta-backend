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
  photos,
  aiSettings,
} from "../db/schema.js";
import { generateStory } from "../lib/ai/story-generator.js";
import { generateBible } from "../lib/ai/bible-generator.js";
import { buildIllustrationPrompt } from "../lib/ai/prompts/build-illustration-prompt.js";
import {
  generateAllIllustrations,
  type IllustrationProvider,
} from "../lib/ai/illustration-generator.js";
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
export async function runGenerationPipeline(
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

    // Step 2: Bible generation. Locked character/setting/style/cultural
    // anchors that all 17 illustration prompts inherit from. Reads the
    // customer's uploaded photo (if any) for the vision-described path,
    // or falls back to childSpecialTraits as a free-form description seed.
    const customerPhotoUrls = await loadMainChildPhotoUrls(orderId);
    // Bible vision uses the FIRST photo (one good face shot is enough for
    // gpt-4o vision to extract clothing/features). Image generation uses ALL
    // photos for multi-angle reference.
    const primaryPhotoForVision = customerPhotoUrls[0] ?? null;
    const bible = await generateBible({
      story: storyResult.story,
      wizardData: {
        childName: ctx.order.childName ?? "Child",
        childAgeBand: ctx.order.childAgeBand as "3-5" | "5-7" | "6-8",
        childAgeExact: ctx.order.childAgeExact ?? 4,
        childGender: ctx.order.childGender as "boy" | "girl",
        theme: ctx.theme.titleAr,
        moralValue: ctx.moralValue.nameAr,
        photoUrl: primaryPhotoForVision,
        // Persona id from wizard (Phase G), free-form description fallback
        // from childSpecialTraits. The Bible generator throws cleanly if all
        // three (photo / persona / description) are absent — caught + persisted
        // by the outer try/catch.
        personaId: ctx.order.mainChildPersonaId ?? null,
        childDescription: ctx.order.childSpecialTraits ?? null,
      },
    });
    console.log(
      `[jobs/generate-book] bible done, generation=${generationId}`,
    );

    await db
      .update(generations)
      .set({
        bibleJson: bible,
        bibleRegeneratedAt: new Date(),
        status: "generating_illustrations",
        updatedAt: new Date(),
      })
      .where(eq(generations.id, generationId));

    // Step 3: Build per-page illustration prompts from Bible + scene addendum.
    // hasReferencePhotos toggles the Image-N reference-roles preamble so the
    // prompt only mentions reference images when they're actually attached.
    // Per-page charactersOnPage + keyObjectOrDetail drive supporting-character
    // injection and prop anchoring (Sprint 3 buildIllustrationPrompt rewrite).
    const hasReferencePhotos = customerPhotoUrls.length > 0;
    const coverPrompts = buildIllustrationPrompt({
      bible,
      scene: storyResult.story.coverDescription,
      pageNumber: 0,
      hasReferencePhotos,
    });
    const pagePrompts = storyResult.story.pages.map((p) => ({
      pageNumber: p.number,
      ...buildIllustrationPrompt({
        bible,
        scene: p.scene,
        pageNumber: p.number,
        hasReferencePhotos,
        charactersOnPage: p.charactersOnPage,
        keyObjectOrDetail: p.keyObjectOrDetail,
      }),
    }));

    // Step 4: Generate cover + body illustrations.
    // Provider is selected by the admin-controlled ai_settings.illustration_model
    // singleton row. Only the strict value "flux-kontext-pixar" routes to the
    // Phase 1 Pixar Kontext path; everything else (including the current
    // default "gemini-2.5-flash-image") falls back to Nano Banana.
    const settingsRow = await db
      .select({ illustrationModel: aiSettings.illustrationModel })
      .from(aiSettings)
      .where(eq(aiSettings.id, "singleton"))
      .limit(1);
    const illustrationProvider: IllustrationProvider =
      settingsRow[0]?.illustrationModel === "flux-kontext-pixar"
        ? "flux-kontext-pixar"
        : "nano-banana";

    const illustrations = await generateAllIllustrations({
      orderId,
      cover: {
        positivePrompt: coverPrompts.positive,
        negativePrompt: coverPrompts.negative,
      },
      pages: pagePrompts.map((p) => ({
        pageNumber: p.pageNumber,
        positivePrompt: p.positive,
        negativePrompt: p.negative,
      })),
      customerPhotoUrls,
      provider: illustrationProvider,
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

/**
 * Looks up the customer-uploaded main-child photo URL on Cloudinary, if any.
 * Returns null when no photo was uploaded (the no-photo wizard path).
 */
async function loadMainChildPhotoUrls(orderId: string): Promise<string[]> {
  const rows = await db
    .select({ url: photos.url })
    .from(photos)
    .where(and(eq(photos.orderId, orderId), eq(photos.ownerType, "main_child")));
  return rows.map((r) => r.url);
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
