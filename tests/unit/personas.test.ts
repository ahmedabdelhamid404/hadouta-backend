import { describe, expect, it } from "vitest";
import { PERSONAS, getPersonaById, type Persona } from "../../src/lib/ai/personas.js";

describe("PERSONAS library", () => {
  it("contains exactly 6 starter personas", () => {
    expect(PERSONAS).toHaveLength(6);
  });

  it("every persona has unique id", () => {
    const ids = PERSONAS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every persona has Arabic label", () => {
    for (const p of PERSONAS) {
      expect(p.label).toMatch(/[؀-ۿ]/);
    }
  });

  it("every persona has detailed appearance fields", () => {
    for (const p of PERSONAS) {
      expect(p.appearance.hair.length).toBeGreaterThanOrEqual(20);
      expect(p.appearance.skin.length).toBeGreaterThanOrEqual(10);
      expect(p.appearance.eyes.length).toBeGreaterThanOrEqual(10);
    }
  });

  it("every persona has default outfit", () => {
    for (const p of PERSONAS) {
      expect(p.outfit.length).toBeGreaterThanOrEqual(20);
    }
  });

  it("ageBand is one of '3-5' | '5-7' | '6-8'", () => {
    const validBands: Persona["ageBand"][] = ["3-5", "5-7", "6-8"];
    for (const p of PERSONAS) {
      expect(validBands).toContain(p.ageBand);
    }
  });

  it("getPersonaById returns the correct persona", () => {
    const persona = getPersonaById("curly-girl-young");
    expect(persona).toBeDefined();
    expect(persona!.label).toContain("مجعد");
  });

  it("getPersonaById returns undefined for unknown id", () => {
    expect(getPersonaById("does-not-exist")).toBeUndefined();
  });

  it("personas cover both genders", () => {
    const genders = new Set(PERSONAS.map((p) => p.gender));
    expect(genders.has("boy")).toBe(true);
    expect(genders.has("girl")).toBe(true);
  });

  it("personas cover all three age bands", () => {
    const bands = new Set(PERSONAS.map((p) => p.ageBand));
    expect(bands.size).toBe(3);
  });
});
