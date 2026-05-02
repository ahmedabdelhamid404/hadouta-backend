// Wizard catalog endpoints — themes (age-band-filtered) + moral values.
// Unauthenticated reads — both catalogs are public.

import { Hono } from "hono";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { themes, moralValues } from "../db/schema.js";

const catalogRouter = new Hono();

// GET /api/catalog/themes?ageBand=5-7 — filter by age band, default returns all
catalogRouter.get("/themes", async (c) => {
  const ageBand = c.req.query("ageBand");
  const validBands = new Set(["3-5", "5-7", "6-8"]);

  const result =
    ageBand && validBands.has(ageBand)
      ? await db
          .select()
          .from(themes)
          .where(
            and(
              eq(themes.active, true),
              sql`${ageBand} = ANY(${themes.suitableAgeBands})`,
            ),
          )
      : await db.select().from(themes).where(eq(themes.active, true));

  return c.json({ themes: result });
});

// GET /api/catalog/moral-values — full active list, sorted by sortOrder
catalogRouter.get("/moral-values", async (c) => {
  const values = await db
    .select()
    .from(moralValues)
    .where(eq(moralValues.active, true))
    .orderBy(moralValues.sortOrder);

  return c.json({ moralValues: values });
});

export { catalogRouter };
