import { describe, expect, it } from "vitest";
import { storyOutputSchema } from "../../src/lib/ai/schemas/story.js";
import { ALL_EXAMPLES } from "../../src/lib/ai/prompts/story-examples/index.js";

describe("few-shot story examples", () => {
  it.each(ALL_EXAMPLES.map((e, i) => [i + 1, e]))(
    "example %i validates against storyOutputSchema",
    (_idx, example) => {
      const result = storyOutputSchema.safeParse(example.story);
      if (!result.success) {
        // eslint-disable-next-line no-console
        console.error(
          `Example failed validation:`,
          result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
        );
      }
      expect(result.success).toBe(true);
    },
  );

  it.each(ALL_EXAMPLES.map((e, i) => [i + 1, e]))(
    "example %i has moralStatement of valid length",
    (_idx, example) => {
      const story = example.story as { moralStatement?: string };
      expect(story.moralStatement).toBeDefined();
      expect(story.moralStatement!.length).toBeGreaterThanOrEqual(20);
      expect(story.moralStatement!.length).toBeLessThanOrEqual(220);
    },
  );

  it.each(ALL_EXAMPLES.map((e, i) => [i + 1, e]))(
    "example %i moralStatement is not a question",
    (_idx, example) => {
      const story = example.story as { moralStatement?: string };
      expect(story.moralStatement).not.toMatch(/[?؟]/);
    },
  );
});
