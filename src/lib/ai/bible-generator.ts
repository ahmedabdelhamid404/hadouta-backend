// Bible generator — the "Step 2" of the AI pipeline (after story generation).
// Produces a validated Bible from the story + wizard inputs, optionally using
// a vision-model description of the customer's uploaded photo.
//
// Per docs/design/specs/2026-05-03-illustration-pipeline-redesign-spec.md §5.

import { generateObject, generateText } from "ai";
import type { LanguageModelV1 } from "ai";
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

/**
 * Calls a vision-capable model (gpt-4o or similar) to extract identity-anchoring
 * facts from a customer-uploaded child photo. Returns 1-3 sentences in English
 * describing hair, skin, eyes, distinguishing features — no background, no
 * personality speculation, no name. The result feeds the Bible's mainChild
 * appearance block.
 */
async function describePhoto(
  photoUrl: string,
  model: LanguageModelV1,
): Promise<string> {
  const result = await generateText({
    model,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Describe the child in this photo for a children's book illustrator. Focus on: hair (color, type, length, style), skin tone, eye color/shape, distinguishing features (dimples, freckles, glasses, gap teeth, etc.). Do NOT include the background or the photographer's intent. Output 1–3 sentences in ENGLISH only. Do NOT include the child's name. Do NOT speculate about emotion or personality. Just visual facts that anchor identity across illustrated scenes.",
          },
          { type: "image", image: photoUrl },
        ],
      },
    ],
    temperature: 0.2,
  });
  return result.text.trim();
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

  // If photoUrl set and no pre-supplied description, call vision model.
  // Test-override takes precedence so unit tests don't hit a real provider.
  let photoDescription = wizardData.photoDescription ?? null;
  if (wizardData.photoUrl && !photoDescription) {
    photoDescription = internal._visionCallOverride
      ? (await internal._visionCallOverride(wizardData.photoUrl)).text
      : await describePhoto(wizardData.photoUrl, resolved.model);
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
