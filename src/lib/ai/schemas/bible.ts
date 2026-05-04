// Bible schema — locked character/setting/style/cultural anchors that all
// 17 illustration prompts inherit from. Generated once per story by
// gpt-4o-mini (with optional vision call when customer photo is uploaded).
//
// Per docs/design/specs/2026-05-03-illustration-pipeline-redesign-spec.md §5.1.

import { z } from "zod";

const childAppearanceSchema = z.object({
  hair: z
    .string()
    .min(20, "hair must be ≥20 chars — needs detail to anchor identity across pages")
    .describe(
      "Detailed locked description: type, length, color, style. e.g. 'dark curly hair pulled into two pigtails with red ribbons, shoulder length'",
    ),
  skin: z.string().min(10),
  eyes: z.string().min(10),
  distinguishing: z
    .string()
    .describe(
      "Distinguishing features that anchor identity across pages — gap teeth, dimple, freckles, glasses, etc. Empty string OK.",
    ),
});

const outfitVariationSchema = z.object({
  pageNumbers: z.array(z.number().int().min(1)),
  description: z.string().min(10),
});

const supportingCharacterSchema = z.object({
  name: z.string().min(1),
  relationship: z.string().min(1),
  appearance: z.string().min(20),
});

const secondaryLocationSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(20),
});

export const bibleSchema = z.object({
  characterBible: z.object({
    mainChild: z.object({
      name: z.string().min(1),
      age: z.number().int().min(2).max(10),
      gender: z.enum(["boy", "girl"]),
      appearance: childAppearanceSchema,
      outfit: z.object({
        default: z
          .string()
          .min(20)
          .describe(
            "Default outfit on all pages unless story changes it. Specific colors + items.",
          ),
        variations: z
          .array(outfitVariationSchema)
          .describe("Story-driven outfit changes. Most stories have 0–2."),
      }),
      personalityVisual: z
        .string()
        .min(10)
        .describe(
          "Body language, posture cues. e.g. 'energetic posture, often mid-motion, expressive eyebrows'",
        ),
    }),
    supportingCharacters: z
      .array(supportingCharacterSchema)
      .describe("MVP: empty array. Future: regional prompting per character."),
  }),
  settingBible: z.object({
    primaryLocation: z
      .string()
      .min(20)
      .describe("Where the story is mostly set. e.g. 'Hena's family apartment in Maadi, Cairo'"),
    primaryLocationDetails: z
      .string()
      .min(50)
      .describe(
        "Locked visual details that recur across pages — wall colors, furniture, recurring decor. The longer and more specific, the more consistent the illustrations.",
      ),
    secondaryLocations: z.array(secondaryLocationSchema),
  }),
  styleBible: z.object({
    medium: z.string().min(20),
    palette: z.string().min(20),
    light: z.string().min(10),
    negativeStyle: z
      .string()
      .min(20)
      .describe(
        "What this is NOT. Powerful constraints — Flux honors negative prompts. e.g. 'NOT photorealistic, NOT 3D, NOT Disney-cartoon, NOT anime, NOT vector-flat'",
      ),
    compositionAnchors: z
      .string()
      .min(20)
      .describe(
        "Composition rules that apply per page. 'subject in upper two-thirds; neutral lower third; no embedded text or signage in scene'",
      ),
  }),
  culturalNotes: z
    .array(z.string().min(10))
    .describe(
      "Story-specific cultural callouts the AI should remember. e.g. ['Story takes place during Eid el-Fitr — kahk biscuits on table, NOT chocolate chip cookies']. References the static cultural glossary.",
    ),
});

export type Bible = z.infer<typeof bibleSchema>;
