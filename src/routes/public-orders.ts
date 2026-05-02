// Public order-status endpoints — no auth, queryable by orderId or by phone.
//
// Sprint 2 first-cycle pragmatic design (security to be tightened in
// Sprint 3): the customer's "account" experience uses these endpoints.
// Phone is the user-facing identity per ADR-018 invisible-account; here
// we trust phone-as-identifier without OTP since the wizard already
// captured it during checkout.
//
// Sprint 3 will replace this with HMAC-signed magic links + Better-Auth
// phone-OTP for return visits.

import { Hono } from "hono";
import { eq, desc } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  orders,
  generations,
  themes,
  moralValues,
} from "../db/schema.js";

const publicOrdersRouter = new Hono();

// GET /api/public/order-status/:orderId — single-order status + PDF link.
publicOrdersRouter.get("/order-status/:orderId", async (c) => {
  const orderId = c.req.param("orderId");

  const rows = await db
    .select({
      orderId: orders.id,
      orderStatus: orders.status,
      childName: orders.childName,
      childAgeBand: orders.childAgeBand,
      themeTitleAr: themes.titleAr,
      moralNameAr: moralValues.nameAr,
      buyerName: orders.buyerName,
      buyerPhone: orders.buyerPhone,
      generationId: generations.id,
      generationStatus: generations.status,
      coverUrl: generations.coverUrl,
      pdfUrl: generations.pdfUrl,
      paidAt: orders.paidAt,
      deliveredAt: orders.deliveredAt,
      createdAt: orders.createdAt,
    })
    .from(orders)
    .leftJoin(themes, eq(themes.id, orders.themeId))
    .leftJoin(moralValues, eq(moralValues.id, orders.moralValueId))
    .leftJoin(generations, eq(generations.orderId, orders.id))
    .where(eq(orders.id, orderId))
    .orderBy(desc(generations.createdAt))
    .limit(1);

  if (!rows[0]) return c.json({ error: "order not found" }, 404);
  return c.json(rows[0]);
});

// GET /api/public/orders-by-phone?phone=+201xxx — list of orders for a phone.
publicOrdersRouter.get("/orders-by-phone", async (c) => {
  const phone = c.req.query("phone");
  if (!phone) return c.json({ error: "phone required" }, 400);
  const normalized = phone.trim();

  const rows = await db
    .select({
      orderId: orders.id,
      orderStatus: orders.status,
      childName: orders.childName,
      childAgeBand: orders.childAgeBand,
      themeTitleAr: themes.titleAr,
      generationStatus: generations.status,
      coverUrl: generations.coverUrl,
      pdfUrl: generations.pdfUrl,
      createdAt: orders.createdAt,
      paidAt: orders.paidAt,
      deliveredAt: orders.deliveredAt,
    })
    .from(orders)
    .leftJoin(themes, eq(themes.id, orders.themeId))
    .leftJoin(generations, eq(generations.orderId, orders.id))
    .where(eq(orders.buyerPhone, normalized))
    .orderBy(desc(orders.createdAt))
    .limit(50);

  return c.json({ orders: rows });
});

export { publicOrdersRouter };
