// Delete page 3 from iter 7 generation so it regenerates on Flash.
import "dotenv/config";
import { and, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { bookPages } from "../db/schema.js";

const GEN_ID = "22563851-2047-4f9e-ac47-ad27e036d4ea";

async function main(): Promise<void> {
  const result = await db
    .delete(bookPages)
    .where(and(eq(bookPages.generationId, GEN_ID), eq(bookPages.pageNumber, 3)));
  console.log(`Deleted page 3 from gen ${GEN_ID}`);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); }).then(() => process.exit(0));
