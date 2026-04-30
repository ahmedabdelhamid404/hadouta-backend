import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { cors } from "hono/cors";
import "dotenv/config";
import { auth } from "../../src/auth/index.js";

/**
 * Integration tests for Better-Auth wiring.
 *
 * NOTE: these run against the live Neon dev DB (the constitution does not yet
 * mandate a separate test database for Sprint 1). Each run uses a unique
 * email so reruns don't collide on the unique-email constraint.
 *
 * Test data accumulation: each run leaves throwaway
 * `test-{ts}-{rand}@example.com` rows in the `user`, `account`, and `session`
 * tables of the dev Neon DB. Cleanup (truncate fixture or per-test teardown)
 * is a Sprint-2 followup.
 *
 * The Hono app here mirrors the auth-handler mount in src/server.ts. It is
 * intentionally minimal — we only exercise the auth surface, not the rest of
 * the routes — so this test stays orthogonal to the OpenAPI route stack.
 */
function buildAuthApp(): Hono {
  const app = new Hono();
  app.use(
    "*",
    cors({
      origin: process.env.FRONTEND_URL ?? "http://localhost:3000",
      credentials: true,
    }),
  );
  app.on(["POST", "GET"], "/api/auth/*", (c) => auth.handler(c.req.raw));
  return app;
}

describe("Better-Auth email/password flow", () => {
  const app = buildAuthApp();
  const email = `test-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
  const password = "abcd1234";
  const name = "Test User";

  it("signs up a new user with email/password", async () => {
    const res = await app.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, name }),
    });

    expect(res.status).toBe(200);

    const setCookie = res.headers.get("set-cookie");
    const body = (await res.json()) as { user?: { email?: string }; token?: string };

    // Better-Auth returns either a session cookie OR a token (or both),
    // depending on configuration. We accept either as a "session established" signal.
    const hasSessionEvidence =
      Boolean(setCookie && setCookie.length > 0) || Boolean(body.token);

    expect(hasSessionEvidence).toBe(true);
    expect(body.user?.email).toBe(email);
  });

  it("signs in with the same credentials", async () => {
    const res = await app.request("/api/auth/sign-in/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    expect(res.status).toBe(200);

    const body = (await res.json()) as { user?: { email?: string }; token?: string };
    expect(body.user?.email).toBe(email);
  });

  it("rejects a duplicate sign-up with the same email", async () => {
    const res = await app.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, name }),
    });

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });
});
