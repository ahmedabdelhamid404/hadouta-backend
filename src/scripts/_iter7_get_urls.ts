import "dotenv/config";
import { eq, asc } from "drizzle-orm";
import { db } from "../db/index.js";
import { generations, bookPages } from "../db/schema.js";

const GEN_ID = "22563851-2047-4f9e-ac47-ad27e036d4ea";

async function main(): Promise<void> {
  const gen = await db.select().from(generations).where(eq(generations.id, GEN_ID)).limit(1).then((r) => r[0]);
  console.log(`Cover: ${gen?.coverUrl ?? "(none)"}`);

  const pages = await db
    .select({ pageNumber: bookPages.pageNumber, illustrationUrl: bookPages.illustrationUrl })
    .from(bookPages)
    .where(eq(bookPages.generationId, GEN_ID))
    .orderBy(asc(bookPages.pageNumber));
  for (const p of pages) {
    console.log(`Page ${p.pageNumber}: ${p.illustrationUrl}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); }).then(() => process.exit(0));
