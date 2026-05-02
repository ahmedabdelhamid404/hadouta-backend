// Hono middleware — require Better-Auth session AND role='admin'.
// Used by all routes under /api/admin/*.
//
// Sets c.var.session and c.var.user on success so handlers can read them
// without re-fetching.

import type { MiddlewareHandler } from "hono";
import { auth } from "../auth/index.js";

export const requireAdmin: MiddlewareHandler<{
  Variables: {
    session: { id: string; userId: string };
    user: { id: string; email: string; role: string; mustChangePassword: boolean };
  };
}> = async (c, next) => {
  const result = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!result?.session || !result.user) {
    return c.json({ error: "unauthorized" }, 401);
  }
  // Better-Auth's user object includes the additionalFields we declared
  // (role, mustChangePassword) so this cast is safe at runtime.
  const user = result.user as unknown as {
    id: string;
    email: string;
    role: string;
    mustChangePassword: boolean;
  };
  if (user.role !== "admin") {
    return c.json({ error: "forbidden", reason: "admin role required" }, 403);
  }
  c.set("session", { id: result.session.id, userId: result.session.userId });
  c.set("user", user);
  await next();
};
