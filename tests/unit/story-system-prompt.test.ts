import { describe, expect, it } from "vitest";
import { buildStorySystemPrompt } from "../../src/lib/ai/prompts/story-system-prompt.js";

describe("buildStorySystemPrompt", () => {
  const prompt = buildStorySystemPrompt({ ageBand: "3-5", pageCount: 8 });

  it("includes the moralStatement output requirement", () => {
    expect(prompt).toContain("moralStatement");
    expect(prompt).toMatch(/distilled.*moral|moral.*takeaway/i);
  });

  it("instructs that moralStatement is NOT a question", () => {
    expect(prompt).toMatch(/not.*a question|never.*a question|NOT a question/);
  });

  it("instructs that moralStatement is in Storyteller voice", () => {
    expect(prompt.toLowerCase()).toContain("storyteller voice");
  });

  it("includes the cover composition rule (subject in upper portion)", () => {
    expect(prompt).toMatch(/upper.*two.thirds|upper portion of/i);
  });

  it("instructs cover bottom must be neutral painting", () => {
    expect(prompt).toMatch(/bottom.*neutral|neutral.*bottom|no critical.*bottom/i);
  });
});
