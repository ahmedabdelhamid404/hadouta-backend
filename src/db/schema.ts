// Hadouta Backend — Drizzle Database Schema
// Sprint 1 schema. Phase 5 wizard schema added 2026-05-02.

import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  timestamp,
  boolean,
  text,
  integer,
  jsonb,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// ============================================================================
// Better-Auth tables
// Standard Better-Auth schema for Drizzle/Postgres + the phone-number plugin
// (ADR-018). Plugin-managed fields: phoneNumber, phoneNumberVerified.
// Custom fields (via additionalFields in src/auth/index.ts): role, lastVerifiedAt.
// IDs are text (Better-Auth's default — generated via createId).
// ============================================================================

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified")
    .$defaultFn(() => false)
    .notNull(),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .$defaultFn(() => new Date())
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .$defaultFn(() => new Date())
    .notNull(),

  // Better-Auth phone-number plugin columns (ADR-018 phone-first OTP).
  phoneNumber: text("phone_number").unique(),
  phoneNumberVerified: boolean("phone_number_verified")
    .$defaultFn(() => false)
    .notNull(),

  // ADR-018 risk-based step-up — most recent successful OTP verification.
  lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true }),

  // Custom fields (configured via additionalFields in src/auth/index.ts)
  role: varchar("role", { length: 20 }).notNull().default("customer"),
  // Sprint 2 — admin invite flow. New users created by an admin's invite get
  // default password "1234" and must_change_password=true; on first login the
  // admin app routes them to the change-password screen before the dashboard.
  mustChangePassword: boolean("must_change_password")
    .$defaultFn(() => false)
    .notNull(),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", {
    withTimezone: true,
  }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
    withTimezone: true,
  }),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).$defaultFn(
    () => new Date(),
  ),
  updatedAt: timestamp("updated_at", { withTimezone: true }).$defaultFn(
    () => new Date(),
  ),
});

// ============================================================================
// Phase 5 wizard enums (added 2026-05-02)
// ============================================================================

export const supportingCharacterRoleEnum = pgEnum(
  "supporting_character_role",
  ["sibling", "friend", "grandparent", "parent", "pet", "other"],
);

export const appearanceInputTypeEnum = pgEnum("appearance_input_type", [
  "photo",
  "description",
  "persona",
]);

export const clothingStyleEnum = pgEnum("clothing_style", [
  "modern",
  "egyptian_traditional",
  "school_uniform",
  "custom",
]);

// ============================================================================
// Sprint 2 AI pipeline enums (added 2026-05-02 per ADR-020)
// ============================================================================

export const generationStatusEnum = pgEnum("generation_status", [
  "queued",
  "generating_story",
  "story_done",
  "generating_illustrations",
  "illustrations_done",
  "awaiting_review",
  "approved",
  "rejected",
  "assembling_pdf",
  "delivering",
  "delivered",
  "failed",
]);

// ============================================================================
// Application tables
// ============================================================================

