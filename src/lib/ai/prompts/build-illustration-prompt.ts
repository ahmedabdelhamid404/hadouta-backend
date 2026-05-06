// Deterministically assembles a per-page illustration prompt from
// Bible + scene + per-page metadata. Pure function — no AI calls.
//
// Design (2026-05-06 rewrite): structured for Nano Banana 2 / Gemini 3.1 Flash
// Image (autoregressive multimodal, NOT a diffusion model). Per AI Engineer
// research dispatched 2026-05-06 + sources documented inline:
//
//   - Sectioned natural-language prompt, NOT comma-separated tag soup
//     (Google Cloud + fal.ai docs)
//   - Five-pillar Google structure expanded to:
//     REFERENCE ROLES → SUBJECT → COMPOSITION → ACTION → SETTING/PROPS
//     → OTHER CHARACTERS → IDENTITY PRESERVATION → STYLE → CONSTRAINTS
//   - Image-N role labeling for reference photos
//     (fal.ai multi-image guide + Google blog "prompting tips Nano Banana Pro")
//   - Identity-anchor language: "use these photos for [child name] ONLY,
//     do not use them for any other character" — explicit disambiguation
//     prevents the Phase-1 mother-as-teenage-protagonist failure mode
//   - Per-character distinct trait declaration (anti-bias for adults requires
//     explicit "NOT a teenager" + age + grey/smile-line anchors — Bible-gen
//     produces these in supportingCharacters[].appearance per the rewrite
//     in bible-system-prompt.ts)
//   - Verbatim prop reference (declare in SETTING + repeat in ACTION) prevents
//     accessory drift across pages
//   - 60% frame height for hero composition (rule-of-thirds + speakipedia
//     children's-book layout convention)
//   - Inline negatives ≤75 tokens / 3–5 items (long negatives hurt the
//     reasoning planner per pixeldojo + sider.ai)
//
// Per docs/design/specs/2026-05-03-illustration-pipeline-redesign-spec.md §5.4
// + Sprint 3 buildIllustrationPrompt rewrite (2026-05-06).

import type { Bible } from "../schemas/bible.js";

export interface BuildIllustrationPromptArgs {
  bible: Bible;
  /** Short English scene description: action + per-page emotional moment. */
  scene: string;
  /** 0 = cover; 1..N = body pages. Used to apply outfit variations. */
  pageNumber: number;
  /** True if customer photos are passed as image_urls to the model.
   *  When true, the prompt includes Image-N role labeling + identity-anchor
   *  language. When false (no photos uploaded), those references are skipped
   *  to avoid orphan "Image 1" mentions confusing the model. */
  hasReferencePhotos: boolean;
  /** Names of characters visible on this page (matches Bible.characterBible
   *  .supportingCharacters[].name). Body pages: pass story.pages[]
   *  .charactersOnPage. Cover: omit or pass [protagonist]. */
  charactersOnPage?: string[];
  /** Specific visual prop anchoring the page (5–80 chars).
   *  Body pages: pass story.pages[].keyObjectOrDetail. Cover: optional. */
  keyObjectOrDetail?: string;
}

export interface IllustrationPrompt {
  positive: string;
  /** Always empty — Nano Banana 2 has no separate negative_prompt field
   *  (per fal.ai dev guide); constraints are folded into positive as the
   *  final CONSTRAINTS block. The illustration generator's "Avoid: X"
   *  wrap is therefore skipped (it falsy-checks negative). */
  negative: string;
}

