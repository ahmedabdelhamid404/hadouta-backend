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
 * sentences in English describing hair, skin tone, eyes, distinguishing
 * features, AND any traditional/cultural clothing visible — no background,
 * no personality speculation, no name. The result feeds the Bible's mainChild
 * appearance + outfit blocks.
 *
 * 2026-05-06 rewrite (per AI Engineer audit Gaps E+F+G):
 *   - Image placed BEFORE the text (Azure OpenAI vision docs: improves
 *     attention-to-image-detail measurably)
 *   - Two-step "describe-first-then-extract" structure (Microsoft + OpenAI
 *     vision docs explicitly recommend this for higher accuracy)
 *   - Anchored skin-tone vocabulary (very fair / fair / light olive / olive
 *     / tan / medium brown / deep brown / very deep) — without anchors the
 *     description drifts between calls ("warm tan" vs "olive" vs "wheat"
 *     for the same photo) and the Bible's downstream skinTone field becomes
 *     unstable
 *   - Explicit "flag uncertainty" instruction so the model says "I can't
 *     tell" instead of confidently confabulating (the canonical Phase H
 *     galabeya miss was a confident-but-wrong vision call on an ambiguous
 *     torso shot)
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
          // Image first — Azure OpenAI vision docs recommend image-before-text
          // for single-image prompts to improve attention-to-image-detail.
          { type: "image", image: photoUrl },
          {
            type: "text",
            text: `You are extracting visual identity facts from a child photo for a 17-page picture-book illustrator who will see your description but not the photo itself.

STEP 1 — Look carefully at the image. Note (silently, do not output): hair details, skin tone, eye details, distinguishing features, what they're wearing top-to-bottom, and any culturally specific clothing.

STEP 2 — Output a 2–4 sentence description in ENGLISH covering exactly:

(1) FACE — hair (color; type [straight / wavy / curly / coily]; length; style — be specific about whether bangs/fringe are present and how they fall), skin tone (use ONE of these anchor terms: very fair / fair / light olive / olive / tan / medium brown / deep brown / very deep — pick the closest match, do NOT invent freeform terms like "wheat" or "warm tan"), eye shape and color, distinguishing features (dimples, freckles, glasses, gap teeth, scars, birthmarks).

(2) CLOTHING — describe what the child is wearing in detail. If traditional or culturally specific clothing is visible (galabeya / thobe / hijab / abaya / kuttab cap / festive Eid dress / school uniform / etc.), NAME IT EXPLICITLY. The illustrator will lock the outfit across all 17 pages of the book, so do NOT default to "t-shirt and shorts" if traditional clothing is actually visible.

(3) SHOES — only if visible.

DO NOT include: the background, the photographer's intent or composition, the child's emotion or personality, the child's name, or any guess about details that aren't clearly visible.

UNCERTAINTY HANDLING — if any of the three categories above is ambiguous in the photo (e.g. torso cropped so you can't tell if there's traditional clothing, face partially in shadow, only head visible), say so EXPLICITLY rather than guessing. Examples:
  - "Clothing not clearly visible — only face and shoulders are in frame."
  - "Eye color not readable in this lighting."
  - "Hair length unclear — visible portion only goes to shoulders."
The illustrator can fall back to defaults if you flag uncertainty; a confident wrong description (e.g. confabulating a t-shirt when the torso isn't visible) locks an incorrect outfit across all 17 pages.`,
          },
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
