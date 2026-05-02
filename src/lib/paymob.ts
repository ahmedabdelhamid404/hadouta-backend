// Paymob Unified Checkout API wrapper — Phase 5 Task 1.10.
// Uses egy_sk_test_*/egy_pk_test_* keys (the new API), NOT the legacy Accept API.
// Sandbox/live mode is determined by the key's prefix (test_ vs live_).

import crypto from "node:crypto";

const SECRET_KEY = process.env.PAYMOB_SECRET_KEY;
const PUBLIC_KEY = process.env.PAYMOB_PUBLIC_KEY;
const HMAC_SECRET = process.env.PAYMOB_HMAC_SECRET;
const BASE_URL = process.env.PAYMOB_BASE_URL ?? "https://accept.paymob.com";
const INTEGRATION_ID_CARD = process.env.PAYMOB_INTEGRATION_ID_CARD;

export function isPaymobConfigured(): boolean {
  return !!(SECRET_KEY && PUBLIC_KEY && INTEGRATION_ID_CARD);
}

export interface CreateIntentionInput {
  orderId: string;
  amountCents: number; // amount in piastres (250 EGP = 25000)
  currency?: string; // 'EGP' default
  buyerName?: string | null;
  buyerEmail?: string | null;
  buyerPhone?: string | null;
  description: string; // human-readable line item
  redirectionUrl?: string; // post-payment browser redirect (Transaction Response)
  notificationUrl?: string; // server-to-server webhook (Transaction Processed)
}

export interface CreateIntentionResult {
  clientSecret: string;
  paymobIntentionId: string;
  checkoutUrl: string;
}

/**
 * Create a payment intention via Paymob Unified Checkout API.
 * Customer is redirected to the returned checkoutUrl to complete payment.
 */
export async function createIntention(
  input: CreateIntentionInput,
): Promise<CreateIntentionResult> {
  if (!isPaymobConfigured()) {
    throw new Error(
      "Paymob not configured — set PAYMOB_SECRET_KEY + PAYMOB_PUBLIC_KEY + PAYMOB_INTEGRATION_ID_CARD",
    );
  }

  // Paymob requires non-empty billing data; fall back to safe defaults.
  const buyerName = (input.buyerName ?? "Hadouta Customer").trim();
  const [firstName, ...rest] = buyerName.split(/\s+/);
  const lastName = rest.join(" ") || "—";

  const body: Record<string, unknown> = {
    amount: input.amountCents,
    currency: input.currency ?? "EGP",
    payment_methods: [Number(INTEGRATION_ID_CARD)],
    items: [
      {
        name: input.description,
        amount: input.amountCents,
        description: input.description,
        quantity: 1,
      },
    ],
    billing_data: {
      first_name: firstName || "Hadouta",
      last_name: lastName,
      phone_number: input.buyerPhone ?? "+201000000000",
      email: input.buyerEmail ?? "noemail@hadouta.com",
      apartment: "NA",
      floor: "NA",
      street: "NA",
      building: "NA",
      shipping_method: "NA",
      postal_code: "NA",
      city: "Cairo",
      country: "EG",
      state: "NA",
    },
    extras: { hadoutaOrderId: input.orderId },
  };

  // Per-intention callback URLs (override dashboard defaults).
  // Lets us point sandbox vs production at different return endpoints.
  if (input.redirectionUrl) body.redirection_url = input.redirectionUrl;
  if (input.notificationUrl) body.notification_url = input.notificationUrl;

  const res = await fetch(`${BASE_URL}/v1/intention/`, {
    method: "POST",
    headers: {
      Authorization: `Token ${SECRET_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Paymob /v1/intention/ failed (${res.status}): ${errText}`);
  }

  const data = (await res.json()) as {
    client_secret?: string;
    id?: string | number;
  };

  if (!data.client_secret) {
    throw new Error(
      `Paymob response missing client_secret: ${JSON.stringify(data)}`,
    );
  }

  const checkoutUrl = `${BASE_URL}/unifiedcheckout/?publicKey=${PUBLIC_KEY}&clientSecret=${data.client_secret}`;

  return {
    clientSecret: data.client_secret,
    paymobIntentionId: String(data.id ?? ""),
    checkoutUrl,
  };
}

/**
 * Verify a Paymob webhook HMAC signature.
 * Paymob signs the concatenation of specific fields (alphabetically sorted)
 * with HMAC-SHA512 using the merchant's HMAC secret.
 *
 * For the Unified Checkout API, the canonical fields are:
 *   amount_cents, created_at, currency, error_occured, has_parent_transaction,
 *   id, integration_id, is_3d_secure, is_auth, is_capture, is_refunded,
 *   is_standalone_payment, is_voided, order.id, owner, pending,
 *   source_data.pan, source_data.sub_type, source_data.type, success
 *
 * @param obj  the `obj` field from Paymob's webhook payload (NOT the whole payload)
 * @param hmacFromQuery the value of the `hmac` query parameter Paymob appends
 * @returns true if signature matches, false otherwise
 */
export function verifyWebhookHmac(
  obj: Record<string, unknown>,
  hmacFromQuery: string,
): boolean {
  if (!HMAC_SECRET || !hmacFromQuery) return false;

  const fields = [
    "amount_cents",
    "created_at",
    "currency",
    "error_occured",
    "has_parent_transaction",
    "id",
    "integration_id",
    "is_3d_secure",
    "is_auth",
    "is_capture",
    "is_refunded",
    "is_standalone_payment",
    "is_voided",
    "order.id",
    "owner",
    "pending",
    "source_data.pan",
    "source_data.sub_type",
    "source_data.type",
    "success",
  ];

  const get = (path: string): string => {
    const parts = path.split(".");
    let val: unknown = obj;
    for (const p of parts) {
      if (val && typeof val === "object" && p in (val as object)) {
        val = (val as Record<string, unknown>)[p];
      } else {
        val = undefined;
        break;
      }
    }
    if (val === undefined || val === null) return "";
    if (typeof val === "boolean") return val ? "true" : "false";
    return String(val);
  };

  const concatenated = fields.map(get).join("");
  const computed = crypto
    .createHmac("sha512", HMAC_SECRET)
    .update(concatenated)
    .digest("hex");

  // Constant-time comparison
  try {
    return crypto.timingSafeEqual(
      Buffer.from(computed),
      Buffer.from(hmacFromQuery),
    );
  } catch {
    return false;
  }
}