export function buildIllustrationPrompt(
  args: BuildIllustrationPromptArgs,
): IllustrationPrompt {
  const {
    bible,
    scene,
    pageNumber,
    hasReferencePhotos,
    charactersOnPage,
    keyObjectOrDetail,
  } = args;
  const child = bible.characterBible.mainChild;
  const isCover = pageNumber === 0;
  const outfit = resolveOutfit(child.outfit, pageNumber);

  // === REFERENCE IMAGE ROLES preamble ===
  // Only included when customer photos are actually attached to the call.
  // The Image-N role labeling pattern is documented as the highest-leverage
  // technique for identity preservation across fal.ai + Google Cloud + selfielab
  // multi-character guides.
  const referenceRoles = hasReferencePhotos
    ? `[REFERENCE IMAGES] Image 1${charactersOnPage && charactersOnPage.length > 0 ? " (and Image 2, Image 3 if provided)" : ""} are reference photos of ${child.name}, the ${child.age}-year-old ${child.gender} protagonist of this story. Treat them as IDENTITY ANCHORS for ${child.name} ONLY: render ${child.name}'s face — eye shape, nose, mouth, skin tone, hair texture and color — to match these reference photos exactly. Treat them as a likeness specification, not as style guides. Do NOT use these photos as a reference for any other character in the scene.`
    : "";

  // === SUBJECT block — character bible (locked appearance, repeated verbatim
  // on every page so the protagonist holds across the 17-page sequence). ===
  const subjectParts: (string | null)[] = [
    `${child.name}, a ${child.age}-year-old Egyptian ${child.gender}`,
    `Hair: ${child.appearance.hair}`,
    `Skin: ${child.appearance.skin}`,
    `Eyes: ${child.appearance.eyes}`,
    child.appearance.distinguishing
      ? `Distinguishing features: ${child.appearance.distinguishing}`
      : null,
    `Wearing: ${outfit}`,
    `Body language: ${child.personalityVisual}`,
  ];
  const subjectBlock = `[SUBJECT] ${subjectParts.filter(Boolean).join(". ")}.`;

  // === COMPOSITION & CAMERA block ===
  // Cover has its own composition rule (upper two-thirds; bottom neutral
  // because the PDF cover layout fades the bottom 32px into cream paper).
  // Body pages get the 60/40 hero-prominence + rule-of-thirds anchoring.
  const compositionBlock = isCover
    ? `[COMPOSITION & CAMERA] Cover composition: ${child.name} centered in the upper two-thirds of the frame. Bottom one-third should be neutral (no critical elements like faces, key props, hands, or text near the bottom — the PDF cover layout fades the bottom edge into cream paper, anything important there will be lost). Face clearly readable at thumbnail size. ${bible.styleBible.compositionAnchors}`
    : `[COMPOSITION & CAMERA] ${child.name} occupies approximately 60% of the frame's vertical height, positioned at one of the rule-of-thirds intersections (not dead-center). Setting fills the remaining 40% as supporting context. ${child.name}'s face is clearly readable at thumbnail size. ${bible.styleBible.compositionAnchors}`;

  // === ACTION & EMOTION block ===
  // The scene description from the story; per AI Engineer research, this is
  // most effective when phrased with mid-X verbs + body mechanics + facial
  // microexpression. The story prompt instructs the writer to produce scene
  // descriptions in this shape; we just frame it explicitly here.
  const actionBlock = isCover
    ? `[COVER SCENE] Iconic emotional summary of the entire story: ${scene}. The composition must center on this exact moment with rich visible detail — action, supporting characters, setting elements, props.`
    : `[ACTION & EMOTION — page ${pageNumber}] This specific page MUST depict: ${scene}. Render the action, framing, and visible elements to communicate THIS moment specifically — different from any other page in the book.`;

  // === SETTING & PROPS block ===
  // Setting from Bible. The keyObjectOrDetail is also surfaced here AND
  // referenced again in the CONSTRAINTS area to anchor the prop verbatim
  // (anti-drift technique per AI Engineer research).
  const settingParts: string[] = [
    bible.settingBible.primaryLocation,
    bible.settingBible.primaryLocationDetails,
  ];
  if (keyObjectOrDetail) {
    settingParts.push(
      `Key prop visible in this scene: ${keyObjectOrDetail}. Render this exact prop precisely as described — same form, color, and material every time it appears across the book.`,
    );
  }
  const cultureSentence =
    bible.culturalNotes.length > 0
      ? ` Cultural anchors (CRITICAL — render exactly): ${bible.culturalNotes.join(". ")}.`
      : "";
  const settingBlock = `[SETTING & PROPS] ${settingParts.join(" — ")}.${cultureSentence}`;

  // === OTHER CHARACTERS PRESENT block ===
  // Pull supporting characters from the Bible whose name appears in
  // charactersOnPage (excluding the protagonist — they're in SUBJECT).
  // For each, paste their appearance verbatim so the model has explicit
  // age + distinguishing-feature anchors to avoid blending with the
  // protagonist's reference-photo features.
  const otherCharactersBlock = buildOtherCharactersBlock(
    child.name,
    bible.characterBible.supportingCharacters,
    charactersOnPage,
    hasReferencePhotos,
  );

  // === IDENTITY PRESERVATION block (body pages only) ===
  // Cross-page consistency directive. Cover doesn't need this (it's page 0,
  // no prior pages to be consistent with — the cover defines the baseline).
  const identityPreservationBlock = isCover
    ? ""
    : `[IDENTITY PRESERVATION — non-negotiable across the 17-page sequence] ${child.name}'s face must be unmistakably recognizable as the SAME child as in the reference photos and on every other page of this book. Render the SAME face shape, SAME eye shape and color, SAME hair texture and styling (if reference photos show specific hair styling like a ponytail with a bow, render that exact styling — do NOT change the hairstyle), SAME distinguishing features. OUTFIT CONTINUITY: render the SAME outfit listed in [SUBJECT] above ("${outfit}") — same colors, same items, same accessories — UNLESS this page explicitly shows the child changed clothes.`;

  // === STYLE block ===
  // Pulled from Bible.styleBible (which Bible-gen now produces in Pixar-3D
  // register by default per ADR-027 + the bible-system-prompt rewrite).
  const styleBlock = `[STYLE] ${bible.styleBible.medium}. Palette: ${bible.styleBible.palette}. Lighting: ${bible.styleBible.light}.`;

  // === CONSTRAINTS block (the "negative") — placed at end ===
  // Per Google's Gemini 3 dev guide: critical constraints belong at the END
  // of the prompt for instruction-following. Bible-gen produces a short
  // negativeStyle (≤75 tokens / 3–5 items) per the new rewrite; we use it
  // verbatim here.
  const constraintsBlock = `[CONSTRAINTS] ${bible.styleBible.negativeStyle}`;

  const positive = [
    referenceRoles,
    subjectBlock,
    compositionBlock,
    actionBlock,
    settingBlock,
    otherCharactersBlock,
    identityPreservationBlock,
    styleBlock,
    constraintsBlock,
  ]
    .filter((s) => s && s.length > 0)
    .join("\n\n");

  return {
    positive,
    negative: "",
  };
}

