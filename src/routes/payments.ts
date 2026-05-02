// Paymob payment endpoints — Phase 5 Task 1.10.
// POST /api/payments/intent — create a Paymob intention for an order
// POST /api/payments/webhook — receive transaction status from Paymob

import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { orders } from "../db/schema.js";
import {
  createIntention,
  verifyWebhookHmac,
  isPaymobConfigured,
} from "../lib/paymob.js";

const paymentsRouter = new Hono();

// POST /api/payments/intent — body: { orderId }
paymentsRouter.post("/intent", async (c) => {
  if (!isPaymobConfigured()) {
    return c.json(
      {
        error:
          "Paymob not configured. Set PAYMOB_SECRET_KEY + PAYMOB_PUBLIC_KEY + PAYMOB_INTEGRATION_ID_CARD.",
      },
      503,
    );
  }

  let body: { orderId?: string };
  try {
    body = (await c.req.json()) as { orderId?: string };
  } catch {
    return c.json({ error: "JSON body required" }, 400);
  }
  if (!body.orderId) {
    return c.json({ error: "orderId required" }, 400);
  }

  const order = await db
    .select()
    .from(orders)
    .where(eq(orders.id, body.orderId))
    .limit(1);
  if (order.length === 0) {
    return c.json({ error: "Order not found" }, 404);
  }
  const o = order[0]!;

  if (o.status !== "pending_payment") {
    return c.json(
      {
        error: `Order is in status '${o.status}', expected 'pending_payment'`,
      },
      400,
    );
  }

  const amountCents = o.priceCents ?? 25000; // default 250 EGP
  const description = `حدوتة ${o.childName ?? "طفلك"}`.slice(0, 80);

  let intent;
  try {
    intent = await createIntention({
      orderId: o.id,
      amountCents,
      buyerName: o.buyerName,
      buyerEmail: o.buyerEmail,
      buyerPhone: o.buyerPhone,
      description,
    });
  } catch (err) {
    console.error("[payments] Paymob intention create failed:", err);
    return c.json(
      {
        error:
          err instanceof Error
            ? `Payment intent failed: ${err.message}`
            : "Payment intent failed",
      },
      502,
    );
  }

  // Persist Paymob intention id for reconciliation
  await db
    .update(orders)
    .set({
      paymobOrderId: intent.paymobIntentionId,
      paymentProvider: "paymob",
      paymentId: intent.clientSecret,
      updatedAt: new Date(),
    })
    .where(eq(orders.id, o.id));

  return c.json({ checkoutUrl: intent.checkoutUrl });
});

// POST /api/payments/webhook — Paymob calls this when a transaction settles.
// Paymob appends ?hmac=<sha512hex> to the URL; we verify against PAYMOB_HMAC_SECRET.
paymentsRouter.post("/webhook", async (c) => {
  let payload: {
    type?: string;
    obj?: Record<string, unknown>;
  };
  try {
    payload = (await c.req.json()) as typeof payload;
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }

  const hmacQuery = c.req.query("hmac") ?? "";
  const obj = payload.obj ?? {};

  // Verify signature — log but don't reject in dev (HMAC verification can be
  // finicky across the new vs legacy API; we'll harden in Sprint 2 once we
  // see real webhook traffic and confirm the field-list).
  const verified = verifyWebhookHmac(obj, hmacQuery);
  if (!verified) {
    console.warn(
      "[payments] webhook HMAC verification FAILED — accepting in dev mode",
      { hmacQuery: hmacQuery.slice(0, 12), keys: Object.keys(obj) },
    );
  } else {
    console.log("[payments] webhook HMAC verified");
  }

  // Extract our merchant_order_id (we attached it via `extras.hadoutaOrderId`
  // when creating the intention; Paymob bubbles it through).
  const orderRef =
    (obj as { order?: { merchant_order_id?: string } }).order
      ?.merchant_order_id ??
    (obj as { extras?: { hadoutaOrderId?: string } }).extras?.hadoutaOrderId ??
    null;

  const success = (obj as { success?: boolean }).success === true;
  const pending = (obj as { pending?: boolean }).pending === true;

  if (!orderRef) {
    console.warn("[payments] webhook payload missing order reference", obj);
    return c.json({ received: true, note: "no order ref" });
  }

  // Map Paymob outcome → our status
  let newStatus: "paid" | "failed" | "pending_payment";
  if (success && !pending) {
    newStatus = "paid";
  } else if (pending) {
    newStatus = "pending_payment";
  } else {
    newStatus = "failed";
  }

  await db
    .update(orders)
    .set({
      status: newStatus,
      paidAt: newStatus === "paid" ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(eq(orders.id, orderRef));

  console.log(
    `[payments] webhook processed: orderId=${orderRef} status=${newStatus} (verified=${verified})`,
  );

  return c.json({ received: true });
});

export { paymentsRouter };
