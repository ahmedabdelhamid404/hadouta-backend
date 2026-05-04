import { describe, expect, it } from "vitest";
import {
  CULTURAL_GLOSSARY,
  findRelevantGlossaryEntries,
} from "../../src/lib/ai/cultural-glossary.js";

describe("CULTURAL_GLOSSARY", () => {
  it("contains at least 15 entries", () => {
    expect(CULTURAL_GLOSSARY.length).toBeGreaterThanOrEqual(15);
  });

  it("every entry has Arabic, latin, description, notExamples, triggerKeywords", () => {
    for (const entry of CULTURAL_GLOSSARY) {
      expect(entry.ar).toMatch(/[؀-ۿ]/);
      expect(entry.latin.length).toBeGreaterThanOrEqual(2);
      expect(entry.description.length).toBeGreaterThanOrEqual(40);
      expect(entry.notExamples.length).toBeGreaterThanOrEqual(1);
      expect(entry.triggerKeywords.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("no duplicate latin keys", () => {
    const latinKeys = CULTURAL_GLOSSARY.map((e) => e.latin);
    expect(new Set(latinKeys).size).toBe(latinKeys.length);
  });

  it("includes makarona bashamel with anti-spaghetti negative", () => {
    const entry = CULTURAL_GLOSSARY.find((e) => e.latin === "makarona bashamel");
    expect(entry).toBeDefined();
    expect(entry!.notExamples.some((n) => n.toLowerCase().includes("spaghetti"))).toBe(true);
  });

  it("includes kahk with anti-cookie negative", () => {
    const entry = CULTURAL_GLOSSARY.find((e) => e.latin === "kahk");
    expect(entry).toBeDefined();
    expect(entry!.notExamples.some((n) => n.toLowerCase().includes("cookie"))).toBe(true);
  });

  it("findRelevantGlossaryEntries matches by trigger keyword (case-insensitive)", () => {
    const matches = findRelevantGlossaryEntries(["birthday cake at home", "EID celebration"]);
    const eidMatch = matches.find((e) => e.triggerKeywords.includes("eid"));
    expect(eidMatch).toBeDefined();
  });

  it("findRelevantGlossaryEntries deduplicates", () => {
    const matches = findRelevantGlossaryEntries(["eid eid eid"]);
    const eidEntries = matches.filter((e) => e.triggerKeywords.includes("eid"));
    expect(eidEntries.length).toBeLessThanOrEqual(2);
  });
});
