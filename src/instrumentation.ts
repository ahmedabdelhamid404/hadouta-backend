import * as Sentry from "@sentry/node";

const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? "development",
    release: process.env.npm_package_version ?? "0.1.0",

    // Sample 100% of error events (free tier supports 5K/month — plenty
    // for early Sprint 1 traffic). Adjust if volume grows.
    sampleRate: 1.0,

    // Performance tracing — sample 10% so we get visibility into slow
    // requests without burning the 10K/month tracing budget.
    tracesSampleRate: 0.1,

    // Don't send PII by default. ADR-018 + Constitution Principle VII
    // — phone numbers and emails are PII, never logged. Better-Auth
    // already suppresses its info-level logs for this reason.
    sendDefaultPii: false,

    // Ignore Hono's expected 404s — they're noise, not errors.
    ignoreErrors: ["NotFoundError", "Not Found"],
  });

  console.log(`[sentry] initialized (env=${process.env.NODE_ENV})`);
} else if (process.env.NODE_ENV === "production") {
  console.warn(
    "[sentry] SENTRY_DSN not set in production — error tracking is disabled. " +
      "Set SENTRY_DSN on Railway to enable.",
  );
}

export { Sentry };
