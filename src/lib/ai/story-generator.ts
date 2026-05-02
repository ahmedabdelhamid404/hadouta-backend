// Story generator — turns an Order (paid) into a structured StoryOutput.
// This is the centerpiece of Sprint 2 Part 1.
//
// Flow:
//   1. Read ai_settings singleton (story_model, story_max_tokens).
//   2. Resolve the model via router.ts.
//   3. Build system prompt (with few-shot examples) + user prompt (per-order).
//   4. Call ai.generateObject() with storyOutputSchema.
//   5. Return parsed StoryOutput + token usage + cost estimate.
//
// Errors bubble up — caller decides retry vs failure (orchestration layer).

import { generateObject } from "ai";
import { eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { aiSettings } from "../../db/schema.js";
import type {
  Order,
  Theme,
  MoralValue,
  SupportingCharacter,
} from "../../db/schema.js";
import { storyOutputSchema, type StoryOutput } from "./schemas/story.js";
import { buildStorySystemPrompt } from "./prompts/story-system-prompt.js";
import { buildStoryUserPrompt } from "./prompts/build-story-user-prompt.js";
import { resolveTextModel, estimateCostCents } from "./router.js";

export interface GenerateStoryInput {
  order: Order;
  theme: Theme;
  moralValue: MoralValue;
  supportingCharacters: SupportingCharacter[];
}

export interface GenerateStoryResult {
  story: StoryOutput;
  modelId: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostCents: number | null;
  durationMs: number;
}

export async function generateStory(
  input: GenerateStoryInput,
): Promise<GenerateStoryResult> {
  const settings = await loadAiSettings();

  if (!input.order.childAgeBand) {
    throw new Error(
      `order.childAgeBand is required for story generation (orderId=${input.order.id})`,
    );
  }
  const ageBand = input.order.childAgeBand as "3-5" | "5-7" | "6-8";

  const systemPrompt = buildStorySystemPrompt({
    ageBand,
    pageCount: settings.illustrationCount,
  });
  const userPrompt = buildStoryUserPrompt({
    ...input,
    pageCount: settings.illustrationCount,
  });

  const resolved = resolveTextModel(settings.storyModel);

  const startedAt = Date.now();
  const result = await generateObject({
    model: resolved.model,
    schema: storyOutputSchema,
    system: systemPrompt,
    prompt: userPrompt,
    maxTokens: settings.storyMaxTokens,
  });
  const durationMs = Date.now() - startedAt;

  const inputTokens = result.usage?.promptTokens ?? 0;
  const outputTokens = result.usage?.completionTokens ?? 0;

  const estimatedCostCents = estimateCostCents({
    modelId: resolved.modelId,
    inputTokens,
    outputTokens,
  });

  // Hard-validate that the AI honored core invariants — the schema enforces
  // shape, but page-count and moralMoment-cardinality are runtime checks.
  enforceInvariants(result.object, settings.illustrationCount);

  return {
    story: result.object,
    modelId: resolved.modelId,
    provider: resolved.provider,
    inputTokens,
    outputTokens,
    estimatedCostCents,
    durationMs,
  };
}

async function loadAiSettings() {
  const rows = await db
    .select()
    .from(aiSettings)
    .where(eq(aiSettings.id, "singleton"))
    .limit(1);
  const row = rows[0];
  if (!row) {
    throw new Error(
      "ai_settings singleton row missing. Run `pnpm db:seed:ai-settings`.",
    );
  }
  return row;
}

function enforceInvariants(story: StoryOutput, expectedPageCount: number) {
  if (story.pages.length !== expectedPageCount) {
    throw new Error(
      `Story page count mismatch: got ${story.pages.length}, expected ${expectedPageCount}`,
    );
  }

  const moralMomentPages = story.pages.filter((p) => p.moralMoment);
  if (moralMomentPages.length !== 1) {
    throw new Error(
      `Story must have EXACTLY 1 moralMoment page; got ${moralMomentPages.length}`,
    );
  }

  // Page numbers should be 1..N consecutive.
  for (let i = 0; i < story.pages.length; i++) {
    if (story.pages[i]!.number !== i + 1) {
      throw new Error(
        `Story pages must be numbered 1..N consecutively; page ${i} has number ${story.pages[i]!.number}`,
      );
    }
  }
}
