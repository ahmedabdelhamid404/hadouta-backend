// Hadouta Backend — Drizzle Database Schema
// Sprint 1 schema. Full schema (generations, validators, embeddings) lands in Sprint 3.

import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  boolean,
  text,
} from "drizzle-orm/pg-core";

// ============================================================================
// Better-Auth tables
// Standard Better-Auth schema for Drizzle/Postgres. We add custom fields
// (phone, role) via Better-Auth's `additionalFields` config — they show up
// here as columns on the `user` table.
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

  // Custom fields (configured via additionalFields in src/auth/index.ts)
  phone: varchar("phone", { length: 32 }),
  role: varchar("role", { length: 20 }).notNull().default("customer"), // 'customer' | 'admin'
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
// Application tables
// ============================================================================

// Waitlist signups — Sprint 1 launch validation. Pre-auth, no FK to user.
export const waitlistSignups = pgTable("waitlist_signups", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: varchar("email", { length: 320 }).notNull(),
  phone: varchar("phone", { length: 32 }),
  name: varchar("name", { length: 100 }),
  source: varchar("source", { length: 100 }), // utm source
  utmCampaign: varchar("utm_campaign", { length: 100 }),
  utmContent: varchar("utm_content", { length: 100 }),
  notified: boolean("notified").notNull().default(false),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Themes — sketch (full schema in Sprint 3)
export const themes = pgTable("themes", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: varchar("slug", { length: 50 }).notNull().unique(),
  titleAr: varchar("title_ar", { length: 100 }).notNull(),
  titleEn: varchar("title_en", { length: 100 }).notNull(),
  description: text("description"),
  ageRangeMin: varchar("age_range_min", { length: 10 }),
  ageRangeMax: varchar("age_range_max", { length: 10 }),
  status: varchar("status", { length: 20 }).notNull().default("draft"),
  launchedAt: timestamp("launched_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Orders — sketch (full schema in Sprint 3). user_id references Better-Auth user.id (text).
export const orders = pgTable("orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
  themeId: uuid("theme_id").references(() => themes.id, {
    onDelete: "restrict",
  }),
  status: varchar("status", { length: 30 }).notNull().default("pending"),
  priceEgp: varchar("price_egp", { length: 10 }),
  paymentProvider: varchar("payment_provider", { length: 30 }),
  paymentId: varchar("payment_id", { length: 200 }),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Type exports
export type User = typeof user.$inferSelect;
export type NewUser = typeof user.$inferInsert;
export type Session = typeof session.$inferSelect;
export type Account = typeof account.$inferSelect;
export type WaitlistSignup = typeof waitlistSignups.$inferSelect;
export type NewWaitlistSignup = typeof waitlistSignups.$inferInsert;
export type Theme = typeof themes.$inferSelect;
export type Order = typeof orders.$inferSelect;
