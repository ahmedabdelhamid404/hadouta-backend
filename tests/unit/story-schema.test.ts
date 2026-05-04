import { describe, expect, it } from "vitest";
import { storyOutputSchema } from "../../src/lib/ai/schemas/story.js";

const VALID_BASE = {
  title: "هُنَا وَعيد ميلادها",
  dedication: "إلى هُنَا — قلبك الكبير هو أحلى هدية.",
  coverDescription:
    "Egyptian girl ~4 years old in a Cairo apartment living room, watercolor warm tones, friends gathered, sense of joyful celebration",
  parentDiscussionQuestion:
    "إزاي ممكن نساعد بعض في الاحتفال بأحلى عيد ميلاد؟",
  moralStatement:
    "وفي الآخر، عرفت هُنَا إن التعاون هو السر، وإن أحلى حاجة في الدنيا إننا نشتغل مع بعض.",
  pages: [
    {
      number: 1,
      act: "setup" as const,
      emotionalBeat: "joyful anticipation",
      moralMoment: false,
      text: "كان في يوم مشمس، هُنَا صحيت بدري عشان عيد ميلادها.",
      scene:
        "Egyptian girl waking up excitedly on her birthday in a Cairo apartment bedroom, watercolor warm light",
    },
    {
      number: 2,
      act: "challenge" as const,
      emotionalBeat: "the moment of choice",
      moralMoment: true,
      text: "هُنَا قررت تطلب المساعدة. قالت: «يا جماعة، لو كل واحد ساعد شوية، هنقدر نرتب بسرعة!»",
      scene:
        "Egyptian girl gathering her friends to help in a Cairo living room, watercolor",
    },
    {
      number: 3,
      act: "resolution" as const,
      emotionalBeat: "warm internal connection",
      moralMoment: false,
      text: "بَنُوا كل حاجة سَوا. هُنَا كانت حاسة بحاجة دافية في صدرها.",
      scene: "Children working together in joyful Cairo home scene, watercolor",
    },
    {
      number: 4,
      act: "resolution" as const,
      emotionalBeat: "internal warmth",
      moralMoment: false,
      text: "في عيد ميلادها الجاي، هُنَا كانت متحمسة عشان تعمل كل حاجة مع أصحابها.",
      scene: "Cairo birthday scene with friends in soft watercolor",
    },
  ],
};

describe("storyOutputSchema", () => {
  it("accepts a valid story with moralStatement", () => {
    const parsed = storyOutputSchema.parse(VALID_BASE);
    expect(parsed.moralStatement).toContain("التعاون");
  });

  it("rejects when moralStatement is missing", () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { moralStatement: _, ...withoutMoral } = VALID_BASE;
    const result = storyOutputSchema.safeParse(withoutMoral);
    expect(result.success).toBe(false);
  });

  it("rejects when moralStatement is shorter than 20 chars", () => {
    const result = storyOutputSchema.safeParse({
      ...VALID_BASE,
      moralStatement: "قصير أوي",
    });
    expect(result.success).toBe(false);
  });

  it("rejects when moralStatement is longer than 220 chars", () => {
    const result = storyOutputSchema.safeParse({
      ...VALID_BASE,
      moralStatement: "ا".repeat(221),
    });
    expect(result.success).toBe(false);
  });
});
