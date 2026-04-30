/**
 * Quick query script to list waitlist signups (most recent first).
 * Run via: pnpm tsx src/scripts/list-signups.ts
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
  const rows = await sql`
    SELECT id, email, name, phone, source, created_at
    FROM waitlist_signups
    ORDER BY created_at DESC
    LIMIT 10
  `;
  console.log(`${rows.length} signup(s) in waitlist_signups:`);
  for (const r of rows) {
    console.log(
      `  - ${String(r.id).slice(0, 8)}…  ${r.email}  ${r.name ?? '(no name)'}  ${r.phone ?? '(no phone)'}  src=${r.source ?? '-'}  ${r.created_at}`,
    );
  }
} finally {
  await sql.end();
}
