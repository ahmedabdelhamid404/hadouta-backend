/**
 * One-shot script to enable the pgvector extension on Neon and verify it.
 * Run via: pnpm tsx src/scripts/enable-pgvector.ts
 *
 * Idempotent — safe to re-run.
 */
import 'dotenv/config';
import postgres from 'postgres';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL not set');
  process.exit(1);
}

const sql = postgres(url, { max: 1 });

try {
  await sql`CREATE EXTENSION IF NOT EXISTS vector`;
  const rows = await sql`
    SELECT extname, extversion
    FROM pg_extension
    WHERE extname = 'vector'
  `;
  console.log('[pgvector] enabled:', rows[0]);

  const tables = await sql`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
    ORDER BY table_name
  `;
  console.log('[tables] in public schema:');
  for (const t of tables) console.log(`  - ${t.table_name}`);
} finally {
  await sql.end();
}
