import { db } from "../db/index.js";
import { aiSettings } from "../db/schema.js";

const rows = await db.select().from(aiSettings);
console.log(JSON.stringify(rows, null, 2));
process.exit(0);
