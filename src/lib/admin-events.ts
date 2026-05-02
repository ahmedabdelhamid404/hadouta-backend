// In-process pub/sub for admin live notifications (Sprint 2 MVP).
// Singleton EventEmitter — backend job code emits status transitions, the
// SSE route subscribes per-connection and streams to admin clients.
//
// Single-instance only. If we scale hadouta-backend horizontally (Railway
// multi-instance, Vercel functions, etc.), upgrade to Redis pub/sub or
// Trigger.dev v3 events. For 1 admin (Ahmed) on 1 backend instance, this
// is enough.

import { EventEmitter } from "node:events";

export type AdminEvent =
  | {
      type: "generation_status";
      generationId: string;
      orderId: string;
      status: string;
      // Friendly fields admins look at — denormalized so the SSE consumer
      // doesn't need to round-trip back to the API for the toast text.
      childName?: string | null;
      themeTitle?: string | null;
    }
  | {
      type: "ping";
      ts: number;
    };

class AdminEventBus extends EventEmitter {
  emitEvent(event: AdminEvent) {
    this.emit("event", event);
  }
  subscribe(handler: (event: AdminEvent) => void): () => void {
    this.on("event", handler);
    return () => {
      this.off("event", handler);
    };
  }
}

// Module-level singleton — one bus per Node process.
export const adminEvents = new AdminEventBus();

// Avoid "MaxListenersExceededWarning" if a few admins connect simultaneously
// (each SSE connection adds one listener). 50 is generous; bump if it ever
// matters.
adminEvents.setMaxListeners(50);
