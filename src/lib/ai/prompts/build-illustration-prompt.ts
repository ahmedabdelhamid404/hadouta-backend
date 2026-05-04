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
      : `PAGE ${pageNumber} SCENE — this specific page MUST depict: ${scene}. The action, framing, and visible elements must communicate THIS moment specifically — different from any other page in the book. Make the composition unique to this scene. CRITICAL — IDENTITY PRESERVATION: the child's face must EXACTLY match the reference photo — same face shape, same eye shape and color, same hair texture and length, same distinguishing features (dimples, gap teeth, freckles, etc.). Do not invent or vary the child's facial features; render the SAME child as in the reference photo. Identity continuity across pages is non-negotiable.`;

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
