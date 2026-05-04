// Bible generator — the "Step 2" of the AI pipeline (after story generation).
// Produces a validated Bible from the story + wizard inputs, optionally using
// a vision-model description of the customer's uploaded photo.
//
// Per docs/design/specs/2026-05-03-illustration-pipeline-redesign-spec.md §5.

import { generateObject } from "ai";
import { resolveTextModel } from "./router.js";
import { bibleSchema, type Bible } from "./schemas/bible.js";
import { buildBibleSystemPrompt } from "./prompts/bible-system-prompt.js";
import { getPersonaById } from "./personas.js";
import {
  findRelevantGlossaryEntries,
  type GlossaryEntry,
} from "./cultural-glossary.js";
import type { StoryOutput } from "./schemas/story.js";

export interface GenerateBibleInput {
  story: StoryOutput;
  wizardData: {
    childName: string;
    childAgeBand: "3-5" | "5-7" | "6-8";
    childAgeExact: number;
    childGender: "boy" | "girl";
    theme: string;
    moralValue: string;
    photoUrl: string | null;
    personaId: string | null;
    /** Optional: vision-model description if photoUrl is set. Filled by call site (Task 7). */
    photoDescription?: string | null;
    /** Optional: free-form child description from wizard (the "describe my own" escape). */
    childDescription?: string | null;
  };
  /** AI router model id — defaults to gpt-4o-mini for Bible. */
  modelId?: string;
}

export interface BibleGeneratorInternalOptions {
  /** For unit tests: override the vision call entirely. */
  _visionCallOverride?: (photoUrl: string) => Promise<{ text: string }>;
}

export async function generateBible(
  input: GenerateBibleInput,
  internal: BibleGeneratorInternalOptions = {},
): Promise<Bible> {
  const { wizardData, story } = input;

  if (
    !wizardData.personaId &&
    !wizardData.photoUrl &&
    !wizardData.childDescription
  ) {
    throw new Error(
      "[bible-generator] need either persona id, photo URL, or child description — got none",
    );
  }

  const modelId = input.modelId ?? "gpt-4o-mini";
  const resolved = resolveTextModel(modelId);

  // Vision path is wired in Task 7; for now, only honor a pre-supplied
  // photoDescription or the test-override.
  let photoDescription = wizardData.photoDescription ?? null;
  if (wizardData.photoUrl && !photoDescription && internal._visionCallOverride) {
    photoDescription = (await internal._visionCallOverride(wizardData.photoUrl)).text;
  }

  const persona = wizardData.personaId
    ? getPersonaById(wizardData.personaId) ?? null
    : null;

  // Find glossary entries triggered by story + wizard inputs.
  const haystack = [
    story.title,
    story.dedication,
    story.coverDescription,
    ...story.pages.map((p) => p.text),
    ...story.pages.map((p) => p.scene),
    wizardData.theme,
    wizardData.moralValue,
  ];
  const glossaryEntries: GlossaryEntry[] = findRelevantGlossaryEntries(haystack);

  const systemPrompt = buildBibleSystemPrompt({
    persona,
    photoDescription,
    childDescription: wizardData.childDescription ?? null,
    childName: wizardData.childName,
    childAgeExact: wizardData.childAgeExact,
    childGender: wizardData.childGender,
    themeAr: wizardData.theme,
    moralValueAr: wizardData.moralValue,
    glossaryEntries,
  });

  const userPromptParts: string[] = [
    "## Story to generate Bible for:\n",
    `### Title\n${story.title}\n`,
    `### Dedication\n${story.dedication}\n`,
    `### Cover description\n${story.coverDescription}\n`,
    `### Moral statement\n${story.moralStatement}\n`,
    "### Pages",
    ...story.pages.map((p) => `Page ${p.number} [${p.act}]: ${p.text}\n  Scene: ${p.scene}`),
  ];
  if (wizardData.childDescription) {
    userPromptParts.unshift(
      `### Customer's free-form child description\n${wizardData.childDescription}\n`,
    );
  }
  const userPrompt = userPromptParts.join("\n");

  const result = await generateObject({
    model: resolved.model,
    schema: bibleSchema,
    system: systemPrompt,
    prompt: userPrompt,
    temperature: 0.6,
  });

  return result.object;
}
