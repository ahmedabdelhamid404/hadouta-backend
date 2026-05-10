import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    'DATABASE_URL is not set. Copy .env.example to .env and add your Neon connection string.',
  );
}

/**
 * Postgres client for the Hadouta database.
 *
 * Single connection via postgres-js. For Neon, the connection string already
 * carries `sslmode=require` and `channel_binding=require`. Drizzle handles
 * pooling at the application level when needed.
 *
 * Timeout choices (raised 2026-05-06 after E2E test ETIMEDOUT):
 *   - idle_timeout: 300 — long-running batch jobs (generate-book.ts) hold the
 *     process open for 5+ minutes while fal.ai illustration calls (~30s each)
 *     leave the DB connection idle. The previous 20s threshold closed
 *     connections during fal.ai calls; subsequent bookPages writes then had
 *     to open fresh ones, hitting Neon serverless cold-starts.
 *   - connect_timeout: 30 — Neon serverless compute can take 15-25s to wake
 *     from a fully-suspended state. The previous 10s threshold fired before
 *     Neon finished cold-starting on the first connection of a long-idle pool.
 *
 * For high-load scenarios (Sprint 5+), switch to the pooled connection URL
 * (`DATABASE_URL_POOLED`) which is pgbouncer-fronted.
 */
const queryClient = postgres(databaseUrl, {
  max: 10,
  idle_timeout: 300,
  connect_timeout: 30,
});

export const db = drizzle(queryClient, { schema });

export { schema };
