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
  /** Names of characters visible on this page (matches Bible.characterBible
   *  .supportingCharacters[].name). Body pages: pass story.pages[]
   *  .charactersOnPage. Cover: omit or pass [protagonist]. */
  charactersOnPage?: string[];
  /** Specific visual prop anchoring the page (5–80 chars).
   *  Body pages: pass story.pages[].keyObjectOrDetail. Cover: optional. */
  keyObjectOrDetail?: string;
  /** Location name for THIS page. UC6 fix (2026-05-10): when the story moves
   *  between settings (apartment → mosque → apartment), the prompt builder
   *  must inject the CORRECT location's locked details, not always primary.
   *  Match priority: settingBible.primaryLocation (case-insensitive substring
   *  OR exact) → settingBible.secondaryLocations[].name (exact, case-insensitive)
   *  → fall back to primary. Pass story.pages[].locationName for body pages,
   *  story.coverLocationName for the cover. Omit for single-setting stories. */
  locationName?: string;
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
    charactersOnPage,
    keyObjectOrDetail,
    locationName,
  } = args;
  const child = bible.characterBible.mainChild;
  const isCover = pageNumber === 0;
  const outfit = resolveOutfit(child.outfit, pageNumber);
  // V2 fix (2026-05-10): when the current page uses a variation outfit (NOT
  // the default), the [IDENTITY PRESERVATION] block must AFFIRM the outfit
  // change rather than treat it as a default-with-conditional-exception.
  // Without this, Gemini 3's planner stabilizes toward the default outfit
  // (~30% drift on multi-segment outfit stories like Eid → pajamas).
  const isVariationOutfit =
    !isCover && outfit !== child.outfit.default;

  // === REFERENCE IMAGE ROLES preamble ===
  // Customer photo upload is MANDATORY (founder lock-in 2026-05-10) so the
  // image_urls array is always: Images 1..N = customer photos (identity),
  // Image N+1 = static watercolor anchor (style). The no-photo branch was
  // removed since wizard enforces upload at order time.
  //
  // 2026-05-10 FACE-FIDELITY FIX: customer photos LEAD (Image 1..N) per
  // iter 8's empirically-proven pattern. Putting the static anchor first
  // (earlier attempt) regressed face fidelity — Gemini's planner gives
  // Image 1 ordinal priority, so identity must be Image 1, style must be
  // the LAST image.
  // V2: triple-anchored exclusion of Beatrix Potter subjects (rabbit, English
  // garden, terracotta pots, blue rabbit-jacket coloring) — appears here, in
  // [CONSTRAINTS], and in [STYLE LOCK] to suppress visual leakage.
  const referenceRoles = `[REFERENCE IMAGES — role-locked, do not blend roles]
- Image 1${charactersOnPage && charactersOnPage.length > 0 ? " (and Image 2, Image 3 if provided)" : ""} are reference photos of ${child.name}, the ${child.age}-year-old ${child.gender} protagonist. IDENTITY ANCHOR for ${child.name} ONLY: render her face, eye shape, skin tone, hair texture and styling to match these photos exactly. Treat as a likeness specification, NOT a style guide. Do NOT use these photos as a reference for any other character in the scene.
- The FINAL image is a STATIC WATERCOLOR REFERENCE (Beatrix Potter, 1902, public domain). STYLE ANCHOR ONLY: extract from it the watercolor medium, brushwork, wet-on-wet bleeds, paper texture, and warm cream color palette. IGNORE its subjects entirely. Do NOT render any rabbits, English garden plants, terracotta pots, blue jackets, or Edwardian-English imagery in the output — the reference is a watercolor TECHNIQUE swatch, not a scene to draw inspiration from. Apply the watercolor technique to Egyptian children and Cairo apartment settings as described in [STYLE] and [SETTING & PROPS].`;

  // === SUBJECT block — character bible (locked appearance, repeated verbatim
  // on every page so the protagonist holds across the 17-page sequence). ===
  // V12 fix (2026-05-10): trim() the distinguishing field before injecting —
  // gpt-4o sometimes returns whitespace-only strings, which leaked
  // "Distinguishing features:  ." into the prompt.
  const distinguishing = child.appearance.distinguishing?.trim();
  const subjectParts: (string | null)[] = [
    `${child.name}, a ${child.age}-year-old Egyptian ${child.gender}`,
    `Hair: ${child.appearance.hair}`,
    `Skin: ${child.appearance.skin}`,
    `Eyes: ${child.appearance.eyes}`,
    distinguishing ? `Distinguishing features: ${distinguishing}` : null,
    `Wearing: ${outfit}`,
    `Body language: ${child.personalityVisual}`,
  ];
  const subjectBlock = `[SUBJECT] ${subjectParts.filter(Boolean).join(". ")}.`;

  // === COMPOSITION & CAMERA block — full-body anti-crop ===
  // Body pages: head-to-toe full-body composition with ground-margin anchor.
  // Cover: upper two-thirds (PDF layout fades bottom edge for title placement).
  // Per iter 8 (2026-05-10): without explicit "feet to head" + ground-margin
  // language, Gemini 3 crops the central character's lower body to fit the
  // 3:4 aspect ratio while preserving peripheral characters' full bodies.
  const compositionBlock = isCover
    ? `[COMPOSITION & CAMERA — cover] ${child.name} centered in the upper two-thirds of the frame. Bottom one-third should be neutral (no critical elements like faces, key props, hands, or text near the bottom — the PDF cover layout fades the bottom edge into cream paper, anything important there will be lost). Face clearly readable at thumbnail size. ${bible.styleBible.compositionAnchors}`
    : `[COMPOSITION & CAMERA — full body, head-to-toe]
- This is a FULL-BODY shot. Every character (including ${child.name}) is rendered head-to-toe — no character is cropped at the waist, knees, or ankles. Both shoes of every character are visible and planted on the ground inside the frame.
- The bottom edge of the painted frame sits BELOW the children's shoes, with a visible margin of ground (dirt, tile, courtyard floor, classroom floor) painted between the shoes and the bottom edge. Reserve the bottom one-quarter of the frame for ground/floor, with the children's feet sitting on the upper line of that band.
- ${child.name} occupies approximately 55-65% of the frame's vertical height, positioned at one of the rule-of-thirds intersections (off-center, NOT dead-center). Camera at children's chest height (gentle low-angle, not from above). ${child.name}'s face is clearly readable at thumbnail size, three-quarter view minimum (both eyes and nose visible). ${bible.styleBible.compositionAnchors}`;

  // === ACTION & EMOTION block ===
  // The scene description from the story; per AI Engineer research, this is
  // most effective when phrased with mid-X verbs + body mechanics + facial
  // microexpression. The story prompt instructs the writer to produce scene
  // descriptions in this shape; we just frame it explicitly here.
  const actionBlock = isCover
    ? `[COVER SCENE] ONE single moment that represents the heart of this story: ${scene}. The composition focuses on this ONE moment only — NOT a summary of multiple pages, NOT a collage of story elements. One emotionally-loaded scene rendered with rich visible detail (action, supporting characters present in this one moment, setting elements, props).`
    : `[ACTION & EMOTION — page ${pageNumber}] This specific page MUST depict: ${scene}. Render the action, framing, and visible elements to communicate THIS moment specifically — different from any other page in the book.`;

  // === SETTING & PROPS block ===
  // Setting from Bible. UC6 fix (2026-05-10): resolveLocation() looks up the
  // current page's locationName against settingBible.primaryLocation +
  // secondaryLocations[]. Multi-setting stories (apartment → mosque →
  // apartment) now render the correct location per page instead of always
  // rendering the primary. The keyObjectOrDetail is surfaced here AND
  // referenced again in the CONSTRAINTS area to anchor the prop verbatim
  // (anti-drift technique per AI Engineer research).
  const resolvedLocation = resolveLocation(bible.settingBible, locationName);
  const settingParts: string[] = [
    resolvedLocation.name,
    resolvedLocation.details,
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
  );

  // === IDENTITY PRESERVATION block (body pages only) ===
  // Cross-page consistency directive. Cover doesn't need this (it's page 0,
  // no prior pages to be consistent with — the cover defines the baseline).
  const identityFaceClause = `${child.name}'s face must be unmistakably recognizable as the SAME child as in the reference photos and on every other page of this book. Render the SAME face shape, SAME eye shape and color, SAME hair texture and styling (if reference photos show specific hair styling like a ponytail with a bow, render that exact styling — do NOT change the hairstyle), SAME distinguishing features.`;
  const identityOutfitClause = isVariationOutfit
    ? `OUTFIT CHANGE FOR THIS PAGE: this page deliberately shows ${child.name} in a DIFFERENT outfit from the rest of the book — specifically: "${outfit}". This is a story event, NOT a continuity error. Render this exact outfit verbatim. Do NOT default to the wardrobe used on other pages. Face, hair, and identity stay the SAME — only the outfit is different on this page.`
    : `OUTFIT CONTINUITY: render the SAME outfit listed in [SUBJECT] above ("${outfit}") — same colors, same items, same accessories. The wardrobe must be identical to every other page in this book except where the story explicitly says the child changed clothes.`;
  const identityPreservationBlock = isCover
    ? ""
    : `[IDENTITY PRESERVATION — non-negotiable across the 17-page sequence] ${identityFaceClause} ${identityOutfitClause}`;

  // === STYLE block ===
  // Pulled from Bible.styleBible (which Bible-gen now produces in Pixar-3D
  // register by default per ADR-027 + the bible-system-prompt rewrite).
  const styleBlock = `[STYLE] ${bible.styleBible.medium}. Palette: ${bible.styleBible.palette}. Lighting: ${bible.styleBible.light}.`;

  // === CONSTRAINTS block (the "negative") — placed at end ===
  // Per Google's Gemini 3 dev guide: critical constraints belong at the END
  // of the prompt for instruction-following. Bible-gen produces a short
  // negativeStyle (≤75 tokens / 3–5 items) per the new rewrite; we use it
  // verbatim here. V2 fix (2026-05-10): appended Beatrix Potter exclusion
  // as a triple-anchor against visual leakage from the static style ref.
  const constraintsBlock = `[CONSTRAINTS] ${bible.styleBible.negativeStyle} Additionally: do NOT render rabbits, English garden plants, terracotta pots, blue jackets, or Edwardian-English imagery — these may appear in the watercolor STYLE REFERENCE (the final input image) but are NOT part of this story.`;

  // === SCALE block — peer-locked, off-center protagonist ===
  // Ported from iter 8 (2026-05-10). Uses head-count proportions ("5.5 heads
  // tall") + position language ("top-of-head aligned at same horizontal
  // position") instead of metaphor ("imagine a horizontal ruler...") which
  // was rendering as visible lines in the output. Off-center placement
  // counters the centering=biggest model bias.
  const heightCm = estimateHeightCm(child.age);
  const scaleBlock = `[SCALE — peer-locked, off-center protagonist]
- ${child.name} is ${child.age} years old, approximately ${heightCm}cm tall, with the head-to-body proportions of a real ${child.age}-year-old (approximately 5.5 heads tall at this age — NOT a chibi, NOT a stylized big-head).
- Every other child of similar age (within ~2 years) in this frame is rendered at IDENTICAL height as ${child.name}: top-of-head, eye-line, shoulder-line, and feet-line all aligned at the same horizontal position. No peer is taller or shorter than the protagonist.
- ${child.name}'s head, body, hands, and feet occupy the SAME pixel-area as each peer's (within 5%). She is one peer among peers, drawn at peer scale.
- Adults (parents, teachers) stand significantly taller — adult shoulder-line at children's forehead-to-eye height; adult head clears every child's head by at least one full head-height.
- ${child.name} is positioned at a rule-of-thirds intersection (off-center), NOT at the geometric center of the frame. The shared activity or focal object of the page occupies the central focal area — the protagonist gets her focus from placement, lighting, and direct eye-readability, NEVER from being drawn larger.`;

  // === EXPRESSION CALIBRATION block — restraint, peer-matched ===
  // Ported from iter 8. Without this, the model over-corrects toward
  // theatrical "shocked-delight" expressions (wide eyes + lifted brows +
  // open mouth simultaneously), which fights the watercolor picture-book
  // restraint of the named-work register (dePaola / Oxenbury).
  const expressionCalibrationBlock = `[EXPRESSION CALIBRATION — picture-book restraint, peer-matched]
${child.name}'s emotional intensity matches the other children in this frame at the same level — never higher, never more theatrical. The watercolor picture-book register (Helen Oxenbury, Tomie dePaola, Jerry Pinkney) reads emotion through the EYES first (softness, catchlights, gentle crinkle at the outer corners) and the mouth second (a small closed-mouth or barely-parted smile). Avoid the cartoon "shocked-delight" combination of wide eyes + lifted brows + open mouth all at once — pick at most one of those three signals and keep the other two restrained. If a peer in the same frame would smile with a closed mouth, ${child.name} smiles with a closed mouth.`;

  // === WARDROBE LOCK block — verbatim outfit, prompt END (load-bearing) ===
  // Per AI Engineer 2026-05-10: Gemini 3's reasoning planner weights
  // prompt-end as heavily as prompt-start. Wardrobe lock at the end captures
  // the planner's last-pass attention, dramatically improving outfit
  // consistency without any image anchor.
  const wardrobeLockBlock = `[WARDROBE LOCK — non-negotiable]
${child.name} wears EXACTLY: ${outfit}.
Every garment, every color, every accessory must match this string verbatim. Do NOT introduce a different shirt, a different color, or any new accessory not listed above. If this conflicts with the scene action, render the action while keeping the wardrobe identical.`;

  // === STYLE LOCK block — at very end, mirrors WARDROBE LOCK pattern ===
  // Anchors the watercolor register at prompt-end alongside the wardrobe.
  // Bracket effect: STYLE block (early) + STYLE LOCK (very end) hits both
  // attention positions Gemini 3's planner weights heaviest.
  const styleLockBlock = `[STYLE LOCK — non-negotiable, watercolor register]
This illustration is rendered as soft Egyptian children's-book watercolor — wet-on-wet technique, visible brush strokes, pigment blooms, cold-press paper texture preserved as warm cream washes — in the soft watercolor warmth of Tomie dePaola's *Strega Nona* and Helen Oxenbury's *We're Going on a Bear Hunt*, applied to Egyptian children and Cairo apartment settings (NOT New England farmhouse register, NOT Edwardian English garden register). Hand-painted watercolor ONLY: NO photorealism, NO 3D rendering, NO digital-glossy treatment, NO sharp digital lines, NO embedded text or typography of any kind, NO measurement guides or rulers or compositional overlays, NO rabbits, NO English garden imagery, NO blue rabbit jackets — the watercolor TECHNIQUE reference (the final input image) shows Beatrix Potter subjects that must NOT appear in this Egyptian story.`;

  // === Final assembly — block order matters per Gemini 3 prompting guide ===
  // V1 fix (2026-05-10 post-validation): REFERENCE IMAGES first to assign
  // image roles before any other text invokes them. Multimodal planners parse
  // image roles AT image-encounter; arriving at REFERENCE IMAGES after STYLE
  // would force a reconciliation between an established style commitment and
  // image content. STYLE second sets rendering intent on top of role-locked
  // images. Then content (SUBJECT → COMPOSITION → SCALE → EXPRESSION → ACTION
  // → SETTING). CONSTRAINTS late, then bracket-end LOCK blocks for planner
  // end-pass attention (the same prompt-end weighting that anchors WARDROBE).
  const positive = [
    referenceRoles,
    styleBlock,
    subjectBlock,
    compositionBlock,
    scaleBlock,
    expressionCalibrationBlock,
    actionBlock,
    settingBlock,
    otherCharactersBlock,
    identityPreservationBlock,
    constraintsBlock,
    wardrobeLockBlock,
    styleLockBlock,
  ]
    .filter((s) => s && s.length > 0)
    .join("\n\n");

  return {
    positive,
    negative: "",
  };
}

