// Wizard order CRUD endpoints (Phase 5 implementation).
// Authentication is intentionally NOT required — wizard runs anonymous until
// step 6 phone OTP, at which point ADR-018 invisible-account semantics tie
// the order to a Better-Auth user via phone-number plugin.

import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { orders, supportingCharacters } from "../db/schema.js";
import { orderPatchSchema } from "../schemas/orders.js";

const ordersRouter = new Hono();

// POST /api/orders/draft — create a new draft order
ordersRouter.post("/draft", async (c) => {
  let buyerName: string | undefined;
  try {
    const body = (await c.req.json()) as { buyerName?: string } | undefined;
    buyerName = body?.buyerName;
  } catch {
    // empty body is fine
  }

  const inserted = await db
    .insert(orders)
    .values({
      status: "draft",
      style: "watercolor",
      buyerName: buyerName ?? null,
    })
    .returning({ id: orders.id });

  if (!inserted[0]) {
    return c.json({ error: "Failed to create order" }, 500);
  }
  return c.json({ orderId: inserted[0].id }, 201);
});

// PATCH /api/orders/:id — update partial fields per wizard step
ordersRouter.patch("/:id", async (c) => {
  const id = c.req.param("id");

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const parsed = orderPatchSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { error: "Validation failed", details: parsed.error.errors },
      400,
    );
  }

  // Verify order exists
  const existing = await db
    .select({ id: orders.id })
    .from(orders)
    .where(eq(orders.id, id))
    .limit(1);
  if (existing.length === 0) {
    return c.json({ error: "Order not found" }, 404);
  }

  // Strip supporting_characters key — handled separately
  const { supportingCharacters: chars, ...orderFields } = parsed.data;

  if (Object.keys(orderFields).length > 0) {
    await db
      .update(orders)
      .set({ ...orderFields, updatedAt: new Date() })
      .where(eq(orders.id, id));
  }

  if (Array.isArray(chars)) {
    // Replace supporting characters: delete existing, insert new
    await db
      .delete(supportingCharacters)
      .where(eq(supportingCharacters.orderId, id));
    if (chars.length > 0) {
      await db
        .insert(supportingCharacters)
        .values(chars.map((ch) => ({ ...ch, orderId: id })));
      await db
        .update(orders)
        .set({ hasSupportingCharacters: true })
        .where(eq(orders.id, id));
    } else {
      await db
        .update(orders)
        .set({ hasSupportingCharacters: false })
        .where(eq(orders.id, id));
    }
  }

  return c.json({ ok: true });
});

// GET /api/orders/:id — read full order including supporting characters
ordersRouter.get("/:id", async (c) => {
  const id = c.req.param("id");

  const order = await db
    .select()
    .from(orders)
    .where(eq(orders.id, id))
    .limit(1);
  if (order.length === 0) {
    return c.json({ error: "Order not found" }, 404);
  }

  const chars = await db
    .select()
    .from(supportingCharacters)
    .where(eq(supportingCharacters.orderId, id));

  return c.json({ ...order[0], supportingCharacters: chars });
});

export { ordersRouter };
