// Multi-provider model router.
// Routes a model string (e.g. "gpt-4o-mini", "claude-sonnet-4-5", "gemini-2.5-flash")
// to the right Vercel AI SDK provider adapter. The returned LanguageModelV1 is
// consumable by ai.generateObject() / generateText().
//
// Keeping the routing in one place means the rest of the pipeline doesn't care
// which provider is in use — the admin singleton row (ai_settings.story_model)
// is the only switch.
//
// Per ADR-006: prod targets Claude Sonnet 4.5 for story.
// Per session 9.5 dev mode: gpt-4o-mini chosen because Ahmed has OpenAI credits.

import { openai } from "@ai-sdk/openai";
import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";
import type { LanguageModelV1 } from "ai";

export type SupportedProvider = "openai" | "anthropic" | "google";

export interface ResolvedModel {
  provider: SupportedProvider;
  modelId: string;
  model: LanguageModelV1;
}

export function resolveTextModel(modelString: string): ResolvedModel {
  if (modelString.startsWith("gpt-") || modelString.startsWith("o1-")) {
    return {
      provider: "openai",
      modelId: modelString,
      model: openai(modelString),
    };
  }

  if (modelString.startsWith("claude-")) {
    return {
      provider: "anthropic",
      modelId: modelString,
      model: anthropic(modelString),
    };
  }

  if (modelString.startsWith("gemini-")) {
    return {
      provider: "google",
      modelId: modelString,
      model: google(modelString),
    };
  }

  throw new Error(
    `Unknown model string: "${modelString}". Expected prefix gpt-/o1-/claude-/gemini-.`,
  );
}

// Cost-per-million-token estimates (USD), used for ai_settings cost tracking.
// Numbers as of 2026-05; refresh when admin panel adds the cost-config UI.
// Sources: OpenAI / Anthropic / Google public pricing pages.
const COST_TABLE: Record<
  string,
  { inputPerMillion: number; outputPerMillion: number }
> = {
  "gpt-4o-mini": { inputPerMillion: 0.15, outputPerMillion: 0.6 },
  "gpt-4o": { inputPerMillion: 2.5, outputPerMillion: 10.0 },
  "gpt-4.1": { inputPerMillion: 2.0, outputPerMillion: 8.0 },
  "claude-sonnet-4-5": { inputPerMillion: 3.0, outputPerMillion: 15.0 },
  "claude-haiku-4-5": { inputPerMillion: 1.0, outputPerMillion: 5.0 },
  "gemini-2.5-flash": { inputPerMillion: 0.3, outputPerMillion: 2.5 },
  "gemini-2.5-pro": { inputPerMillion: 1.25, outputPerMillion: 5.0 },
};

export function estimateCostCents(args: {
  modelId: string;
  inputTokens: number;
  outputTokens: number;
}): number | null {
  const rates = COST_TABLE[args.modelId];
  if (!rates) return null;
  const inputCost =
    (args.inputTokens / 1_000_000) * rates.inputPerMillion;
  const outputCost =
    (args.outputTokens / 1_000_000) * rates.outputPerMillion;
  // Convert dollars → cents, round to nearest cent.
  return Math.round((inputCost + outputCost) * 100);
}
