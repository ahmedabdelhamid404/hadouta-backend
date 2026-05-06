// Deterministically assembles a per-page illustration prompt from
// Bible + scene. The Bible owns character/setting/style/cultural anchors;
// the scene addendum says "what's unique on this page."
//
// This function is the bridge between the structured Bible and the text
// prompt the image model expects. Pure function — no AI calls.
//
// Per docs/design/specs/2026-05-03-illustration-pipeline-redesign-spec.md §5.4.

import type { Bible } from "../schemas/bible.js";

export interface BuildIllustrationPromptArgs {
  bible: Bible;
  scene: string;
  /** 0 = cover; 1..N = body pages. Used to apply outfit variations. */
  pageNumber: number;
}

export interface IllustrationPrompt {
  positive: string;
  negative: string;
}

export function buildIllustrationPrompt(
  args: BuildIllustrationPromptArgs,
): IllustrationPrompt {
  const { bible, scene, pageNumber } = args;

  // Character block — locked appearance.
  const child = bible.characterBible.mainChild;
  const outfit = resolveOutfit(child.outfit, pageNumber);
  const characterParts: (string | null)[] = [
    `Egyptian ${child.gender}, ${child.age} years old`,
    `hair: ${child.appearance.hair}`,
    `skin: ${child.appearance.skin}`,
    `eyes: ${child.appearance.eyes}`,
    child.appearance.distinguishing
      ? `distinguishing features: ${child.appearance.distinguishing}`
      : null,
    `wearing ${outfit}`,
    `personality cues: ${child.personalityVisual}`,
  ];
  const characterBlock = characterParts.filter(Boolean).join(", ");

  // Setting block.
  const settingBlock = [
    `setting: ${bible.settingBible.primaryLocation}`,
    bible.settingBible.primaryLocationDetails,
  ].join(" — ");

  // Style block.
  const styleBlock = [
    bible.styleBible.medium,
    `palette: ${bible.styleBible.palette}`,
    `light: ${bible.styleBible.light}`,
  ].join(", ");

  // Cultural notes.
  const cultureBlock =
    bible.culturalNotes.length > 0
      ? `Cultural anchors (CRITICAL — render exactly as described): ${bible.culturalNotes.join(". ")}.`
      : "";

  // Composition anchors apply per page.
  const compositionBlock = `composition: ${bible.styleBible.compositionAnchors}`;

  // SCENE block: emphasized + repeated to push the model toward per-page
  // differentiation. Phase H iteration 4 showed Nano Banana anchoring on the
  // first/strongest signal; making the per-page scene the loudest signal helps
  // each illustration depict its own moment rather than echo prior pages.
  //
  // Iteration 7 addition: explicit FACE PRESERVATION instruction for body
  // pages — supplements the photo image reference with natural-language
  // direction. Gemini blends text+image signals; the prompt language reinforces
  // the photo reference's identity signal without adding image-ref weight that
  // would drag scene composition.
  const sceneBlock =
    pageNumber === 0
      ? `COVER SCENE — this is the iconic opening illustration: ${scene}. The composition must center on this exact moment with rich visible detail (action, supporting characters, setting elements, props).`
      : `PAGE ${pageNumber} SCENE — this specific page MUST depict: ${scene}. The action, framing, and visible elements must communicate THIS moment specifically — different from any other page in the book. Make the composition unique to this scene. CRITICAL — IDENTITY PRESERVATION: the child's face must EXACTLY match the reference photo — same face shape, same eye shape and color, same hair color AND HAIR STYLING (if reference photo shows a ponytail with a bow, this page MUST also show a ponytail with the same bow in the same position; if pigtails, render pigtails; if loose, render loose — do NOT change the hairstyle), same distinguishing features (dimples, gap teeth, freckles, etc.). OUTFIT CONTINUITY: the child wears the SAME outfit (above: "${outfit}") that is rendered on every other page of this book — same colors, same items, same accessories — UNLESS this page explicitly says the child changed clothes. Do not invent or vary the child's facial features, hair styling, or outfit; render the SAME child wearing the SAME outfit as the rest of the book. Identity and outfit continuity across pages is non-negotiable.`;

  const positive = [
    styleBlock,
    settingBlock,
    characterBlock,
    sceneBlock, // moved up for prominence
    cultureBlock,
    compositionBlock,
  ]
    .filter((s) => s && s.length > 0)
    .join(". ");

  return {
    positive,
    negative: bible.styleBible.negativeStyle,
  };
}

function resolveOutfit(
  outfit: Bible["characterBible"]["mainChild"]["outfit"],
  pageNumber: number,
): string {
  if (pageNumber === 0) return outfit.default;
  for (const variation of outfit.variations) {
    if (variation.pageNumbers.includes(pageNumber)) {
      return variation.description;
    }
  }
  return outfit.default;
}

// Pixar 3D anchor — front-loaded so the Canopus LoRA's trigger word ("Pixar 3D")
// hits the model first. Per HuggingFace model card, the LoRA activates strongest
// on the literal phrase "Pixar 3D"; placing it at prompt start gives strongest
// LoRA-weight engagement. Per iteration 2 (2026-05-06): explicit anti-watercolor
// negatives added because Bible's styleBible.negativeStyle was generated for the
// watercolor pipeline and contained "NOT 3D-rendered" which actively conflicted
// with the Pixar overlay.
const PIXAR_STYLE_ANCHOR =
  "Pixar 3D animated style, in the visual register of Disney Encanto / Coco / " +
  "Inside Out — stylized 3D rendering, soft volumetric lighting, expressive " +
  "3D-rendered facial features, smooth subsurface scattering on skin, warm " +
  "cinematic color grading. Cartoon, stylized, NOT photorealistic, NOT " +
  "watercolor, NOT 2D-flat, NOT a real photo. Maintain Egyptian cultural " +
  "specificity in costuming, setting, and props as described.";

/**
 * Prepend Pixar-3D style anchor language to a prompt string.
 *
 * Used by the `flux-kontext-pixar` illustration provider to overlay a
 * concrete style register on top of the Bible-driven prompt. The Bible
 * itself stays unchanged on disk — the override happens at prompt-assembly
 * time so we don't need to regenerate persisted Bibles for Phase 1.
 *
 * Anchor is PREPENDED (not appended) per Phase 1 iteration 2 finding: the
 * Canopus LoRA's trigger word "Pixar 3D" must hit the model first to activate
 * the LoRA's style weights with full strength. Idempotent: if the anchor is
 * already present, returns the prompt unchanged.
 */
export function appendPixarStyleAnchor(prompt: string): string {
  if (prompt.includes("Pixar 3D animated style")) return prompt;
  return `${PIXAR_STYLE_ANCHOR} ${prompt}`;
}
