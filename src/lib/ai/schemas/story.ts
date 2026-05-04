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
  scene: z
    .string()
    .min(15, "scene must be ≥15 chars — short scene addendum, not a full prompt")
    .max(280, "scene must be ≤280 chars — keep it tight; the Bible carries the rest")
    .describe(
      "Short English scene addendum for THIS page. 1–2 sentences max. Describe ONLY what is unique to this page (action, location-within-setting, emotional moment). DO NOT include character description, style, or setting details — those come from the Bible. Example: 'Hena gathers kahk biscuits from a metal tray on the coffee table' — NOT 'Egyptian girl in apartment, watercolor style, gathering biscuits from a tray.'",
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
    .min(20)
    .max(280)
    .describe(
      "Short English scene description for the COVER page. Iconic + emotional summary of the whole story — 1–2 sentences. DO NOT include character/style/setting boilerplate (those come from the Bible). Example: 'Hena holding a tray of kahk surrounded by friends in her living room, golden afternoon light.'",
    ),
  parentDiscussionQuestion: z
    .string()
    .min(15)
    .describe(
      "Arabic open-ended question for the parent to ask the child after reading. Egyptian dialect (parent voice). Connects the moral back to the child's life.",
    ),
  moralStatement: z
    .string()
    .min(20, "moralStatement must be ≥20 chars")
    .max(220, "moralStatement must be ≤220 chars")
    .describe(
      "Single distilled sentence stating the moral as a takeaway, in Storyteller voice. Names the moral concept explicitly. Used on the end-page above 'النهاية'. Do NOT phrase as a question. Examples: 'وفي الآخر، عرفت ليلى إن العطاء بيدفي القلب.', 'وعرف يوسف إن الشجاعة مش غياب الخوف، الشجاعة إنك تعمل اللي صح حتى لو خايف.'",
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
