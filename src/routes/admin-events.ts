// Server-Sent Events stream for admin live notifications.
// Connected admin clients (the hadouta-admin app) get push-style events when
// generations enter awaiting_review or fail. Replaces polling + makes the
// review queue feel "live".
//
// Hono's streamSSE helper handles the protocol bits; we just register a
// subscription on the in-process AdminEventBus and forward events to the
// connected client until they disconnect.

import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { adminEvents, type AdminEvent } from "../lib/admin-events.js";
import { requireAdmin } from "../middleware/require-admin.js";

type AdminContext = {
  Variables: {
    session: { id: string; userId: string };
    user: { id: string; email: string; role: string; mustChangePassword: boolean };
  };
};

const adminEventsRouter = new Hono<AdminContext>();

adminEventsRouter.use("*", requireAdmin);

adminEventsRouter.get("/", (c) => {
  return streamSSE(c, async (stream) => {
    let nextId = 1;
    const sendEvent = async (event: AdminEvent) => {
      await stream.writeSSE({
        id: String(nextId++),
        event: event.type,
        data: JSON.stringify(event),
      });
    };

    // Send initial hello so the browser can confirm the channel is live.
    await sendEvent({ type: "ping", ts: Date.now() });

    const unsubscribe = adminEvents.subscribe((event) => {
      void sendEvent(event);
    });

    // Heartbeat every 25s — keeps proxies/load-balancers from killing the
    // connection as idle. Browser EventSource ignores these; they just keep
    // the TCP socket warm.
    const heartbeat = setInterval(() => {
      void sendEvent({ type: "ping", ts: Date.now() });
    }, 25_000);

    // Wait until client disconnects. stream.aborted is a Promise; we await it
    // here so the handler doesn't return early (which would close the stream).
    await stream.onAbort(() => {
      clearInterval(heartbeat);
      unsubscribe();
    });

    // Keep handler alive — Hono closes the response when this promise resolves.
    await new Promise((resolve) => {
      stream.onAbort(() => resolve(null));
    });
  });
});

export { adminEventsRouter };
