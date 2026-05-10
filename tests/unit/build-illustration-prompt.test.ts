import { describe, expect, it } from "vitest";
import { buildIllustrationPrompt } from "../../src/lib/ai/prompts/build-illustration-prompt.js";
import type { Bible } from "../../src/lib/ai/schemas/bible.js";

// SAMPLE_BIBLE matches the post-2026-05-10 watercolor register that Bible-gen
// produces by default after ADR-028 (revert from Pixar-3D back to soft Egyptian
// children's-book watercolor — Tomie dePaola / Helen Oxenbury named-work
// anchors). Per V12 fix, customer photos are MANDATORY at the wizard layer,
// so the prompt builder always emits the [REFERENCE IMAGES] block (the prior
// hasReferencePhotos flag was removed).
const SAMPLE_BIBLE: Bible = {
  characterBible: {
    mainChild: {
      name: "Hena",
      age: 4,
      gender: "girl",
      appearance: {
        hair: "dark curly hair shoulder-length pulled into two pigtails with red ribbons",
        skin: "warm medium-olive skin",
        eyes: "almond-shaped large brown eyes with thick lashes",
        distinguishing:
          "small dimple on left cheek, slight gap between front teeth",
      },
      outfit: {
        default:
          "yellow cotton sundress with white daisy print, white short-sleeved cardigan, brown leather sandals",
        variations: [],
      },
      personalityVisual:
        "energetic posture, often mid-motion, expressive eyebrows",
    },
    supportingCharacters: [
      {
        name: "Mama",
        relationship: "mother",
        appearance:
          "35-year-old Egyptian woman, NOT a teenager — warm brown skin, shoulder-length wavy black hair pulled back with a few grey strands at the temples, soft smile lines around the eyes, wearing a light blue cotton kaftan",
      },
    ],
  },
  settingBible: {
    primaryLocation: "Hena's family apartment in Maadi, Cairo",
    primaryLocationDetails:
      "terracotta tile floors, cream walls with framed family photos, teal velvet sofa, ceiling fan, balcony with potted basil",
    secondaryLocations: [],
  },
  styleBible: {
    medium:
      "Watercolor children's-book illustration, wet-on-wet technique, visible brush strokes and pigment blooms — the soft watercolor register of Tomie dePaola's Strega Nona and Helen Oxenbury's We're Going on a Bear Hunt, applied to Egyptian children and Cairo apartment settings",
    palette:
      "Warm cream paper backgrounds, terracotta and ochre accents, soft sage greens for foliage, dusty blues for sky, golden afternoon light",
    light:
      "Warm golden afternoon light filtering through soft window curtains; gentle directional lighting with soft falloff",
    negativeStyle:
      "NOT photorealistic, NOT 3D-rendered, NOT digital-glossy, NOT vector-flat, NOT sharp digital lines — soft hand-painted watercolor storybook only. No text, letters, numbers, or typography anywhere in the image.",
    compositionAnchors:
      "Protagonist occupies approximately 60% of frame height; setting fills the remaining 40%. Face clearly readable at thumbnail size.",
  },
  culturalNotes: [
    "During Eid el-Fitr — kahk biscuits on table, NOT chocolate chip cookies",
    "Pasta dish if shown is makarona bashamel (béchamel-baked layered pasta) — NOT spaghetti",
  ],
};

