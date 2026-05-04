import { describe, expect, it } from "vitest";
import { bibleSchema } from "../../src/lib/ai/schemas/bible.js";

const VALID_BIBLE = {
  characterBible: {
    mainChild: {
      name: "هُنَا",
      age: 4,
      gender: "girl" as const,
      appearance: {
        hair: "dark curly hair shoulder-length pulled into two pigtails with red ribbons",
        skin: "warm medium-olive skin with subtle warm undertones",
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
      "terracotta tile floors, cream-colored walls with framed family photos, teal velvet sofa, ceiling fan, small balcony with potted basil visible through french doors",
    secondaryLocations: [],
  },
  styleBible: {
    medium: "soft watercolor on cream paper, visible brush strokes, gentle wet-edge bleeds, no hard digital lines",
    palette: "warm cream backgrounds, terracotta accents, soft sage greens, golden afternoon light",
    light: "golden afternoon light through soft window curtains",
    negativeStyle: "NOT photorealistic, NOT 3D-rendered, NOT Disney-cartoon, NOT anime, NOT vector-flat, NOT sharp digital lines",
    compositionAnchors: "subject in upper two-thirds of frame, neutral lower third, no embedded text or signage in scene",
  },
  culturalNotes: ["Story takes place during Eid el-Fitr — kahk biscuits on table, NOT chocolate chip cookies"],
};

describe("bibleSchema", () => {
  it("accepts a fully populated valid bible", () => {
    const parsed = bibleSchema.parse(VALID_BIBLE);
    expect(parsed.characterBible.mainChild.name).toBe("هُنَا");
  });

  it("rejects when mainChild.appearance.hair is too short", () => {
    const result = bibleSchema.safeParse({
      ...VALID_BIBLE,
      characterBible: {
        ...VALID_BIBLE.characterBible,
        mainChild: {
          ...VALID_BIBLE.characterBible.mainChild,
          appearance: {
            ...VALID_BIBLE.characterBible.mainChild.appearance,
            hair: "short",
          },
        },
      },
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid gender enum", () => {
    const result = bibleSchema.safeParse({
      ...VALID_BIBLE,
      characterBible: {
        ...VALID_BIBLE.characterBible,
        mainChild: {
          ...VALID_BIBLE.characterBible.mainChild,
          gender: "other",
        },
      },
    });
    expect(result.success).toBe(false);
  });

  it("rejects when settingBible.primaryLocationDetails is too short", () => {
    const result = bibleSchema.safeParse({
      ...VALID_BIBLE,
      settingBible: {
        ...VALID_BIBLE.settingBible,
        primaryLocationDetails: "short",
      },
    });
    expect(result.success).toBe(false);
  });

  it("accepts empty supportingCharacters and secondaryLocations (MVP)", () => {
    const parsed = bibleSchema.parse(VALID_BIBLE);
    expect(parsed.characterBible.supportingCharacters).toEqual([]);
    expect(parsed.settingBible.secondaryLocations).toEqual([]);
  });

  it("accepts outfit variations array", () => {
    const withVariation = {
      ...VALID_BIBLE,
      characterBible: {
        ...VALID_BIBLE.characterBible,
        mainChild: {
          ...VALID_BIBLE.characterBible.mainChild,
          outfit: {
            default: VALID_BIBLE.characterBible.mainChild.outfit.default,
            variations: [
              { pageNumbers: [13, 14], description: "wearing a red Eid dress with gold embroidery" },
            ],
          },
        },
      },
    };
    const parsed = bibleSchema.parse(withVariation);
    expect(parsed.characterBible.mainChild.outfit.variations).toHaveLength(1);
  });
});
