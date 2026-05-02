// Admin endpoints for the generation review queue.
// Mounted under /api/admin/generations. All routes gated by requireAdmin.

import { Hono } from "hono";
import { eq, desc, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  generations,
  bookPages,
  orders,
  themes,
  moralValues,
} from "../db/schema.js";
import { requireAdmin } from "../middleware/require-admin.js";
import { assembleBookPdf } from "../lib/pdf/render-book.js";
import { adminEvents } from "../lib/admin-events.js";

type AdminContext = {
  Variables: {
    session: { id: string; userId: string };
    user: { id: string; email: string; role: string; mustChangePassword: boolean };
  };
};

const adminGenerationsRouter = new Hono<AdminContext>();

adminGenerationsRouter.use("*", requireAdmin);

// GET /api/admin/generations?status=awaiting_review — list with filtering.
// Default returns awaiting_review (the primary review queue).
adminGenerationsRouter.get("/", async (c) => {
  const statusParam = c.req.query("status") ?? "awaiting_review";
  const statusList = statusParam.split(",").map((s) => s.trim()).filter(Boolean);

  const rows = await db
    .select({
      id: generations.id,
      orderId: generations.orderId,
      status: generations.status,
      coverUrl: generations.coverUrl,
      illustrationsCount: generations.illustrationsCount,
      estimatedCostCents: generations.estimatedCostCents,
      retryCount: generations.retryCount,
      createdAt: generations.createdAt,
      completedAt: generations.completedAt,
      childName: orders.childName,
      childAgeBand: orders.childAgeBand,
      themeTitleAr: themes.titleAr,
      moralNameAr: moralValues.nameAr,
    })
    .from(generations)
    .leftJoin(orders, eq(orders.id, generations.orderId))
    .leftJoin(themes, eq(themes.id, orders.themeId))
    .leftJoin(moralValues, eq(moralValues.id, orders.moralValueId))
    .where(
      statusList.length > 0
        ? inArray(generations.status, statusList as Array<typeof generations.status.enumValues[number]>)
        : undefined,
    )
    .orderBy(desc(generations.createdAt))
    .limit(200);

  return c.json({ generations: rows });
});

// GET /api/admin/generations/:id — full detail with all pages.
adminGenerationsRouter.get("/:id", async (c) => {
  const id = c.req.param("id");

  const genRows = await db
    .select()
    .from(generations)
    .where(eq(generations.id, id))
    .limit(1);
  const generation = genRows[0];
  if (!generation) {
    return c.json({ error: "generation not found" }, 404);
  }

  const orderRows = await db
    .select()
    .from(orders)
    .where(eq(orders.id, generation.orderId))
    .limit(1);
  const order = orderRows[0];

  let theme = null;
  let moralValue = null;
  if (order?.themeId) {
    theme =
      (await db.select().from(themes).where(eq(themes.id, order.themeId)).limit(1))[0] ?? null;
  }
  if (order?.moralValueId) {
    moralValue =
      (
        await db
          .select()
          .from(moralValues)
          .where(eq(moralValues.id, order.moralValueId))
          .limit(1)
      )[0] ?? null;
  }

  const pages = await db
    .select()
    .from(bookPages)
    .where(eq(bookPages.generationId, id))
    .orderBy(bookPages.pageNumber);

  return c.json({ generation, order, theme, moralValue, pages });
});

// POST /api/admin/generations/:id/approve
// Marks the generation approved + flips order to delivered. PDF assembly +
// delivery are wired in Task #48 (next step).
adminGenerationsRouter.post("/:id/approve", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");

  const genRows = await db
    .select({ id: generations.id, orderId: generations.orderId, status: generations.status })
    .from(generations)
    .where(eq(generations.id, id))
    .limit(1);
  const generation = genRows[0];
  if (!generation) return c.json({ error: "generation not found" }, 404);
  if (generation.status !== "awaiting_review") {
    return c.json(
      { error: "invalid state", reason: `expected awaiting_review, got ${generation.status}` },
      409,
    );
  }

  await db
    .update(generations)
    .set({
      status: "assembling_pdf",
      reviewedAt: new Date(),
      reviewedByUserId: user.id,
      updatedAt: new Date(),
    })
    .where(eq(generations.id, id));

  // Fire-and-forget PDF assembly. Returns 200 to admin immediately so the
  // UI can flip to "assembling…" state; SSE pushes the "delivered" event
  // when the PDF lands and the customer's account page can show the
  // download link.
  void assembleBookPdf({ generationId: id })
    .then((result) => {
      console.log(
        `[admin] PDF assembled for generation=${id}: ${result.pdfUrl} (${result.bytes} bytes, ${result.durationMs}ms)`,
      );
      adminEvents.emitEvent({
        type: "generation_status",
        generationId: id,
        orderId: generation.orderId,
        status: "delivered",
      });
    })
    .catch(async (err) => {
      console.error(`[admin] PDF assembly failed for generation=${id}:`, err);
      const errorMessage =
        err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : String(err);
      await db
        .update(generations)
        .set({
          status: "failed",
          errorLog: `PDF assembly: ${errorMessage}`.slice(0, 8000),
          updatedAt: new Date(),
        })
        .where(eq(generations.id, id));
      adminEvents.emitEvent({
        type: "generation_status",
        generationId: id,
        orderId: generation.orderId,
        status: "failed",
      });
    });

  return c.json({ ok: true, generationId: id, status: "assembling_pdf" });
});

// POST /api/admin/generations/:id/reject — body: { category, reason }
adminGenerationsRouter.post("/:id/reject", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");

  let body: { category?: string; reason?: string };
  try {
    body = (await c.req.json()) as typeof body;
  } catch {
    return c.json({ error: "JSON body required" }, 400);
  }
  if (!body.category) {
    return c.json({ error: "category required" }, 400);
  }

  const genRows = await db
    .select({ id: generations.id, status: generations.status })
    .from(generations)
    .where(eq(generations.id, id))
    .limit(1);
  if (!genRows[0]) return c.json({ error: "generation not found" }, 404);

  await db
    .update(generations)
    .set({
      status: "rejected",
      rejectionCategory: body.category,
      rejectionReason: body.reason ?? null,
      reviewedAt: new Date(),
      reviewedByUserId: user.id,
      updatedAt: new Date(),
    })
    .where(eq(generations.id, id));

  return c.json({ ok: true, generationId: id, status: "rejected" });
});

export { adminGenerationsRouter };
