import { describe, expect, it } from "vitest";
import {
  appendPixarStyleAnchor,
  buildIllustrationPrompt,
} from "../../src/lib/ai/prompts/build-illustration-prompt.js";
import type { Bible } from "../../src/lib/ai/schemas/bible.js";

// SAMPLE_BIBLE matches the post-2026-05-06 Pixar-3D register that Bible-gen
// now produces by default (per ADR-027 + bible-system-prompt rewrite). Tests
// should reflect production reality, not pre-pivot watercolor sample data.
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
        distinguishing: "small dimple on left cheek, slight gap between front teeth",
      },
      outfit: {
        default:
          "yellow cotton sundress with white daisy print, white short-sleeved cardigan, brown leather sandals",
        variations: [],
      },
      personalityVisual: "energetic posture, often mid-motion, expressive eyebrows",
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
      "3D animated illustration in the visual style of Pixar's Encanto, Coco, and Inside Out — finished feature-film frame with smooth subsurface skin shading and large expressive eyes",
    palette: "warm cinematic color grading — rich earth tones, soft pastel highlights, golden afternoon warmth",
    light: "soft cinematic lighting, warm golden hour where mood permits",
    negativeStyle:
      "Not watercolor, not 2D flat illustration, not anime, not photorealistic — Pixar 3D animated film style only. No text, letters, or typography anywhere in the image.",
    compositionAnchors:
      "Hero (protagonist) occupies ~60% of frame height; setting fills remaining ~40%. Face clearly readable at thumbnail size. Rule-of-thirds anchoring on identity-critical pages.",
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
      hasReferencePhotos: true,
    });
    expect(positive).toContain("dark curly hair");
    expect(positive).toContain("yellow cotton sundress");
  });

  it("includes setting primaryLocationDetails", () => {
    const { positive } = buildIllustrationPrompt({
      bible: SAMPLE_BIBLE,
      scene: "Hena gathers kahk",
      pageNumber: 5,
      hasReferencePhotos: true,
    });
    expect(positive).toContain("terracotta tile floors");
  });

  it("includes scene-specific text", () => {
    const { positive } = buildIllustrationPrompt({
      bible: SAMPLE_BIBLE,
      scene: "Hena gathers kahk from a metal tray",
      pageNumber: 5,
      hasReferencePhotos: true,
    });
    expect(positive).toContain("Hena gathers kahk from a metal tray");
  });

  it("includes culturalNotes", () => {
    const { positive } = buildIllustrationPrompt({
      bible: SAMPLE_BIBLE,
      scene: "Hena at the table",
      pageNumber: 5,
      hasReferencePhotos: true,
    });
    expect(positive).toContain("kahk biscuits");
    expect(positive).toContain("NOT chocolate chip cookies");
  });

  it("folds negativeStyle into the positive prompt's CONSTRAINTS block (negative field is empty per Nano Banana 2's lack of negative_prompt support)", () => {
    const { positive, negative } = buildIllustrationPrompt({
      bible: SAMPLE_BIBLE,
      scene: "Hena at the table",
      pageNumber: 5,
      hasReferencePhotos: true,
    });
    expect(positive).toContain("[CONSTRAINTS]");
    expect(positive).toContain("Not watercolor");
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
              { pageNumbers: [13, 14], description: "wearing a red Eid dress with gold embroidery" },
            ],
          },
        },
      },
    };
    const { positive: variantPrompt } = buildIllustrationPrompt({
      bible: bibleWithVariation,
      scene: "Hena celebrates",
      pageNumber: 13,
      hasReferencePhotos: true,
    });
    const { positive: defaultPrompt } = buildIllustrationPrompt({
      bible: bibleWithVariation,
      scene: "Hena reads",
      pageNumber: 5,
      hasReferencePhotos: true,
    });
    expect(variantPrompt).toContain("red Eid dress");
    expect(defaultPrompt).toContain("yellow cotton sundress");
  });

  it("body pages include identity-preservation language and reference-roles preamble when photos provided", () => {
    const { positive } = buildIllustrationPrompt({
      bible: SAMPLE_BIBLE,
      scene: "Hena gathers kahk",
      pageNumber: 5,
      hasReferencePhotos: true,
    });
    expect(positive).toMatch(/IDENTITY PRESERVATION/);
    expect(positive).toContain("reference photos");
    expect(positive).toContain("[REFERENCE IMAGES]");
  });

  it("body pages without reference photos skip the Image-N preamble (no orphan references)", () => {
    const { positive } = buildIllustrationPrompt({
      bible: SAMPLE_BIBLE,
      scene: "Hena gathers kahk",
      pageNumber: 5,
      hasReferencePhotos: false,
    });
    expect(positive).not.toContain("[REFERENCE IMAGES]");
    expect(positive).not.toContain("Image 1");
  });

  it("cover (pageNumber=0) does NOT include the body-only IDENTITY PRESERVATION block", () => {
    // Cover gets a different scene block — it doesn't need the per-page
    // identity-preservation guard because there's no prior page to drift from.
    const { positive } = buildIllustrationPrompt({
      bible: SAMPLE_BIBLE,
      scene: "Hena holding kahk surrounded by friends",
      pageNumber: 0,
      hasReferencePhotos: true,
    });
    expect(positive).not.toMatch(/IDENTITY PRESERVATION/);
  });

  it("for cover (pageNumber=0), uses default outfit (no variation lookup)", () => {
    const { positive } = buildIllustrationPrompt({
      bible: SAMPLE_BIBLE,
      scene: "Hena holding a tray of kahk surrounded by friends",
      pageNumber: 0,
      hasReferencePhotos: true,
    });
    expect(positive).toContain("yellow cotton sundress");
  });

  it("injects supporting character appearance from Bible when charactersOnPage names them", () => {
    const { positive } = buildIllustrationPrompt({
      bible: SAMPLE_BIBLE,
      scene: "Hena hugs Mama",
      pageNumber: 7,
      hasReferencePhotos: true,
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
      hasReferencePhotos: true,
      charactersOnPage: ["Hena"],
    });
    expect(positive).toContain("alone in this scene");
  });

  it("surfaces keyObjectOrDetail in the SETTING & PROPS block", () => {
    const { positive } = buildIllustrationPrompt({
      bible: SAMPLE_BIBLE,
      scene: "Hena ties a ribbon in her hair",
      pageNumber: 5,
      hasReferencePhotos: true,
      keyObjectOrDetail: "deep red satin ribbon, ~30cm long",
    });
    expect(positive).toContain("Key prop visible in this scene: deep red satin ribbon");
  });
});

describe("appendPixarStyleAnchor", () => {
  it("appends Pixar-3D style language to a prompt", () => {
    const original = "watercolor scene of an Egyptian girl";
    const result = appendPixarStyleAnchor(original);
    expect(result).toContain(original);
    expect(result).toContain("Pixar 3D animated style");
    expect(result).toContain("subsurface scattering");
  });

  it("does not duplicate the anchor if already present", () => {
    const already = appendPixarStyleAnchor("base prompt");
    const twice = appendPixarStyleAnchor(already);
    const occurrences = (twice.match(/Pixar 3D animated style/g) ?? []).length;
    expect(occurrences).toBe(1);
  });
});
