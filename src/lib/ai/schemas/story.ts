// Zod schema for the story output produced by the story generator.
// Shape mirrors the few-shot examples in src/lib/ai/prompts/story-examples/
// so generateObject() returns structured JSON the rest of the pipeline can
// trust without ad-hoc parsing.
//
// New per-page fields adopted from session 9.7 HekayaAI critical review:
//   - act: "setup" | "challenge" | "resolution" — three-act structure tag
//   - emotionalBeat: short English label of the page's emotional beat
//   - moralMoment: boolean flag on the single page where the moral lands
//
// Story-level additions:
//   - coverDescription: separate from page 1; iconic + emotional summary
//   - parentDiscussionQuestion: open-ended Arabic question for parent→child
//
// Validators framework (Sprint 2 v1) reads these flags directly.

import { z } from "zod";

export const storyActSchema = z.enum(["setup", "challenge", "resolution"]);

export const storyPageSchema = z.object({
  number: z
    .number()
    .int()
    .min(1)
    .describe("1-indexed page number; cover is separate, not in this array"),
  act: storyActSchema.describe(
    "Three-act tag. ~25% setup / ~50% challenge / ~25% resolution.",
  ),
  emotionalBeat: z
    .string()
    .min(3)
    .max(120)
    .describe(
      "Short English label of the page's emotional beat — feeds illustration AI mood guidance and admin reviewer scan.",
    ),
  moralMoment: z
    .boolean()
    .describe(
      "true on EXACTLY one page across the story — the page where the moral is most clearly demonstrated through the protagonist's action (not declared).",
    ),
  text: z
    .string()
    .min(10)
    .describe(
      "Arabic page text. Mixed register: simplified MSA narration + Egyptian Arabic dialogue (in « » marks). Selective diacritics per age band. Word count scaled by age band.",
    ),
  illustrationPrompt: z
    .string()
    .min(20)
    .describe(
      "English illustration prompt for this page. Must include: subject + action + setting + watercolor style anchor + Cairo middle-class context.",
    ),
});

export type StoryPage = z.infer<typeof storyPageSchema>;

export const storyOutputSchema = z.object({
  title: z
    .string()
    .min(3)
    .describe(
      "Arabic title featuring the child's name. Selective diacritics on the name and key nouns. Should sound like a real children's book title (not '[Child Name] and the [Theme]').",
    ),
  dedication: z
    .string()
    .min(10)
    .describe(
      "Arabic dedication line on the inside cover. Personal, warm, ties to the moral — not generic. Example shape: 'إلى لَيْلَى — أحلى حاجة تَعْطِيها هي اللي بتغلى عَلَيكي'.",
    ),
  coverDescription: z
    .string()
    .min(30)
    .describe(
      "English illustration prompt for the COVER (separate from page 1). Iconic + emotional summary of the whole story. Should not duplicate page 1's opening-scene framing.",
    ),
  parentDiscussionQuestion: z
    .string()
    .min(15)
    .describe(
      "Arabic open-ended question for the parent to ask the child after reading. Egyptian dialect (parent voice). Connects the moral back to the child's life.",
    ),
  pages: z
    .array(storyPageSchema)
    .min(4)
    .max(20)
    .describe(
      "Body pages array. Length is enforced separately by the caller from ai_settings.illustrationCount (default 8). Cover is NOT in this array.",
    ),
});

export type StoryOutput = z.infer<typeof storyOutputSchema>;

// Convenience helper used by validators + admin UI.
export function findMoralMomentPage(
  story: StoryOutput,
): StoryPage | undefined {
  return story.pages.find((p) => p.moralMoment);
}