// Waitlist signups — Sprint 1 launch validation. Pre-auth, no FK to user.
export const waitlistSignups = pgTable("waitlist_signups", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: varchar("email", { length: 320 }).notNull(),
  phone: varchar("phone", { length: 32 }),
  name: varchar("name", { length: 100 }),
  source: varchar("source", { length: 100 }),
  utmCampaign: varchar("utm_campaign", { length: 100 }),
  utmContent: varchar("utm_content", { length: 100 }),
  notified: boolean("notified").notNull().default(false),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Moral values — Phase 3 Decision 2 (story input combinatorial).
// 8-value catalog seeded via scripts/seed-moral-values.ts.
export const moralValues = pgTable("moral_values", {
  id: uuid("id").primaryKey().defaultRandom(),
  nameAr: text("name_ar").notNull(),
  nameEn: text("name_en").notNull(),
  description: text("description"),
  suitableAgeBands: text("suitable_age_bands")
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  active: boolean("active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Themes — extended Phase 5 (2026-05-02) with age-band tagging per Phase 3 Decision 3.
// Existing columns (slug, titleAr, titleEn, status, supportedStyles, ageRangeMin/Max) preserved.
export const themes = pgTable("themes", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: varchar("slug", { length: 50 }).notNull().unique(),
  titleAr: varchar("title_ar", { length: 100 }).notNull(),
  titleEn: varchar("title_en", { length: 100 }).notNull(),
  description: text("description"),
  ageRangeMin: varchar("age_range_min", { length: 10 }),
  ageRangeMax: varchar("age_range_max", { length: 10 }),
  status: varchar("status", { length: 20 }).notNull().default("draft"),
  supportedStyles: text("supported_styles")
    .array()
    .notNull()
    .default(["watercolor"]),
  // Phase 5 additions:
  suitableAgeBands: text("suitable_age_bands")
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  descriptionAr: text("description_ar"),
  descriptionEn: text("description_en"),
  illustrationKey: text("illustration_key"),
  active: boolean("active").notNull().default(true),
  launchedAt: timestamp("launched_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Orders — extended Phase 5 (2026-05-02) with full wizard schema.
// Status values: 'draft' | 'pending_payment' | 'paid' | 'in_production' |
// 'review' | 'delivered' | 'failed' | (legacy) 'pending'.
export const orders = pgTable("orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
  themeId: uuid("theme_id").references(() => themes.id, {
    onDelete: "restrict",
  }),
  status: varchar("status", { length: 30 }).notNull().default("pending"),
  style: text("style").notNull().default("watercolor"),
  // Legacy pricing (kept for compat); priceCents is the new canonical field.
  priceEgp: varchar("price_egp", { length: 10 }),
  paymentProvider: varchar("payment_provider", { length: 30 }),
  paymentId: varchar("payment_id", { length: 200 }),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),

  // Phase 5 wizard fields (Phase 3 design spec):
  buyerName: text("buyer_name"),
  buyerPhone: text("buyer_phone"),
  buyerEmail: text("buyer_email"),
  childName: text("child_name"),
  childAgeBand: text("child_age_band"), // '3-5' | '5-7' | '6-8'
  childAgeExact: integer("child_age_exact"),
  childGender: text("child_gender"), // 'boy' | 'girl'
  childHobbies: text("child_hobbies"),
  childFavoriteFood: text("child_favorite_food"),
  childFavoriteColor: text("child_favorite_color"),
  childSpecialTraits: text("child_special_traits"),

  appearanceInputType: appearanceInputTypeEnum("appearance_input_type"),
  // When customer picks a persona from the library (no photo, no free-form
  // description) — e.g. "curly-girl-young", "hijab-girl-older". Threaded into
  // the Bible generator. See src/lib/ai/personas.ts for the full set.
  mainChildPersonaId: text("main_child_persona_id"),
  descriptionSkinTone: text("description_skin_tone"),
  descriptionHair: text("description_hair"),
  descriptionClothingStyle: clothingStyleEnum("description_clothing_style"),
  descriptionEyeColor: text("description_eye_color"),

  hasSupportingCharacters: boolean("has_supporting_characters")
    .notNull()
    .default(false),

  moralValueId: uuid("moral_value_id").references(() => moralValues.id, {
    onDelete: "restrict",
  }),
  customSceneText: text("custom_scene_text"),
  specialOccasionText: text("special_occasion_text"),
  dedicationText: text("dedication_text"),

  priceCents: integer("price_cents"), // 25000 = 250 EGP * 100
  paymobOrderId: text("paymob_order_id"),

  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Supporting characters — Phase 3 design spec (master design spec §7.1 step 5).
// Optional, max 2 per order. Each can have its own photo OR description.
export const supportingCharacters = pgTable("supporting_characters", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: uuid("order_id")
    .notNull()
    .references(() => orders.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  role: supportingCharacterRoleEnum("role").notNull(),
  appearanceInputType:
    appearanceInputTypeEnum("appearance_input_type").notNull(),
  photoId: uuid("photo_id"), // FK to photos table (added below)
  descriptionSkinTone: text("description_skin_tone"),
  descriptionHair: text("description_hair"),
  descriptionClothingStyle: clothingStyleEnum("description_clothing_style"),
  descriptionEyeColor: text("description_eye_color"),
  position: integer("position").notNull(), // 1 or 2
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Photos — Phase 5 (Cloudflare R2-backed photo uploads).
// owner_type discriminates main_child vs supporting_character.
export const photos = pgTable("photos", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: uuid("order_id").references(() => orders.id, {
    onDelete: "cascade",
  }),
  ownerType: text("owner_type").notNull(), // 'main_child' | 'supporting_character'
  ownerCharacterId: uuid("owner_character_id").references(
    () => supportingCharacters.id,
    { onDelete: "cascade" },
  ),
  url: text("url").notNull(),
  contentType: text("content_type").notNull(),
  fileSize: integer("file_size").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// AI settings — singleton row (id='singleton') with all cost-related knobs
// admin-controllable from the hadouta-admin panel. Per ADR-020 + session 9
// dev-mode tuning: defaults are cost-minimizing (Haiku not Sonnet, 8 pages
// not 16, 1 retry not 3). Production switches via admin UI.
export const aiSettings = pgTable("ai_settings", {
  id: text("id").primaryKey().default("singleton"),
  // Story model defaults to OpenAI for dev (Ahmed has OpenAI credits per
  // session 9.5 directive). Production switches to Claude via admin panel.
  storyModel: text("story_model").notNull().default("gpt-4o-mini"),
  storyMaxTokens: integer("story_max_tokens").notNull().default(4000),
  // Illustration model defaults to Google direct (Nano Banana = Gemini 2.5
  // Flash Image). fal.ai is alternative; admin panel toggles.
  illustrationModel: text("illustration_model")
    .notNull()
    .default("gemini-2.5-flash-image"),
  illustrationCount: integer("illustration_count").notNull().default(8),
  maxRetries: integer("max_retries").notNull().default(1),
  allowIllustrationFallback: boolean("allow_illustration_fallback")
    .notNull()
    .default(true),
  autoApproveThreshold: integer("auto_approve_threshold"), // null = always review (Sprint 3 reserves)
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedByUserId: text("updated_by_user_id").references(() => user.id, {
    onDelete: "set null",
  }),
});

// Generations — top-level workflow record per AI generation pass.
// Multiple generations can exist per order (rejected → retry creates a new row).
export const generations = pgTable("generations", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: uuid("order_id")
    .notNull()
    .references(() => orders.id, { onDelete: "cascade" }),
  status: generationStatusEnum("status").notNull().default("queued"),
  storyJson: jsonb("story_json"), // full Claude output: {title, dedication, pages: [...]}
  // Bible — locked character/setting/style/cultural anchors that all 17
  // illustration prompts inherit from. Null on generations predating the
  // Bible system (Sprint 2 era). See ADR-024 + 2026-05-03-illustration-
  // pipeline-redesign-spec.md §5.1.
  bibleJson: jsonb("bible_json"),
  bibleRegeneratedAt: timestamp("bible_regenerated_at", { withTimezone: true }),
  coverUrl: text("cover_url"),
  pdfUrl: text("pdf_url"),
  // Cost-tracking — captured per generation so admin can see actual $ spent
  storyTokensInput: integer("story_tokens_input"),
  storyTokensOutput: integer("story_tokens_output"),
  illustrationsCount: integer("illustrations_count"),
  estimatedCostCents: integer("estimated_cost_cents"), // store as cents, e.g. 70 = $0.70
  // Review fields
  rejectionCategory: text("rejection_category"), // 'religious'/'cultural'/'age'/'pacing'/'language'/'format'/'visual'/'other' per ADR-013
  rejectionReason: text("rejection_reason"),
  retryCount: integer("retry_count").notNull().default(0),
  errorLog: text("error_log"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  reviewedByUserId: text("reviewed_by_user_id").references(() => user.id, {
    onDelete: "set null",
  }),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Book pages — per-page story text + illustration URL + validator flags.
// pageNumber 0 = cover, 1..N = body pages.
export const bookPages = pgTable("book_pages", {
  id: uuid("id").primaryKey().defaultRandom(),
  generationId: uuid("generation_id")
    .notNull()
    .references(() => generations.id, { onDelete: "cascade" }),
  pageNumber: integer("page_number").notNull(),
  storyText: text("story_text").notNull(),
  illustrationUrl: text("illustration_url"),
  illustrationPrompt: text("illustration_prompt").notNull(),
  illustrationProvider: varchar("illustration_provider", { length: 30 }), // 'nano-banana' | 'nano-banana-pro' | 'gpt-image-2'
  illustrationGeneratedAt: timestamp("illustration_generated_at", {
    withTimezone: true,
  }),
  validationFlags: jsonb("validation_flags"), // array of {validator, severity, message}
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Type exports
export type User = typeof user.$inferSelect;
export type NewUser = typeof user.$inferInsert;
export type AiSettings = typeof aiSettings.$inferSelect;
export type NewAiSettings = typeof aiSettings.$inferInsert;
export type Generation = typeof generations.$inferSelect;
export type NewGeneration = typeof generations.$inferInsert;
export type BookPage = typeof bookPages.$inferSelect;
export type NewBookPage = typeof bookPages.$inferInsert;
export type Session = typeof session.$inferSelect;
export type Account = typeof account.$inferSelect;
export type WaitlistSignup = typeof waitlistSignups.$inferSelect;
export type NewWaitlistSignup = typeof waitlistSignups.$inferInsert;
export type Theme = typeof themes.$inferSelect;
export type NewTheme = typeof themes.$inferInsert;
export type Order = typeof orders.$inferSelect;
export type NewOrder = typeof orders.$inferInsert;
export type MoralValue = typeof moralValues.$inferSelect;
export type NewMoralValue = typeof moralValues.$inferInsert;
export type SupportingCharacter = typeof supportingCharacters.$inferSelect;
export type NewSupportingCharacter =
  typeof supportingCharacters.$inferInsert;
export type Photo = typeof photos.$inferSelect;
export type NewPhoto = typeof photos.$inferInsert;
