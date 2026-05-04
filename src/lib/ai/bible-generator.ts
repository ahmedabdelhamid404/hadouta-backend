// Bible generator — the "Step 2" of the AI pipeline (after story generation).
// Produces a validated Bible from the story + wizard inputs, optionally using
// a vision-model description of the customer's uploaded photo.
//
// Per docs/design/specs/2026-05-03-illustration-pipeline-redesign-spec.md §5.

import { generateObject, generateText } from "ai";
import { openai } from "@ai-sdk/openai";
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
  /** AI router model id — defaults to gpt-4o (per user instruction 2026-05-05).
   * NEVER gpt-4o-mini (see feedback memory). */
  modelId?: string;
}

export interface BibleGeneratorInternalOptions {
  /** For unit tests: override the vision call entirely. */
  _visionCallOverride?: (photoUrl: string) => Promise<{ text: string }>;
}

/**
 * Calls gpt-4o (NOT gpt-4o-mini — meaningfully weaker at multimodal) to extract
 * identity-anchoring facts from a customer-uploaded child photo. Returns 2–4
 * sentences in English describing hair, skin, eyes, distinguishing features,
 * AND any traditional/cultural clothing visible — no background, no personality
 * speculation, no name. The result feeds the Bible's mainChild appearance +
 * outfit blocks.
 *
 * Per Phase H verification (2026-05-04): gpt-4o-mini missed a white Egyptian
 * galabeya entirely, producing generic "colorful t-shirt" outfit guesses.
 * Vision quality is worth the small cost increase (~$0.005 per book).
 */
async function describePhoto(photoUrl: string): Promise<string> {
  const result = await generateText({
    model: openai("gpt-4o"),
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Describe the child in this photo for a children's book illustrator. You MUST cover three things: (1) FACE features — hair (color, type, length, style — be specific about whether bangs/fringe are present and how they fall), skin tone, eye shape and color, distinguishing features (dimples, freckles, glasses, gap teeth, scars, etc.). (2) CLOTHING — describe what the child is wearing in detail. If they're wearing traditional cultural clothing (galabeya / thobe / hijab / abaya / etc.), name it explicitly — this is critical because the illustrator will lock the outfit across the entire 17-page book. Do NOT default to generic 't-shirt + shorts' if traditional clothing is visible. (3) If shoes are visible, describe them too. Do NOT include the background, the photographer's intent, or speculate about emotion / personality. Output 2–4 sentences in ENGLISH only. Do NOT include the child's name. Just visual facts that anchor identity across illustrated scenes.",
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

  const modelId = input.modelId ?? "gpt-4o";
  const resolved = resolveTextModel(modelId);

  // If photoUrl set and no pre-supplied description, call vision model.
  // Test-override takes precedence so unit tests don't hit a real provider.
  let photoDescription = wizardData.photoDescription ?? null;
  if (wizardData.photoUrl && !photoDescription) {
    photoDescription = internal._visionCallOverride
      ? (await internal._visionCallOverride(wizardData.photoUrl)).text
      : await describePhoto(wizardData.photoUrl);
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
