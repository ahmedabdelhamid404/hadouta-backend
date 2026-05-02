// Per-order user prompt builder.
// Sits between an Order row (from DB) + Theme + MoralValue + supporting chars
// and the LLM call. Translates DB columns into a natural-language input the
// model can act on.
//
// Kept deliberately tight — the system prompt carries all the craft rules.
// This file just describes THIS specific child + THIS specific order.

import type {
  Order,
  Theme,
  MoralValue,
  SupportingCharacter,
} from "../../../db/schema.js";

interface BuildStoryUserPromptArgs {
  order: Order;
  theme: Theme;
  moralValue: MoralValue;
  supportingCharacters: SupportingCharacter[];
  pageCount: number;
}

export function buildStoryUserPrompt(args: BuildStoryUserPromptArgs): string {
  const { order, theme, moralValue, supportingCharacters, pageCount } = args;

  const lines: string[] = [];

  lines.push("Please write a personalized Egyptian children's story for the child described below.");
  lines.push("");
  lines.push(`**Length: exactly ${pageCount} pages**, numbered 1..${pageCount}. The cover is a separate field, not a page.`);
  lines.push("");
  lines.push("# Child");
  lines.push(`- Name: ${order.childName ?? "(not provided)"}`);
  lines.push(`- Age band: ${order.childAgeBand ?? "(not provided)"}`);
  if (order.childAgeExact) {
    lines.push(`- Exact age: ${order.childAgeExact}`);
  }
  if (order.childGender) {
    lines.push(`- Gender: ${order.childGender}`);
  }

  const personalization: string[] = [];
  if (order.childHobbies) personalization.push(`hobbies: ${order.childHobbies}`);
  if (order.childFavoriteFood)
    personalization.push(`favorite food: ${order.childFavoriteFood}`);
  if (order.childFavoriteColor)
    personalization.push(`favorite color: ${order.childFavoriteColor}`);
  if (order.childSpecialTraits)
    personalization.push(`special traits: ${order.childSpecialTraits}`);

  if (personalization.length > 0) {
    lines.push(`- Personalization details: ${personalization.join("; ")}`);
    lines.push(
      "  (Weave 1-2 of these naturally into the story texture. Don't list them all.)",
    );
  }

  lines.push("");
  lines.push("# Theme");
  lines.push(`- Arabic title: ${theme.titleAr}`);
  lines.push(`- English label: ${theme.titleEn}`);
  if (theme.descriptionAr ?? theme.description) {
    lines.push(
      `- Description: ${theme.descriptionAr ?? theme.description ?? ""}`,
    );
  }

  lines.push("");
  lines.push("# Moral value to teach (through action, never declared)");
  lines.push(`- Arabic: ${moralValue.nameAr}`);
  lines.push(`- English: ${moralValue.nameEn}`);
  if (moralValue.description) {
    lines.push(`- Description: ${moralValue.description}`);
  }

  if (supportingCharacters.length > 0) {
    lines.push("");
    lines.push("# Supporting characters (must each play a meaningful role)");
    for (const char of supportingCharacters) {
      const parts: string[] = [`${char.name} (${char.role})`];
      if (char.descriptionSkinTone)
        parts.push(`skin tone: ${char.descriptionSkinTone}`);
      if (char.descriptionHair) parts.push(`hair: ${char.descriptionHair}`);
      lines.push(`- ${parts.join("; ")}`);
    }
  }

  if (order.specialOccasionText) {
    lines.push("");
    lines.push("# Special occasion (frame the opening scene around this)");
    lines.push(order.specialOccasionText);
  }

  if (order.customSceneText) {
    lines.push("");
    lines.push("# Custom scene (must appear somewhere in the story arc)");
    lines.push(order.customSceneText);
  }

  if (order.dedicationText) {
    lines.push("");
    lines.push("# Dedication preference from buyer (treat as a hint, write your own polished line)");
    lines.push(order.dedicationText);
  }

  lines.push("");
  lines.push(
    `Produce the story now in the structured JSON output format. Apply all craft rules from the system prompt. Output exactly ${pageCount} pages.`,
  );

  return lines.join("\n");
}