function buildOtherCharactersBlock(
  protagonistName: string,
  supportingCharacters: Bible["characterBible"]["supportingCharacters"],
  charactersOnPage: string[] | undefined,
  hasReferencePhotos: boolean,
): string {
  if (!charactersOnPage || charactersOnPage.length === 0) return "";

  const otherNames = charactersOnPage.filter(
    (n) => n.toLowerCase() !== protagonistName.toLowerCase(),
  );
  if (otherNames.length === 0) {
    return `[OTHER CHARACTERS] ${protagonistName} is alone in this scene.`;
  }

  // Match charactersOnPage names against Bible.supportingCharacters by name
  // (case-insensitive). Bible's name should match story's transliteration
  // per the bible-system-prompt instructions.
  const matched = supportingCharacters.filter((sc) =>
    otherNames.some((n) => n.toLowerCase() === sc.name.toLowerCase()),
  );
  const unmatched = otherNames.filter(
    (n) =>
      !supportingCharacters.some(
        (sc) => sc.name.toLowerCase() === n.toLowerCase(),
      ),
  );

  const photoDisclaimer = hasReferencePhotos
    ? ` The reference photos apply ONLY to ${protagonistName}; generate every character below from their description, do NOT blend ${protagonistName}'s reference-photo features into them.`
    : "";

  const matchedDescriptions = matched
    .map((sc) => `- ${sc.name} (${sc.relationship}): ${sc.appearance}`)
    .join("\n");

  const unmatchedNote =
    unmatched.length > 0
      ? `\n- Also present (no Bible entry — render with a distinct face from ${protagonistName} and a generic Egyptian appearance): ${unmatched.join(", ")}.`
      : "";

  if (matched.length === 0) {
    return `[OTHER CHARACTERS] Present in this scene: ${otherNames.join(", ")}. Each must have a distinct face from ${protagonistName}.${photoDisclaimer}`;
  }

  return `[OTHER CHARACTERS] The following characters are present in this scene. Each has a distinct face from ${protagonistName}. Render each from their description below — do NOT blend the protagonist's features into them.${photoDisclaimer}\n${matchedDescriptions}${unmatchedNote}`;
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

// =============================================================================
// Legacy helper — kept for the alt `flux-kontext-pixar` provider path in
// illustration-generator.ts. The default `nano-banana` path no longer needs
// this because the Bible-gen rewrite (2026-05-06) produces Pixar-friendly
// styleBible by default and buildIllustrationPrompt above assembles the
// Pixar register from those Bible fields automatically. Sprint 3 cleanup
// will remove this helper along with the flux-kontext-pixar provider.
// =============================================================================

const PIXAR_STYLE_ANCHOR =
  "Pixar 3D animated style, in the visual register of Disney Encanto / Coco / " +
  "Inside Out — stylized 3D rendering, soft volumetric lighting, expressive " +
  "3D-rendered facial features, smooth subsurface scattering on skin, warm " +
  "cinematic color grading. Cartoon, stylized, NOT photorealistic, NOT " +
  "watercolor, NOT 2D-flat, NOT a real photo. " +
  "ABSOLUTELY NO text, typography, titles, labels, captions, or written " +
  "words of any kind anywhere in the image — the illustration must be pure " +
  "visual storytelling with zero rendered text (titles and book typography " +
  "are added later by a separate layer). " +
  "Maintain Egyptian cultural specificity in costuming, setting, and props " +
  "as described.";

/**
 * Prepend Pixar-3D style anchor language to a prompt string.
 *
 * Used only by the alt `flux-kontext-pixar` illustration provider.
 * The default `nano-banana` path no longer needs this — Bible-gen produces
 * Pixar-register styleBible automatically.
 *
 * Idempotent: if the anchor is already present, returns the prompt unchanged.
 */
export function appendPixarStyleAnchor(prompt: string): string {
  if (prompt.includes("Pixar 3D animated style")) return prompt;
  return `${PIXAR_STYLE_ANCHOR} ${prompt}`;
}
