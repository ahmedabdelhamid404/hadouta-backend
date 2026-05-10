// Book generation job — runs the full AI pipeline for a paid order.
// Story → persist → bible → persist → illustrations → persist → terminal status.
//
// Designed to be fire-and-forget from the Paymob webhook handler. Webhook
// returns 200 to Paymob immediately; this runs in the background. All
// errors are caught + logged + persisted to generations.errorLog so the
// admin can retry from the UI later.
//
// V7 fix (2026-05-10) — RESUMABILITY + RETRY-QUEUE TERMINAL STATES:
//   1. runGenerationPipeline now has resume logic. If the generation row
//      already has a Bible (from a prior partial run), story+bible are
//      skipped. If individual bookPages already have illustrationUrl set,
//      those pages are skipped — only missing illustrations are rendered.
//      Network blips on page 16 of 17 no longer waste $1.36; the resume
//      path costs $0.08 to render the missing page.
//   2. Terminal status is now computed from the orchestrator's BatchResult:
//        - all pages succeeded → awaiting_review (today's behavior)
//        - some retryable failures (network/503/Cloudinary) → failed_retry_pending
//          with next_retry_at = NOW() + backoff (5/15/30/60min, then 5min cap)
//        - any permanent failure (safety/auth/billing) → failed_human_review
//          (mixed retryable + permanent also escalates here — admin decides)
//      The cron worker (src/jobs/retry-failed-generations.ts) picks up
//      failed_retry_pending rows and re-invokes runGenerationPipeline with
//      resume semantics — only missing illustrations are billed.
//   3. failureSummary persists the structured PageFailure[] from the
//      orchestrator so the admin queue can render a per-page failure table.
//
// Idempotency: kickoffGenerationIfNeeded() checks for any existing non-terminal
// generation row for the order; if one exists, it does nothing. Prevents
// duplicate generations when the webhook fires twice (Paymob retries).
// failed_retry_pending counts as non-terminal — the cron worker handles it.

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
} from "../db/schema.js";
import { generateStory } from "../lib/ai/story-generator.js";
import { generateBible } from "../lib/ai/bible-generator.js";
import { buildIllustrationPrompt } from "../lib/ai/prompts/build-illustration-prompt.js";
import {
  generateAllIllustrations,
  type IllustrationProvider,
  type PageFailure,
  type BatchResult,
} from "../lib/ai/illustration-generator.js";
import type { Bible } from "../lib/ai/schemas/bible.js";
import type { StoryOutput } from "../lib/ai/schemas/story.js";
import { adminEvents } from "../lib/admin-events.js";

// Statuses where a fresh kickoff should be skipped because work is already
// in flight. failed_retry_pending is INCLUDED — the cron worker owns it.
// failed_human_review and failed are TERMINAL (admin action required).
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
  "failed_retry_pending",
] as const;

// Backoff schedule for retryable failures (V7 fix). Index = retry_count;
// values past the array length cap at 5 minutes (per ADR-029).
// Pattern: short bursts at first to absorb transient blips, then settle into
// a steady 5-minute cadence so Tier-1 503 storms get budget without burning
// through the 20-attempt cap.
const RETRY_BACKOFF_MS = [
  5 * 60 * 1000, //  5 min — first retry, catches most transient blips
  15 * 60 * 1000, // 15 min
  30 * 60 * 1000, // 30 min
  60 * 60 * 1000, // 60 min
  // From attempt 5+ → cap at 5 min (per ADR-029 Layer 4 cron cadence)
];
const RETRY_BACKOFF_CAP_MS = 5 * 60 * 1000;
const MAX_RETRY_ATTEMPTS = 20; // ~10 hours of attempts before human review (ADR-029)

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
 * Internal — full pipeline with V7 resume + retry-aware terminal status.
 *
 * Resume semantics:
 *   - If generations.bibleJson is populated, story+bible are skipped (the row
 *     already has them from a prior partial run).
 *   - If bookPages rows for this generationId already have illustrationUrl
 *     set, those pages are skipped. Only missing illustrations are rendered.
 *   - The cover is treated like a body page — generations.coverUrl set →
 *     skipped on resume.
 *
 * Terminal status:
 *   - All illustrations succeeded → awaiting_review.
 *   - At least one permanent failure (safety/auth/billing) → failed_human_review.
 *   - Only retryable failures + retry_count < 20 → failed_retry_pending with
 *     nextRetryAt set. Cron worker resumes.
 *   - Only retryable failures + retry_count ≥ 20 → failed_human_review.
 *
 * The outer try/catch handles thrown errors from non-illustration steps
 * (story-gen failure, bible-gen failure, DB error). Those classify as
 * generic transient → failed_retry_pending unless retry budget exhausted.
 */
