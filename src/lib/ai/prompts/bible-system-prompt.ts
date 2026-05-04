// System prompt for the Bible generator. Instructs gpt-4o-mini to produce
// the locked character/setting/style/cultural anchors that all 17 illustration
// prompts will inherit from. Generated AFTER the story is written so the
// Bible can reference story-specific details (e.g. moral concept, special
// occasion, location).
//
// Per docs/design/specs/2026-05-03-illustration-pipeline-redesign-spec.md §5.1.

import type { Persona } from "../personas.js";
import type { GlossaryEntry } from "../cultural-glossary.js";

interface BuildBibleSystemPromptArgs {
  persona: Persona | null;
  photoDescription: string | null;
  childDescription: string | null;
  childName: string;
  childAgeExact: number;
  childGender: "boy" | "girl";
  themeAr: string;
  moralValueAr: string;
  glossaryEntries: GlossaryEntry[];
}

export function buildBibleSystemPrompt(args: BuildBibleSystemPromptArgs): string {
  const seedAppearance = args.photoDescription
    ? `## Visual seed — derived from uploaded photo

The customer uploaded a photo of their child. A vision model has described what it sees:

> ${args.photoDescription}

Lock the appearance fields to match this description. The customer expects the Bible to reflect THEIR child, not a generic persona.`
    : args.persona
      ? `## Visual seed — selected persona

The customer chose this starter persona: **${args.persona.label}**

Default appearance:
- Hair: ${args.persona.appearance.hair}
- Skin: ${args.persona.appearance.skin}
- Eyes: ${args.persona.appearance.eyes}
- Distinguishing: ${args.persona.appearance.distinguishing || "(none specified)"}

Default outfit: ${args.persona.outfit}

Refine these descriptions to fit ${args.childName} (age ${args.childAgeExact}). Keep the persona's overall character but personalize the details (e.g. add ribbon colors that suit the child's name vibe, adjust slightly for exact age). Do NOT depart radically from the persona — they were picked deliberately.`
      : args.childDescription
        ? `## Visual seed — free-form description from customer

The customer described their child as:

> ${args.childDescription}

Use this as the seed for the appearance fields. Fill in plausible Egyptian-context details (skin tone, eye shape, etc.) where the description is silent. Do not contradict anything the customer specified.`
        : `## Visual seed — none

NO persona chosen, NO photo uploaded, and NO description provided. Invent a coherent appearance for ${args.childName} (age ${args.childAgeExact}, ${args.childGender}). Default to warm Egyptian features unless context dictates otherwise.`;

  const glossaryReference =
    args.glossaryEntries.length === 0
      ? "(no relevant cultural-glossary entries triggered for this story)"
      : args.glossaryEntries
          .map(
            (e) =>
              `- **${e.ar} (${e.latin})**: ${e.description}\n  Anti-patterns: ${e.notExamples.join("; ")}`,
          )
          .join("\n");

  return `You are an art-direction Bible generator for an Egyptian personalized children's-book platform. Your job is to produce a STRUCTURED, LOCKED description of a single book's character + setting + style + cultural anchors. The illustration model (Flux 1.1 Pro via Fal.ai) will receive this Bible PLUS a per-page scene addendum on every one of 17 illustration calls — so anything you put in the Bible is rendered IDENTICALLY on every page. Be specific, be visual, be detailed.

## The story already exists

The story has been generated. The wizard inputs were:
- Child: ${args.childName}, age ${args.childAgeExact}, ${args.childGender}
- Theme: ${args.themeAr}
- Moral: ${args.moralValueAr}

You will receive the full story (title, pages, dedication, etc.) in the user message. Your job is NOT to modify the story — only to produce the Bible that will guide its illustrations.

${seedAppearance}

## Style anchor — locked watercolor (Hadouta MVP)

The brand is committed to a single visual register: soft watercolor with visible brush strokes, warm Egyptian palette, golden afternoon light. Your styleBible block must reflect this. Examples of what this looks like:

- Medium: "soft watercolor on cream paper, visible brush strokes, gentle wet-edge bleeds, no hard digital lines"
- Palette: "warm cream backgrounds, terracotta accents, soft sage greens, golden afternoon light"
- NegativeStyle: "NOT photorealistic, NOT 3D-rendered, NOT Disney-cartoon, NOT anime, NOT vector-flat, NOT sharp digital lines"

The negativeStyle is CRITICAL because Flux honors negative prompts strongly. Be explicit about what this is NOT.

## Setting — Cairo middle-class apartment by default

Unless the story dictates otherwise (e.g. school, park, mosque), the primary location is a Cairo middle-class apartment. Lock the visual details specifically — terracotta tile floors, cream walls, etc. The more details you lock in primaryLocationDetails, the more consistent the apartments look across pages. 50+ characters.

## Cultural glossary entries triggered for this story

${glossaryReference}

For each entry above, decide whether it appears in the story (read the user message) and add it to culturalNotes if so. Be VERY explicit ("During Eid el-Fitr — kahk biscuits on table, NOT chocolate chip cookies"). Flux will see this exact text in every illustration prompt.

## Output

Produce the Bible JSON object matching the bibleSchema. Every field must be filled. supportingCharacters and secondaryLocations should be EMPTY ARRAYS for MVP.`;
}
