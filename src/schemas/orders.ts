// Zod schemas for the wizard order endpoints.
// Mirrors the frontend wizard state shape (see hadouta-web/src/lib/wizard/store.ts).

import { z } from "zod";

export const ageBandSchema = z.enum(["3-5", "5-7", "6-8"]);

export const childInfoSchema = z.object({
  buyerName: z.string().min(1).max(120).optional(),
  buyerPhone: z.string().max(32).optional(),
  buyerEmail: z.string().email().max(320).optional(),
  childName: z.string().min(1).max(80).optional(),
  childAgeBand: ageBandSchema.optional(),
  childAgeExact: z.coerce.number().int().min(3).max(8).optional(),
  childGender: z.enum(["boy", "girl"]).optional(),
  childHobbies: z.string().max(500).optional(),
  childFavoriteFood: z.string().max(120).optional(),
  childFavoriteColor: z.string().max(80).optional(),
  childSpecialTraits: z.string().max(500).optional(),
});

export const appearanceSchema = z.object({
  appearanceInputType: z.enum(["photo", "description"]).optional(),
  descriptionSkinTone: z.string().max(20).optional(),
  descriptionHair: z.string().max(200).optional(),
  descriptionClothingStyle: z
    .enum(["modern", "egyptian_traditional", "school_uniform", "custom"])
    .optional(),
  descriptionEyeColor: z.string().max(80).optional(),
});

export const supportingCharacterInputSchema = z.object({
  name: z.string().min(1).max(80),
  role: z.enum(["sibling", "friend", "grandparent", "parent", "pet", "other"]),
  appearanceInputType: z.enum(["photo", "description"]),
  descriptionSkinTone: z.string().max(20).optional(),
  descriptionHair: z.string().max(200).optional(),
  descriptionClothingStyle: z
    .enum(["modern", "egyptian_traditional", "school_uniform", "custom"])
    .optional(),
  descriptionEyeColor: z.string().max(80).optional(),
  position: z.union([z.literal(1), z.literal(2)]),
});

export const storyDetailsSchema = z.object({
  themeId: z.string().uuid().optional(),
  moralValueId: z.string().uuid().optional(),
  customSceneText: z.string().max(500).optional(),
  specialOccasionText: z.string().max(200).optional(),
});

export const dedicationSchema = z.object({
  dedicationText: z.string().max(280).optional(),
});

// Combined patch payload — accepts any subset of fields plus optional
// supportingCharacters array (replaces existing chars on the order).
export const orderPatchSchema = childInfoSchema
  .merge(appearanceSchema)
  .merge(storyDetailsSchema)
  .merge(dedicationSchema)
  .extend({
    status: z
      .enum([
        "draft",
        "pending_payment",
        "paid",
        "in_production",
        "review",
        "delivered",
        "failed",
      ])
      .optional(),
    priceCents: z.number().int().min(0).optional(),
    supportingCharacters: z
      .array(supportingCharacterInputSchema)
      .max(2)
      .optional(),
  });