export async function runGenerationPipeline(
  generationId: string,
  orderId: string,
): Promise<void> {
  const startedAt = Date.now();
  try {
    console.log(
      `[jobs/generate-book] start generation=${generationId} order=${orderId}`,
    );

    // Load existing state for resume.
    const existing = await loadGenerationState(generationId);
    const isResume =
      existing.bibleJson !== null && existing.storyJson !== null;
    if (isResume) {
      console.log(
        `[jobs/generate-book] RESUME mode — story+bible already present, ` +
          `${existing.completedPageNumbers.size} of ${existing.completedPageNumbers.size + 1} ` +
          `illustrations already done (cover ${existing.coverUrl ? "✓" : "✗"})`,
      );
    }

    await db
      .update(generations)
      .set({
        status: isResume ? "generating_illustrations" : "generating_story",
        updatedAt: new Date(),
      })
      .where(eq(generations.id, generationId));

    const ctx = await loadOrderContext(orderId);

    // ----- Step 1+2: Story + Bible (skipped on resume) -----
    let story: StoryOutput;
    let bible: Bible;
    if (isResume) {
      story = existing.storyJson as StoryOutput;
      bible = existing.bibleJson as Bible;
    } else {
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

      // Customer photo upload is REQUIRED (founder lock-in 2026-05-10) —
      // wizard enforces this and the orchestrator throws if absent.
      const customerPhotoUrls = await loadMainChildPhotoUrls(orderId);
      if (customerPhotoUrls.length === 0) {
        throw new Error(
          "Customer photo upload is required but no photos found for this order. " +
            "The wizard should have prevented submission without a photo. " +
            `orderId=${orderId}`,
        );
      }
      const primaryPhotoForVision = customerPhotoUrls[0]!;
      bible = await generateBible({
        story: storyResult.story,
        wizardData: {
          childName: ctx.order.childName ?? "Child",
          childAgeBand: ctx.order.childAgeBand as "3-5" | "5-7" | "6-8",
          childAgeExact: ctx.order.childAgeExact ?? 4,
          childGender: ctx.order.childGender as "boy" | "girl",
          theme: ctx.theme.titleAr,
          moralValue: ctx.moralValue.nameAr,
          photoUrl: primaryPhotoForVision,
          personaId: ctx.order.mainChildPersonaId ?? null,
          childDescription: ctx.order.childSpecialTraits ?? null,
        },
      });
      console.log(`[jobs/generate-book] bible done, generation=${generationId}`);

      await db
        .update(generations)
        .set({
          bibleJson: bible,
          bibleRegeneratedAt: new Date(),
          status: "generating_illustrations",
          updatedAt: new Date(),
        })
        .where(eq(generations.id, generationId));
      story = storyResult.story;
    }

    // ----- Step 3: Build illustration prompts -----
    // Photo URLs are required even on resume (Bible-gen vision used the first
    // photo, but illustration generator uses ALL photos for multi-angle ref).
    const customerPhotoUrls = await loadMainChildPhotoUrls(orderId);
    if (customerPhotoUrls.length === 0) {
      throw new Error(
        `Customer photos missing on resume — orderId=${orderId}. ` +
          "Likely deleted between original run and resume; admin must investigate.",
      );
    }

    // V12 fix (2026-05-10): cover charactersOnPage falls back to page 1's.
    // UC6 fix: locationName threaded for multi-setting stories.
    const storyWithExtras = story as StoryOutput & {
      coverCharactersOnPage?: string[];
      coverLocationName?: string;
    };
    const coverCharactersOnPage =
      storyWithExtras.coverCharactersOnPage ??
      story.pages[0]?.charactersOnPage ??
      [];
    const coverPrompts = buildIllustrationPrompt({
      bible,
      scene: story.coverDescription,
      pageNumber: 0,
      charactersOnPage: coverCharactersOnPage,
      locationName: storyWithExtras.coverLocationName,
    });
    const pagePrompts = story.pages.map((p) => {
      const pageWithLocation = p as typeof p & { locationName?: string };
      return {
        pageNumber: p.number,
        ...buildIllustrationPrompt({
          bible,
          scene: p.scene,
          pageNumber: p.number,
          charactersOnPage: p.charactersOnPage,
          keyObjectOrDetail: p.keyObjectOrDetail,
          locationName: pageWithLocation.locationName,
        }),
      };
    });

    const illustrationProvider: IllustrationProvider = "nano-banana";
    const resolveOutfit = (pageNumber: number): string => {
      if (pageNumber === 0) return bible.characterBible.mainChild.outfit.default;
      for (const v of bible.characterBible.mainChild.outfit.variations) {
        if (v.pageNumbers.includes(pageNumber)) return v.description;
      }
      return bible.characterBible.mainChild.outfit.default;
    };

    // ----- Step 4: Generate illustrations (filtered for resume) -----
    // Skip pages that already have an illustrationUrl. The orchestrator's
    // skip-and-continue (V6 fix) ensures one bad page doesn't kill the rest.
    const pagesToRender = pagePrompts.filter(
      (p) => !existing.completedPageNumbers.has(p.pageNumber),
    );
    const renderCover = !existing.coverUrl;
    const skippedCount =
      (renderCover ? 0 : 1) + (pagePrompts.length - pagesToRender.length);
    if (isResume && skippedCount > 0) {
      console.log(
        `[jobs/generate-book] resume: skipping ${skippedCount} already-rendered images, ` +
          `rendering ${(renderCover ? 1 : 0) + pagesToRender.length} new images`,
      );
    }

    let batch: BatchResult;
    if (renderCover || pagesToRender.length > 0) {
      // Build a synthetic cover input even when not rendering — the orchestrator
      // expects a cover slot. When renderCover=false we pass a sentinel and
      // post-process to ignore it. Cleanest is a conditional orchestrator.
      batch = await runIllustrationBatch({
        orderId,
        bible,
        coverPrompts,
        pagePrompts: pagesToRender,
        customerPhotoUrls,
        provider: illustrationProvider,
        resolveOutfit,
        renderCover,
      });
    } else {
      // Nothing to render (resume found everything done — unusual but possible
      // if a prior run was killed AFTER all illustrations succeeded but BEFORE
      // status flip). Synthesize an empty BatchResult and proceed to finalize.
      batch = {
        cover: null,
        pages: [],
        coverFailure: null,
        pageFailures: [],
        totalDurationMs: 0,
      };
    }

    console.log(
      `[jobs/generate-book] illustrations batch done: ` +
        `${batch.pages.length} pages succeeded, ${batch.pageFailures.length} failed, ` +
        `cover ${batch.cover ? "✓" : batch.coverFailure ? "✗" : "skipped"}, ` +
        `${batch.totalDurationMs}ms`,
    );

    // ----- Step 5: Persist successes -----
    if (batch.cover) {
      await db
        .update(generations)
        .set({
          coverUrl: batch.cover.url,
          updatedAt: new Date(),
        })
        .where(eq(generations.id, generationId));
    }
    for (const page of batch.pages) {
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

    // ----- Step 6: Multi-turn telemetry (V8 fix) -----
    // Aggregate turn-2 success rate across the batch + cover. Logged for now;
    // could be persisted to a metrics table later if rate trends past 20%.
    const allResults = [
      ...(batch.cover ? [batch.cover] : []),
      ...batch.pages,
    ];
    const turn2Successes = allResults.filter(
      (r) => r.multiTurnStats.turn2Succeeded,
    ).length;
    const turn2Fallbacks = allResults.filter(
      (r) => r.multiTurnStats.fallbackToTurn1,
    ).length;
    if (allResults.length > 0) {
      const fallbackPct = Math.round((turn2Fallbacks / allResults.length) * 100);
      console.log(
        `[jobs/generate-book] turn-2 telemetry: ${turn2Successes} succeeded, ` +
          `${turn2Fallbacks} fell back to turn 1 (${fallbackPct}%)`,
      );
      if (fallbackPct >= 20) {
        console.warn(
          `[jobs/generate-book] ⚠️  turn-2 fallback rate ${fallbackPct}% ≥ 20% — ` +
            `multi-turn architecture may not be paying its keep on this batch.`,
        );
      }
    }

    // ----- Step 7: Decide terminal status -----
    // Aggregate all failures from this batch + any prior failures already
    // persisted in failure_summary (cron-resume case — keep failures that
    // didn't get retried in THIS run).
    const allFailures: PageFailure[] = [];
    if (batch.coverFailure) allFailures.push(batch.coverFailure);
    allFailures.push(...batch.pageFailures);

    // Re-check completion against the DB (truth source) rather than batch
    // result alone — catches the resume case where this run rendered some
    // pages and a prior run rendered others.
    const finalState = await loadGenerationState(generationId);
    const expectedPageNumbers = story.pages.map((p) => p.number);
    const missingPages = expectedPageNumbers.filter(
      (n) => !finalState.completedPageNumbers.has(n),
    );
    const coverMissing = !finalState.coverUrl;

    // Reconcile: failures that correspond to pages that NOW have an
    // illustrationUrl are stale (rendered successfully in a later attempt) —
    // drop them.
    const livePageFailures = allFailures.filter((f) => {
      if (f.pageNumber === 0) return coverMissing;
      return missingPages.includes(f.pageNumber);
    });

    const hasPermanentFailure = livePageFailures.some((f) => !f.retryable);
    const hasRetryableFailure = livePageFailures.some((f) => f.retryable);
    const allDone = !coverMissing && missingPages.length === 0;

    if (allDone) {
      // Happy path — every page rendered.
      const illustrationsCount = expectedPageNumbers.length + 1;
      await db
        .update(generations)
        .set({
          status: "awaiting_review",
          illustrationsCount,
          completedAt: new Date(),
          nextRetryAt: null,
          lastError: null,
          failureSummary: null,
          updatedAt: new Date(),
        })
        .where(eq(generations.id, generationId));
      await db
        .update(orders)
        .set({ status: "review", updatedAt: new Date() })
        .where(eq(orders.id, orderId));
      console.log(
        `[jobs/generate-book] generation=${generationId} → awaiting_review ` +
          `(${illustrationsCount} images, ${Date.now() - startedAt}ms total)`,
      );
      adminEvents.emitEvent({
        type: "generation_status",
        generationId,
        orderId,
        status: "awaiting_review",
        childName: ctx.order.childName,
        themeTitle: ctx.theme.titleAr,
      });
    } else if (hasPermanentFailure) {
      // Any safety/billing/auth failure → human review. Do NOT auto-retry —
      // those errors will not resolve themselves on a backoff.
      await persistTerminal(generationId, orderId, {
        status: "failed_human_review",
        failures: livePageFailures,
        nextRetryAt: null,
        lastError: livePageFailures.find((f) => !f.retryable)?.categoryLabel ?? null,
      });
      console.log(
        `[jobs/generate-book] generation=${generationId} → failed_human_review ` +
          `(${livePageFailures.filter((f) => !f.retryable).length} permanent, ` +
          `${livePageFailures.filter((f) => f.retryable).length} retryable)`,
      );
    } else if (hasRetryableFailure || coverMissing || missingPages.length > 0) {
      // Only retryable failures (or unrendered pages with no failure record —
      // possible if a worker crashed mid-batch). Schedule a retry unless we've
      // exhausted the attempt budget.
      const nextRetryCount = finalState.retryCount + 1;
      if (nextRetryCount > MAX_RETRY_ATTEMPTS) {
        await persistTerminal(generationId, orderId, {
          status: "failed_human_review",
          failures: livePageFailures,
          nextRetryAt: null,
          lastError:
            livePageFailures[0]?.categoryLabel ??
            "Retry budget exhausted with no specific error",
        });
        console.log(
          `[jobs/generate-book] generation=${generationId} → failed_human_review ` +
            `(retry budget exhausted: ${nextRetryCount} > ${MAX_RETRY_ATTEMPTS})`,
        );
      } else {
        const backoffMs =
          RETRY_BACKOFF_MS[finalState.retryCount] ?? RETRY_BACKOFF_CAP_MS;
        const nextRetryAt = new Date(Date.now() + backoffMs);
        await db
          .update(generations)
          .set({
            status: "failed_retry_pending",
            retryCount: nextRetryCount,
            nextRetryAt,
            lastError:
              livePageFailures[0]?.categoryLabel ??
              `${missingPages.length + (coverMissing ? 1 : 0)} pages incomplete`,
            failureSummary: livePageFailures,
            updatedAt: new Date(),
          })
          .where(eq(generations.id, generationId));
        console.log(
          `[jobs/generate-book] generation=${generationId} → failed_retry_pending ` +
            `(attempt ${nextRetryCount}/${MAX_RETRY_ATTEMPTS}, retry at ${nextRetryAt.toISOString()})`,
        );
      }
    }
  } catch (err) {
    // Unhandled error from story-gen / bible-gen / DB / etc. (illustrations
    // are caught by the orchestrator and don't reach here). Treat as
    // retryable transient unless we've already burned the budget.
    const errorMessage =
      err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : String(err);
    console.error(
      `[jobs/generate-book] FAILED generation=${generationId}:`,
      errorMessage,
    );
    const existing = await loadGenerationState(generationId).catch(() => null);
    const retryCount = (existing?.retryCount ?? 0) + 1;
    const truncatedError = errorMessage.slice(0, 8000);
    if (retryCount > MAX_RETRY_ATTEMPTS) {
      await db
        .update(generations)
        .set({
          status: "failed_human_review",
          retryCount,
          errorLog: truncatedError,
          lastError: "Retry budget exhausted (story/bible/DB stage)",
          nextRetryAt: null,
          updatedAt: new Date(),
        })
        .where(eq(generations.id, generationId));
    } else {
      const backoffMs =
        RETRY_BACKOFF_MS[retryCount - 1] ?? RETRY_BACKOFF_CAP_MS;
      await db
        .update(generations)
        .set({
          status: "failed_retry_pending",
          retryCount,
          errorLog: truncatedError,
          lastError: (err as Error).message?.slice(0, 200) ?? "Unknown error",
          nextRetryAt: new Date(Date.now() + backoffMs),
          updatedAt: new Date(),
        })
        .where(eq(generations.id, generationId));
    }
    adminEvents.emitEvent({
      type: "generation_status",
      generationId,
      orderId,
      status: "failed_retry_pending",
    });
  }
}

// ============================================================================
// Helpers
// ============================================================================

/** Persists a terminal generation status with the failure summary, clears the
 *  retry pointer, and emits the admin SSE event. Used for human-review
 *  escalation paths only. */
async function persistTerminal(
  generationId: string,
  orderId: string,
  args: {
    status: "failed_human_review";
    failures: PageFailure[];
    nextRetryAt: Date | null;
    lastError: string | null;
  },
): Promise<void> {
  await db
    .update(generations)
    .set({
      status: args.status,
      failureSummary: args.failures,
      nextRetryAt: args.nextRetryAt,
      lastError: args.lastError,
      updatedAt: new Date(),
    })
    .where(eq(generations.id, generationId));
  adminEvents.emitEvent({
    type: "generation_status",
    generationId,
    orderId,
    status: args.status,
  });
}

interface ResumeState {
  storyJson: unknown | null;
  bibleJson: unknown | null;
  coverUrl: string | null;
  retryCount: number;
  /** Page numbers (1..N) where bookPages.illustrationUrl IS NOT NULL. */
  completedPageNumbers: Set<number>;
}

async function loadGenerationState(
  generationId: string,
): Promise<ResumeState> {
  const rows = await db
    .select({
      storyJson: generations.storyJson,
      bibleJson: generations.bibleJson,
      coverUrl: generations.coverUrl,
      retryCount: generations.retryCount,
    })
    .from(generations)
    .where(eq(generations.id, generationId))
    .limit(1);
  const gen = rows[0];
  if (!gen) throw new Error(`Generation ${generationId} not found`);

  const completed = await db
    .select({ pageNumber: bookPages.pageNumber })
    .from(bookPages)
    .where(eq(bookPages.generationId, generationId));
  const completedPageNumbers = new Set<number>();
  for (const row of completed) {
    // Only count rows that have an illustrationUrl set. The schema-level
    // select above doesn't filter — we re-query with a conditional. Cleaner:
    // include the illustrationUrl column and filter here.
  }
  // Re-query with illustrationUrl so we can filter on it.
  const completedWithUrl = await db
    .select({
      pageNumber: bookPages.pageNumber,
      illustrationUrl: bookPages.illustrationUrl,
    })
    .from(bookPages)
    .where(eq(bookPages.generationId, generationId));
  for (const row of completedWithUrl) {
    if (row.illustrationUrl) completedPageNumbers.add(row.pageNumber);
  }

  return {
    storyJson: gen.storyJson ?? null,
    bibleJson: gen.bibleJson ?? null,
    coverUrl: gen.coverUrl ?? null,
    retryCount: gen.retryCount ?? 0,
    completedPageNumbers,
  };
}

/** Wraps generateAllIllustrations. Optionally renders the cover (when
 *  renderCover=false, the cover slot is skipped — used on resume when cover
 *  was already saved). */
async function runIllustrationBatch(args: {
  orderId: string;
  bible: Bible;
  coverPrompts: { positive: string; negative: string };
  pagePrompts: Array<{
    pageNumber: number;
    positive: string;
    negative: string;
  }>;
  customerPhotoUrls: string[];
  provider: IllustrationProvider;
  resolveOutfit: (pageNumber: number) => string;
  renderCover: boolean;
}): Promise<BatchResult> {
  if (args.renderCover) {
    return generateAllIllustrations({
      orderId: args.orderId,
      protagonistName: args.bible.characterBible.mainChild.name,
      cover: {
        positivePrompt: args.coverPrompts.positive,
        negativePrompt: args.coverPrompts.negative,
        outfit: args.resolveOutfit(0),
      },
      pages: args.pagePrompts.map((p) => ({
        pageNumber: p.pageNumber,
        positivePrompt: p.positive,
        negativePrompt: p.negative,
        outfit: args.resolveOutfit(p.pageNumber),
      })),
      customerPhotoUrls: args.customerPhotoUrls,
      provider: args.provider,
    });
  }

  // Cover already done — only render body pages. We bypass the orchestrator's
  // cover slot by feeding it a no-op cover prompt that we discard. The
  // orchestrator catches errors anyway, so even if the no-op fails it doesn't
  // bubble. Cleaner alternative: a body-only entry point on the orchestrator.
  // For minimal surface change, we just call generateBodyIllustration via a
  // direct skip-and-continue here.
  //
  // Inline minimal version — mirror runWithConcurrencyCollecting from the
  // orchestrator but body-only.
  const { generateBodyIllustration } = await import(
    "../lib/ai/illustration-generator.js"
  );
  const successes: BatchResult["pages"] = [];
  const failures: PageFailure[] = [];
  const concurrency = 3;
  let cursor = 0;
  const startedAt = Date.now();
  const items = args.pagePrompts;
  async function worker(): Promise<void> {
    while (true) {
      const i = cursor++;
      const item = items[i];
      if (item === undefined || i >= items.length) return;
      try {
        const result = await generateBodyIllustration({
          orderId: args.orderId,
          pageNumber: item.pageNumber,
          positivePrompt: item.positive,
          negativePrompt: item.negative,
          customerPhotoUrls: args.customerPhotoUrls,
          protagonistName: args.bible.characterBible.mainChild.name,
          outfit: args.resolveOutfit(item.pageNumber),
          provider: args.provider,
        });
        successes.push({ ...result, pageNumber: item.pageNumber });
      } catch (err) {
        const e = err as Error & {
          category?: { label: string; severity: "warn" | "error" | "critical"; action: string; retry: string };
        };
        const cat = e.category;
        failures.push({
          pageNumber: item.pageNumber,
          categoryLabel: cat?.label ?? "Unknown Error",
          message: (e.message ?? String(err)).slice(0, 500),
          severity: cat?.severity ?? "error",
          action: cat?.action ?? "Review logs",
          retryable: cat ? cat.retry !== "no-retry" : true,
        });
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );
  successes.sort((a, b) => a.pageNumber - b.pageNumber);
  failures.sort((a, b) => a.pageNumber - b.pageNumber);
  return {
    cover: null,
    pages: successes,
    coverFailure: null,
    pageFailures: failures,
    totalDurationMs: Date.now() - startedAt,
  };
}

/**
 * Looks up the customer-uploaded main-child photo URLs on Cloudinary.
 * Returns [] when no photo was uploaded (the orchestrator throws upstream).
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