describe("buildIllustrationPrompt", () => {
  it("includes character appearance details", () => {
    const { positive } = buildIllustrationPrompt({
      bible: SAMPLE_BIBLE,
      scene: "Hena gathers kahk from a metal tray on the coffee table",
      pageNumber: 5,
    });
    expect(positive).toContain("dark curly hair");
    expect(positive).toContain("yellow cotton sundress");
  });

  it("includes setting primaryLocationDetails", () => {
    const { positive } = buildIllustrationPrompt({
      bible: SAMPLE_BIBLE,
      scene: "Hena gathers kahk",
      pageNumber: 5,
    });
    expect(positive).toContain("terracotta tile floors");
  });

  it("includes scene-specific text", () => {
    const { positive } = buildIllustrationPrompt({
      bible: SAMPLE_BIBLE,
      scene: "Hena gathers kahk from a metal tray",
      pageNumber: 5,
    });
    expect(positive).toContain("Hena gathers kahk from a metal tray");
  });

  it("includes culturalNotes", () => {
    const { positive } = buildIllustrationPrompt({
      bible: SAMPLE_BIBLE,
      scene: "Hena at the table",
      pageNumber: 5,
    });
    expect(positive).toContain("kahk biscuits");
    expect(positive).toContain("NOT chocolate chip cookies");
  });

  it("folds negativeStyle into the positive prompt's CONSTRAINTS block (negative field is empty per Nano Banana 2's lack of negative_prompt support)", () => {
    const { positive, negative } = buildIllustrationPrompt({
      bible: SAMPLE_BIBLE,
      scene: "Hena at the table",
      pageNumber: 5,
    });
    expect(positive).toContain("[CONSTRAINTS]");
    expect(positive).toContain("NOT photorealistic");
    expect(negative).toBe("");
  });

  it("uses outfit variation when page number matches", () => {
    const bibleWithVariation: Bible = {
      ...SAMPLE_BIBLE,
      characterBible: {
        ...SAMPLE_BIBLE.characterBible,
        mainChild: {
          ...SAMPLE_BIBLE.characterBible.mainChild,
          outfit: {
            default: SAMPLE_BIBLE.characterBible.mainChild.outfit.default,
            variations: [
              {
                pageNumbers: [13, 14],
                description: "wearing a red Eid dress with gold embroidery",
              },
            ],
          },
        },
      },
    };
    const { positive: variantPrompt } = buildIllustrationPrompt({
      bible: bibleWithVariation,
      scene: "Hena celebrates",
      pageNumber: 13,
    });
    const { positive: defaultPrompt } = buildIllustrationPrompt({
      bible: bibleWithVariation,
      scene: "Hena reads",
      pageNumber: 5,
    });
    expect(variantPrompt).toContain("red Eid dress");
    expect(defaultPrompt).toContain("yellow cotton sundress");
  });

  // V2 fix (2026-05-10): variation outfits get an OUTFIT CHANGE FOR THIS PAGE
  // clause in IDENTITY PRESERVATION instead of the default OUTFIT CONTINUITY
  // clause. Without this branching, Gemini 3's planner stabilizes toward the
  // default outfit on multi-segment outfit stories.
  it("variation outfit pages emit OUTFIT CHANGE FOR THIS PAGE clause (V2 fix)", () => {
    const bibleWithVariation: Bible = {
      ...SAMPLE_BIBLE,
      characterBible: {
        ...SAMPLE_BIBLE.characterBible,
        mainChild: {
          ...SAMPLE_BIBLE.characterBible.mainChild,
          outfit: {
            default: SAMPLE_BIBLE.characterBible.mainChild.outfit.default,
            variations: [
              {
                pageNumbers: [16],
                description: "soft pink pajamas with star pattern",
              },
            ],
          },
        },
      },
    };
    const { positive: variationPagePrompt } = buildIllustrationPrompt({
      bible: bibleWithVariation,
      scene: "Hena climbs into bed",
      pageNumber: 16,
    });
    expect(variationPagePrompt).toContain("OUTFIT CHANGE FOR THIS PAGE");
    expect(variationPagePrompt).toContain("soft pink pajamas");
    expect(variationPagePrompt).toContain("deliberately");

    const { positive: defaultPagePrompt } = buildIllustrationPrompt({
      bible: bibleWithVariation,
      scene: "Hena reads quietly",
      pageNumber: 5,
    });
    expect(defaultPagePrompt).toContain("OUTFIT CONTINUITY");
    expect(defaultPagePrompt).not.toContain("OUTFIT CHANGE FOR THIS PAGE");
  });

  it("body pages include identity-preservation language and reference-roles preamble", () => {
    const { positive } = buildIllustrationPrompt({
      bible: SAMPLE_BIBLE,
      scene: "Hena gathers kahk",
      pageNumber: 5,
    });
    expect(positive).toMatch(/IDENTITY PRESERVATION/);
    expect(positive).toContain("reference photos");
    expect(positive).toContain("REFERENCE IMAGES");
  });

  it("cover (pageNumber=0) does NOT include the body-only IDENTITY PRESERVATION block", () => {
    // Cover gets a different scene block — it doesn't need the per-page
    // identity-preservation guard because there's no prior page to drift from.
    const { positive } = buildIllustrationPrompt({
      bible: SAMPLE_BIBLE,
      scene: "Hena holding kahk surrounded by friends",
      pageNumber: 0,
    });
    expect(positive).not.toMatch(/IDENTITY PRESERVATION/);
  });

  it("for cover (pageNumber=0), uses default outfit (no variation lookup)", () => {
    const { positive } = buildIllustrationPrompt({
      bible: SAMPLE_BIBLE,
      scene: "Hena holding a tray of kahk surrounded by friends",
      pageNumber: 0,
    });
    expect(positive).toContain("yellow cotton sundress");
  });

  it("injects supporting character appearance from Bible when charactersOnPage names them", () => {
    const { positive } = buildIllustrationPrompt({
      bible: SAMPLE_BIBLE,
      scene: "Hena hugs Mama",
      pageNumber: 7,
      charactersOnPage: ["Hena", "Mama"],
    });
    expect(positive).toContain("[OTHER CHARACTERS]");
    expect(positive).toContain("Mama");
    expect(positive).toContain("NOT a teenager");
    expect(positive).toContain("smile lines");
  });

  it("notes 'alone in this scene' when only the protagonist is on the page", () => {
    const { positive } = buildIllustrationPrompt({
      bible: SAMPLE_BIBLE,
      scene: "Hena reads quietly on the sofa",
      pageNumber: 5,
      charactersOnPage: ["Hena"],
    });
    expect(positive).toContain("alone in this scene");
  });

  it("surfaces keyObjectOrDetail in the SETTING & PROPS block", () => {
    const { positive } = buildIllustrationPrompt({
      bible: SAMPLE_BIBLE,
      scene: "Hena ties a ribbon in her hair",
      pageNumber: 5,
      keyObjectOrDetail: "deep red satin ribbon, ~30cm long",
    });
    expect(positive).toContain(
      "Key prop visible in this scene: deep red satin ribbon",
    );
  });

  // UC6 fix (2026-05-10): multi-setting stories must render each page's
  // location correctly. resolveLocation matches locationName against
  // primaryLocation OR secondaryLocations[].name.
  describe("locationName resolution (UC6 fix)", () => {
    const bibleMultiSetting: Bible = {
      ...SAMPLE_BIBLE,
      settingBible: {
        primaryLocation: "Cairo middle-class apartment",
        primaryLocationDetails:
          "terracotta tile floors, cream walls with framed family photos, teal velvet sofa, ceiling fan",
        secondaryLocations: [
          {
            name: "neighborhood mosque",
            description:
              "small green-domed mosque with white marble floor, wooden minbar, prayer rugs in geometric patterns",
          },
          {
            name: "Maadi park",
            description:
              "playground with date palms, wooden benches, sandy ground, green metal swing set",
          },
        ],
      },
    };

    it("uses primaryLocation when locationName is omitted", () => {
      const { positive } = buildIllustrationPrompt({
        bible: bibleMultiSetting,
        scene: "Hena reads on the sofa",
        pageNumber: 1,
      });
      expect(positive).toContain("terracotta tile floors");
      expect(positive).not.toContain("green-domed mosque");
    });

    it("renders the matching secondary location when locationName matches", () => {
      const { positive } = buildIllustrationPrompt({
        bible: bibleMultiSetting,
        scene: "Hena prays beside her father",
        pageNumber: 4,
        locationName: "neighborhood mosque",
      });
      expect(positive).toContain("green-domed mosque");
      expect(positive).toContain("wooden minbar");
      // Primary location details must NOT leak through
      expect(positive).not.toContain("teal velvet sofa");
    });

    it("falls back to primary on no match (defensive default)", () => {
      const { positive } = buildIllustrationPrompt({
        bible: bibleMultiSetting,
        scene: "scene at unknown location",
        pageNumber: 4,
        locationName: "Alexandria beach", // not in Bible
      });
      expect(positive).toContain("terracotta tile floors");
    });

    it("matches case-insensitively", () => {
      const { positive } = buildIllustrationPrompt({
        bible: bibleMultiSetting,
        scene: "Hena plays on the swings",
        pageNumber: 8,
        locationName: "MAADI PARK",
      });
      expect(positive).toContain("date palms");
    });
  });

  // V12 fix (2026-05-10): trim() the distinguishing field before injecting —
  // gpt-4o sometimes returns whitespace-only strings.
  it("omits 'Distinguishing features' line when Bible field is whitespace-only", () => {
    const bibleNoDistinguishing: Bible = {
      ...SAMPLE_BIBLE,
      characterBible: {
        ...SAMPLE_BIBLE.characterBible,
        mainChild: {
          ...SAMPLE_BIBLE.characterBible.mainChild,
          appearance: {
            ...SAMPLE_BIBLE.characterBible.mainChild.appearance,
            distinguishing: "  ",
          },
        },
      },
    };
    const { positive } = buildIllustrationPrompt({
      bible: bibleNoDistinguishing,
      scene: "Hena reads",
      pageNumber: 5,
    });
    expect(positive).not.toContain("Distinguishing features:");
  });
});
