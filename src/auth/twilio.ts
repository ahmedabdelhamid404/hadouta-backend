/**
 * Twilio transport for WhatsApp + SMS OTP delivery (ADR-018 phone-first auth).
 *
 * Production: posts to Twilio's Messages API. WhatsApp is tier 1; if
 * delivery fails (Twilio returns non-2xx, or `error_code` indicates a
 * WhatsApp-specific failure), tier 2 SMS fallback runs automatically.
 *
 * Dev (no TWILIO_ACCOUNT_SID): logs the OTP to stdout with a
 * [DO-NOT-DEPLOY-WITHOUT-TWILIO] marker, the same pattern email.ts uses
 * for Resend in dev.
 */

import { z } from "zod";

const optionalNonEmpty = z.preprocess(
  (v) => (v === "" ? undefined : v),
  z.string().optional(),
);

const TwilioEnvSchema = z.object({
  TWILIO_ACCOUNT_SID: optionalNonEmpty,
  TWILIO_AUTH_TOKEN: optionalNonEmpty,
  TWILIO_WHATSAPP_FROM: optionalNonEmpty,
  TWILIO_SMS_FROM: optionalNonEmpty,
});

const env = TwilioEnvSchema.parse(process.env);
const isProduction = process.env.NODE_ENV === "production";

const hasWhatsAppCreds = Boolean(
  env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_WHATSAPP_FROM,
);
const hasSmsCreds = Boolean(
  env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_SMS_FROM,
);

if (isProduction && !hasWhatsAppCreds) {
  console.warn(
    "[twilio] WhatsApp credentials missing in production — phone OTP will fall back to dev console logging. " +
      "Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_WHATSAPP_FROM on Railway.",
  );
}

interface SendArgs {
  phoneNumber: string; // E.164 format expected (+201001234567)
  message: string;
}

async function postTwilioMessage(args: {
  to: string;
  from: string;
  body: string;
}): Promise<{ ok: boolean; errorCode?: string; status?: number }> {
  const accountSid = env.TWILIO_ACCOUNT_SID!;
  const authToken = env.TWILIO_AUTH_TOKEN!;
  const auth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");

  const params = new URLSearchParams({
    To: args.to,
    From: args.from,
    Body: args.body,
  });

  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params,
    },
  );

  if (!res.ok) {
    let errorCode: string | undefined;
    try {
      const json = (await res.json()) as { code?: number };
      errorCode = json.code?.toString();
    } catch {
      // ignore JSON parse errors
    }
    return { ok: false, errorCode, status: res.status };
  }

  return { ok: true };
}

/**
 * Send OTP via WhatsApp (tier 1). On failure, fall back to SMS (tier 2)
 * if SMS credentials are configured. Per ADR-018 multi-tier fallback.
 */
export async function sendWhatsAppOTP({
  phoneNumber,
  message,
}: SendArgs): Promise<void> {
  // Dev path — no Twilio creds → log OTP to console
  if (!hasWhatsAppCreds) {
    console.log(
      `\n[DO-NOT-DEPLOY-WITHOUT-TWILIO] Phone OTP delivery (dev stub):\n` +
        `  to: ${phoneNumber}\n` +
        `  message: ${message}\n`,
    );
    return;
  }

  // Prod path — try WhatsApp first
  const whatsAppResult = await postTwilioMessage({
    to: `whatsapp:${phoneNumber}`,
    from: `whatsapp:${env.TWILIO_WHATSAPP_FROM!}`,
    body: message,
  });

  if (whatsAppResult.ok) return;

  console.warn(
    `[twilio] WhatsApp delivery failed (status=${whatsAppResult.status}, code=${whatsAppResult.errorCode ?? "?"}) — falling back to SMS.`,
  );

  // Tier 2 — SMS fallback (per ADR-018)
  if (!hasSmsCreds) {
    throw new Error(
      `WhatsApp OTP delivery failed and SMS fallback is not configured. ` +
        `Either set TWILIO_SMS_FROM or fix WhatsApp delivery.`,
    );
  }

  const smsResult = await postTwilioMessage({
    to: phoneNumber,
    from: env.TWILIO_SMS_FROM!,
    body: message,
  });

  if (!smsResult.ok) {
    throw new Error(
      `Both WhatsApp and SMS OTP delivery failed for ${phoneNumber.slice(-4)} — ` +
        `WhatsApp status=${whatsAppResult.status}, SMS status=${smsResult.status}.`,
    );
  }
}

export const twilioConfig = {
  isProduction,
  hasWhatsAppCreds,
  hasSmsCreds,
} as const;
