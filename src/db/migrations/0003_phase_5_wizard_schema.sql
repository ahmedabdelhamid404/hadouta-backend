-- Phase 5 wizard schema additions (Phase 3 design spec).
-- Adds: moral_values + supporting_characters + photos tables;
--       3 new enums; ~17 new columns on orders;
--       suitable_age_bands + active + description_ar/en + illustration_key on themes.
-- Hand-written because drizzle-kit's interactive snapshot prompt
-- can't be driven non-interactively (same issue as 0002).

-- ============================================================================
-- New enums
-- ============================================================================

CREATE TYPE "public"."supporting_character_role" AS ENUM (
  'sibling', 'friend', 'grandparent', 'parent', 'pet', 'other'
);

CREATE TYPE "public"."appearance_input_type" AS ENUM (
  'photo', 'description'
);

CREATE TYPE "public"."clothing_style" AS ENUM (
  'modern', 'egyptian_traditional', 'school_uniform', 'custom'
);

-- ============================================================================
-- moral_values catalog table (Phase 3 Decision 2)
-- ============================================================================

CREATE TABLE "moral_values" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name_ar" text NOT NULL,
  "name_en" text NOT NULL,
  "description" text,
  "suitable_age_bands" text[] NOT NULL DEFAULT '{}'::text[],
  "active" boolean NOT NULL DEFAULT true,
  "sort_order" integer NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

-- ============================================================================
-- themes — extend with age-band tagging + descriptions + illustration key
-- ============================================================================

ALTER TABLE "themes"
  ADD COLUMN "suitable_age_bands" text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN "description_ar" text,
  ADD COLUMN "description_en" text,
  ADD COLUMN "illustration_key" text,
  ADD COLUMN "active" boolean NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS "idx_themes_age_bands"
  ON "themes" USING gin ("suitable_age_bands");

-- ============================================================================
-- orders — extend with full wizard schema (Phase 3 design spec)
-- ============================================================================

ALTER TABLE "orders"
  ADD COLUMN "buyer_name" text,
  ADD COLUMN "buyer_phone" text,
  ADD COLUMN "buyer_email" text,
  ADD COLUMN "child_name" text,
  ADD COLUMN "child_age_band" text,
  ADD COLUMN "child_age_exact" integer,
  ADD COLUMN "child_gender" text,
  ADD COLUMN "child_hobbies" text,
  ADD COLUMN "child_favorite_food" text,
  ADD COLUMN "child_favorite_color" text,
  ADD COLUMN "child_special_traits" text,
  ADD COLUMN "appearance_input_type" "appearance_input_type",
  ADD COLUMN "description_skin_tone" text,
  ADD COLUMN "description_hair" text,
  ADD COLUMN "description_clothing_style" "clothing_style",
  ADD COLUMN "description_eye_color" text,
  ADD COLUMN "has_supporting_characters" boolean NOT NULL DEFAULT false,
  ADD COLUMN "moral_value_id" uuid REFERENCES "moral_values"("id") ON DELETE RESTRICT,
  ADD COLUMN "custom_scene_text" text,
  ADD COLUMN "special_occasion_text" text,
  ADD COLUMN "dedication_text" text,
  ADD COLUMN "price_cents" integer,
  ADD COLUMN "paymob_order_id" text;

ALTER TABLE "orders"
  ADD CONSTRAINT "child_age_band_check" CHECK (
    "child_age_band" IS NULL OR "child_age_band" IN ('3-5', '5-7', '6-8')
  ),
  ADD CONSTRAINT "child_age_exact_check" CHECK (
    "child_age_exact" IS NULL OR ("child_age_exact" BETWEEN 3 AND 8)
  ),
  ADD CONSTRAINT "child_gender_check" CHECK (
    "child_gender" IS NULL OR "child_gender" IN ('boy', 'girl')
  );

CREATE INDEX IF NOT EXISTS "idx_orders_theme_id" ON "orders" ("theme_id");
CREATE INDEX IF NOT EXISTS "idx_orders_moral_value_id" ON "orders" ("moral_value_id");
CREATE INDEX IF NOT EXISTS "idx_orders_status" ON "orders" ("status");

-- ============================================================================
-- supporting_characters table (master design spec §7.1 step 5)
-- ============================================================================

CREATE TABLE "supporting_characters" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "order_id" uuid NOT NULL REFERENCES "orders"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "role" "supporting_character_role" NOT NULL,
  "appearance_input_type" "appearance_input_type" NOT NULL,
  "photo_id" uuid,
  "description_skin_tone" text,
  "description_hair" text,
  "description_clothing_style" "clothing_style",
  "description_eye_color" text,
  "position" integer NOT NULL CHECK ("position" IN (1, 2)),
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_supporting_characters_order_id"
  ON "supporting_characters" ("order_id");

-- ============================================================================
-- photos table (Cloudflare R2-backed uploads)
-- ============================================================================

CREATE TABLE "photos" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "order_id" uuid REFERENCES "orders"("id") ON DELETE CASCADE,
  "owner_type" text NOT NULL,
  "owner_character_id" uuid REFERENCES "supporting_characters"("id") ON DELETE CASCADE,
  "url" text NOT NULL,
  "content_type" text NOT NULL,
  "file_size" integer NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_photos_order_id" ON "photos" ("order_id");
CREATE INDEX IF NOT EXISTS "idx_photos_owner_character_id" ON "photos" ("owner_character_id");
