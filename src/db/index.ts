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
 * For high-load scenarios (Sprint 5+), switch to the pooled connection URL
 * (`DATABASE_URL_POOLED`) which is pgbouncer-fronted.
 */
const queryClient = postgres(databaseUrl, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
});

export const db = drizzle(queryClient, { schema });

export { schema };