// Rough WHO-median height anchors for Egyptian children — used in [SCALE]
// block to give Gemini a concrete cm reference per character age.
function estimateHeightCm(ageYears: number): number {
  if (ageYears <= 2) return 88;
  if (ageYears <= 4) return 102;
  if (ageYears <= 6) return 113;
  if (ageYears <= 8) return 126;
  if (ageYears <= 10) return 138;
  return 148;
}

function buildOtherCharactersBlock(
  protagonistName: string,
  supportingCharacters: Bible["characterBible"]["supportingCharacters"],
  charactersOnPage: string[] | undefined,
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

  // Customer photo upload is mandatory (founder lock-in 2026-05-10), so the
  // photo-disclaimer always applies — reference photos are for the protagonist
  // only and must not blend into supporting characters.
  const photoDisclaimer = ` The reference photos apply ONLY to ${protagonistName}; generate every character below from their description, do NOT blend ${protagonistName}'s reference-photo features into them.`;

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

/**
 * Resolves the location for a given page against settingBible. Match strategy:
 *   1. No locationName given → primary
 *   2. locationName matches primary (case-insensitive equality OR substring) → primary
 *   3. locationName matches a secondaryLocations[].name (case-insensitive equality
 *      OR substring either direction) → that secondary
 *   4. No match → primary (defensive default; logs to stdout so admin sees the
 *      mismatch and can correct the Bible or story)
 *
 * UC6 fix (2026-05-10).
 */
function resolveLocation(
  settingBible: Bible["settingBible"],
  locationName: string | undefined,
): { name: string; details: string } {
  const primary = {
    name: settingBible.primaryLocation,
    details: settingBible.primaryLocationDetails,
  };
  if (!locationName || !locationName.trim()) return primary;

  const needle = locationName.trim().toLowerCase();
  const primaryName = settingBible.primaryLocation.toLowerCase();
  if (
    needle === primaryName ||
    primaryName.includes(needle) ||
    needle.includes(primaryName)
  ) {
    return primary;
  }

  for (const sec of settingBible.secondaryLocations ?? []) {
    const secName = sec.name.toLowerCase();
    if (
      needle === secName ||
      secName.includes(needle) ||
      needle.includes(secName)
    ) {
      return { name: sec.name, details: sec.description };
    }
  }

  // No match — admin-visible warning. Defensive default to primary so the
  // book still renders something sensible (better an apartment-everywhere
  // than a thrown error). Story prompt + Bible prompt should converge on
  // matching names; this branch indicates drift.
  console.warn(
    `[buildIllustrationPrompt] locationName "${locationName}" did not match ` +
      `primaryLocation ("${settingBible.primaryLocation}") or any of ` +
      `${(settingBible.secondaryLocations ?? []).length} secondaryLocations ` +
      `(${(settingBible.secondaryLocations ?? []).map((s) => `"${s.name}"`).join(", ")}). ` +
      `Falling back to primary.`,
  );
  return primary;
}

// (Removed 2026-05-10 per ADR-028 watercolor revert: appendPixarStyleAnchor +
// PIXAR_STYLE_ANCHOR constant + flux-kontext-pixar provider integration. The
// brand register is locked to soft Egyptian watercolor — Tomie dePaola
// /Helen Oxenbury named-work anchors — not Pixar-3D. styleBible from Bible-gen
// produces watercolor-register language automatically; buildIllustrationPrompt
// reads it verbatim without style override.)
