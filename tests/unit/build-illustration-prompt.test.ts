import { describe, expect, it } from "vitest";
import { buildIllustrationPrompt } from "../../src/lib/ai/prompts/build-illustration-prompt.js";
import type { Bible } from "../../src/lib/ai/schemas/bible.js";

const SAMPLE_BIBLE: Bible = {
  characterBible: {
    mainChild: {
      name: "هُنَا",
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
    supportingCharacters: [],
  },
  settingBible: {
    primaryLocation: "Hena's family apartment in Maadi, Cairo",
    primaryLocationDetails:
      "terracotta tile floors, cream walls with framed family photos, teal velvet sofa, ceiling fan, balcony with potted basil",
    secondaryLocations: [],
  },
  styleBible: {
    medium: "soft watercolor on cream paper, visible brush strokes, gentle wet-edge bleeds",
    palette: "warm cream backgrounds, terracotta accents, soft sage greens, golden afternoon light",
    light: "golden afternoon light through soft window curtains",
    negativeStyle: "NOT photorealistic, NOT 3D-rendered, NOT Disney-cartoon, NOT anime, NOT vector-flat",
    compositionAnchors: "subject in upper two-thirds of frame, neutral lower third, no embedded text or signage in scene",
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

  it("returns negative prompt from styleBible.negativeStyle", () => {
    const { negative } = buildIllustrationPrompt({
      bible: SAMPLE_BIBLE,
      scene: "Hena at the table",
      pageNumber: 5,
    });
    expect(negative).toContain("NOT photorealistic");
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
    });
    const { positive: defaultPrompt } = buildIllustrationPrompt({
      bible: bibleWithVariation,
      scene: "Hena reads",
      pageNumber: 5,
    });
    expect(variantPrompt).toContain("red Eid dress");
    expect(defaultPrompt).toContain("yellow cotton sundress");
  });

  it("for cover (pageNumber=0), uses default outfit (no variation lookup)", () => {
    const { positive } = buildIllustrationPrompt({
      bible: SAMPLE_BIBLE,
      scene: "Hena holding a tray of kahk surrounded by friends",
      pageNumber: 0,
    });
    expect(positive).toContain("yellow cotton sundress");
  });
});
