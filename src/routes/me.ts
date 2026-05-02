// Customer self-serve endpoints — anything the logged-in customer needs to
// see their own orders + generation status + PDF download links.
//
// Auth gate: any authenticated session (no role check). The lookup is keyed
// off the session's user.phoneNumber and falls back to user.id, so legacy
// orders without buyerPhone still match.

import { Hono } from "hono";
import { eq, or, desc } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  orders,
  generations,
  themes,
  moralValues,
} from "../db/schema.js";
import { auth } from "../auth/index.js";

type CustomerContext = {
  Variables: {
    userId: string;
    phoneNumber: string | null;
  };
};

const meRouter = new Hono<CustomerContext>();

meRouter.use("*", async (c, next) => {
  const result = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!result?.user) {
    return c.json({ error: "unauthorized" }, 401);
  }
  const u = result.user as unknown as { id: string; phoneNumber?: string | null };
  c.set("userId", u.id);
  c.set("phoneNumber", u.phoneNumber ?? null);
  await next();
});

// GET /api/me/orders — list the current customer's orders, with the latest
// generation per order joined in.
meRouter.get("/orders", async (c) => {
  const userId = c.get("userId");
  const phoneNumber = c.get("phoneNumber");

  const filters = phoneNumber
    ? or(eq(orders.userId, userId), eq(orders.buyerPhone, phoneNumber))
    : eq(orders.userId, userId);

  const rows = await db
    .select({
      id: orders.id,
      status: orders.status,
      childName: orders.childName,
      childAgeBand: orders.childAgeBand,
      themeTitleAr: themes.titleAr,
      moralNameAr: moralValues.nameAr,
      priceCents: orders.priceCents,
      createdAt: orders.createdAt,
      paidAt: orders.paidAt,
      deliveredAt: orders.deliveredAt,
      generationId: generations.id,
      generationStatus: generations.status,
      coverUrl: generations.coverUrl,
      pdfUrl: generations.pdfUrl,
    })
    .from(orders)
    .leftJoin(themes, eq(themes.id, orders.themeId))
    .leftJoin(moralValues, eq(moralValues.id, orders.moralValueId))
    .leftJoin(generations, eq(generations.orderId, orders.id))
    .where(filters)
    .orderBy(desc(orders.createdAt))
    .limit(100);

  return c.json({ orders: rows });
});

export { meRouter };
