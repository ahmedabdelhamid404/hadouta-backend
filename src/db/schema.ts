// Hadouta Backend — Drizzle Database Schema (initial sketch)
// This is the Sprint 1 schema. Full schema (orders, generations, validators, embeddings)
// gets added in Sprint 3 when AI pipeline arrives.

import { pgTable, uuid, varchar, timestamp, boolean, text } from 'drizzle-orm/pg-core';

// ----- Users (managed by Better-Auth + extended here) -----
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: varchar('email', { length: 320 }).notNull().unique(),
  name: varchar('name', { length: 100 }),
  phone: varchar('phone', { length: 32 }),
  role: varchar('role', { length: 20 }).notNull().default('customer'), // 'customer' | 'admin'
  emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ----- Waitlist signups (Sprint 1 launch validation) -----
export const waitlistSignups = pgTable('waitlist_signups', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: varchar('email', { length: 320 }).notNull(),
  phone: varchar('phone', { length: 32 }),
  name: varchar('name', { length: 100 }),
  source: varchar('source', { length: 100 }), // UTM source: facebook_ad, mom_group, influencer, etc.
  utmCampaign: varchar('utm_campaign', { length: 100 }),
  utmContent: varchar('utm_content', { length: 100 }),
  notified: boolean('notified').notNull().default(false), // mark when launch email sent
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ----- Themes (sketch — full schema in Sprint 3) -----
export const themes = pgTable('themes', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: varchar('slug', { length: 50 }).notNull().unique(),
  titleAr: varchar('title_ar', { length: 100 }).notNull(),
  titleEn: varchar('title_en', { length: 100 }).notNull(),
  description: text('description'),
  ageRangeMin: varchar('age_range_min', { length: 10 }), // e.g. "3"
  ageRangeMax: varchar('age_range_max', { length: 10 }), // e.g. "5"
  status: varchar('status', { length: 20 }).notNull().default('draft'), // 'draft' | 'active' | 'archived'
  launchedAt: timestamp('launched_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ----- Orders (sketch — full schema in Sprint 3) -----
export const orders = pgTable('orders', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .references(() => users.id, { onDelete: 'set null' }),
  themeId: uuid('theme_id').references(() => themes.id, { onDelete: 'restrict' }),
  status: varchar('status', { length: 30 }).notNull().default('pending'),
  // 'pending' | 'paid' | 'generating' | 'awaiting_review' | 'approved' | 'delivered' | 'refunded' | 'failed'
  priceEgp: varchar('price_egp', { length: 10 }), // store as string to avoid float
  paymentProvider: varchar('payment_provider', { length: 30 }),
  paymentId: varchar('payment_id', { length: 200 }),
  paidAt: timestamp('paid_at', { withTimezone: true }),
  deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// Type exports for use in services
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type WaitlistSignup = typeof waitlistSignups.$inferSelect;
export type NewWaitlistSignup = typeof waitlistSignups.$inferInsert;
export type Theme = typeof themes.$inferSelect;
export type Order = typeof orders.$inferSelect;
