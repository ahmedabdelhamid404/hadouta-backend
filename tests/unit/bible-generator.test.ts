import { describe, expect, it, vi } from "vitest";
import "dotenv/config";

// Mock AI SDK before any other imports trigger module loading.
vi.mock("ai", () => ({
  generateObject: vi.fn(),
  generateText: vi.fn(),
}));
// Mock the router to avoid loading provider SDKs (anthropic/google) at unit-test time.
vi.mock("../../src/lib/ai/router.js", () => ({
  resolveTextModel: vi.fn(() => ({
    model: { mock: true },
    modelId: "mock-model",
    provider: "mock",
    estimateCostCents: () => 0,
  })),
}));

import { generateObject } from "ai";
import { generateBible } from "../../src/lib/ai/bible-generator.js";
import type { StoryOutput } from "../../src/lib/ai/schemas/story.js";

const SAMPLE_STORY: StoryOutput = {
  title: "هُنَا وَعيد ميلادها",
  dedication: "إلى هُنَا — قلبك الكبير هو أحلى هدية.",
  coverDescription: "Hena holding a tray of kahk surrounded by friends in her living room",
  parentDiscussionQuestion: "إزاي ممكن نساعد بعض في الاحتفال؟",
  moralStatement: "وفي الآخر، عرفت هُنَا إن التعاون هو السر، وإن أحلى حاجة في الدنيا إننا نشتغل مع بعض.",
  pages: [
    {
      number: 1,
      act: "setup",
      emotionalBeat: "joyful anticipation",
      moralMoment: false,
      text: "كان في يوم مشمس، هُنَا صحيت بدري عشان عيد ميلادها.",
      scene: "Hena waking up at dawn excitedly",
    },
  ],
};

const SAMPLE_INPUT = {
  story: SAMPLE_STORY,
  wizardData: {
    childName: "هُنَا",
    childAgeBand: "3-5" as const,
    childAgeExact: 4,
    childGender: "girl" as const,
    theme: "العيد",
    moralValue: "التعاون",
    photoUrl: null,
    personaId: "curly-girl-young",
  },
};

const VALID_BIBLE_FIXTURE = {
  characterBible: {
    mainChild: {
      name: "هُنَا",
      age: 4,
      gender: "girl" as const,
      appearance: {
        hair: "dark curly hair shoulder-length pulled into two pigtails with red ribbons",
        skin: "warm medium-olive skin",
        eyes: "large round dark-brown eyes with thick lashes",
        distinguishing: "small dimple on left cheek, slight gap between front teeth",
      },
      outfit: {
        default: "yellow cotton sundress with daisy print, white cardigan, brown sandals",
        variations: [],
      },
      personalityVisual: "energetic posture, often mid-motion",
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
    medium: "soft watercolor on cream paper with visible brush strokes",
    palette: "warm cream backgrounds, terracotta accents, soft sage greens",
    light: "golden afternoon light",
    negativeStyle: "NOT photorealistic, NOT 3D, NOT Disney-cartoon, NOT anime",
    compositionAnchors: "subject in upper two-thirds; neutral lower third",
  },
  culturalNotes: ["Story takes place during Eid el-Fitr — kahk biscuits on table, NOT chocolate chip cookies"],
};

describe("generateBible — no photo (persona path)", () => {
  it("produces a valid Bible from persona seed", async () => {
    (generateObject as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      object: VALID_BIBLE_FIXTURE,
      usage: { promptTokens: 1500, completionTokens: 800 },
    });

    const bible = await generateBible(SAMPLE_INPUT);
    expect(bible.characterBible.mainChild.name).toBe("هُنَا");
    expect(bible.characterBible.mainChild.gender).toBe("girl");
    expect(bible.styleBible.medium).toContain("watercolor");
  });

  it("includes culturalNotes derived from story content", async () => {
    (generateObject as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      object: VALID_BIBLE_FIXTURE,
      usage: { promptTokens: 1500, completionTokens: 800 },
    });

    const bible = await generateBible(SAMPLE_INPUT);
    expect(bible.culturalNotes.length).toBeGreaterThanOrEqual(1);
    expect(bible.culturalNotes.some((n) => n.includes("kahk"))).toBe(true);
  });

  it("throws when persona is missing AND no photo AND no description provided", async () => {
    await expect(
      generateBible({
        ...SAMPLE_INPUT,
        wizardData: {
          ...SAMPLE_INPUT.wizardData,
          personaId: null,
          photoUrl: null,
        },
      }),
    ).rejects.toThrow(/persona|photo|description/i);
  });
});
