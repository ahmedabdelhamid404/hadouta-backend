import { Resend } from "resend";
import { resendConfig } from "./index.js";

interface SendEmailArgs {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

// Lazy singletons so we don't trip the circular import with `./index.js`
// (this module is imported from index.ts before `resendConfig` is initialised).
let resendClient: Resend | null | undefined;
function getResend(): Resend | null {
  if (resendClient === undefined) {
    resendClient = resendConfig.apiKey ? new Resend(resendConfig.apiKey) : null;
  }
  return resendClient;
}

function getFromAddress(): string {
  return resendConfig.fromEmail ?? "Hadouta <noreply@mail.hadouta.com>";
}

/**
 * Send a transactional email.
 *
 * In production (RESEND_API_KEY set) → delegates to Resend.
 * In dev (no key) → logs the recipient + subject + a snippet to stdout so the
 * Better-Auth flow stays unblocked without external creds. Never throws in dev.
 *
 * If RESEND_API_KEY is missing in production we throw loudly rather than
 * silently dropping the dev fallback (which would leak reset URLs / verify
 * tokens to Railway logs).
 */
export async function sendEmail({
  to,
  subject,
  html,
  text,
}: SendEmailArgs): Promise<void> {
  const resend = getResend();

  if (!resend) {
    if (resendConfig.isProduction) {
      throw new Error("RESEND_API_KEY is required in production");
    }
    console.log(
      `[dev-email][DO-NOT-DEPLOY-WITHOUT-RESEND_API_KEY] to=${to} subject="${subject}" body="${text ?? html.slice(0, 200)}"`,
    );
    return;
  }

  const { error } = await resend.emails.send({
    from: getFromAddress(),
    to,
    subject,
    html,
    text,
  });

  if (error) {
    console.error("[email] resend send failed", error);
  }
}
