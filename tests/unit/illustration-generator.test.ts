// Tests for the post-2026-05-10 architecture: Google direct API
// (gemini-3.1-flash-image-preview), multi-turn refinement, skip-and-continue
// orchestrator with PageFailure aggregation, photo upper-bound clamp.
//
// The pre-2026-05-10 fal.ai-based tests (flux-kontext-pixar provider, fal.ai
// nano-banana-2 endpoints) were removed when ADR-028 + ADR-029 landed —
// the underlying code paths no longer exist.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "dotenv/config";

// Mocked node:https — illustration-generator.ts uses https.request as its
// only Google API transport (per ADR-029 Layer 1, Node fetch's undici
// 5-min timeout was incompatible with multi-turn). The mock returns a
// programmable response queue keyed off the test setup.
const httpsRequestMock = vi.fn();
vi.mock("node:https", () => ({
  request: (...args: unknown[]) => httpsRequestMock(...args),
}));

// Cloudinary upload — always mocked, never real uploads in tests.
vi.mock("../../src/lib/cloudinary.js", () => ({
  uploadImage: vi.fn(async () => ({
    publicId: "mock-public-id",
    url: "https://res.cloudinary.com/mock/image/upload/v1/path.png",
    contentType: "image/png",
    fileSize: 12345,
  })),
}));

// Stub global fetch for the static-anchor + customer-photo prefetches.
// Returns minimal Response-shaped object — fetchAsBase64 reads .ok,
// .headers.get('content-type'), and .arrayBuffer().
beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => "image/jpeg" },
      arrayBuffer: async () => new ArrayBuffer(8),
    })),
  );
  process.env.GOOGLE_AI_API_KEY = "test-key";
  process.env.STATIC_WATERCOLOR_ANCHOR_URL =
    "https://res.cloudinary.com/mock/static-watercolor-anchor.jpg";
});

afterEach(() => {
  httpsRequestMock.mockReset();
});

/**
 * Stubs Node's https.request to simulate the Google API's response shape.
 * Each call to https.request gets the next response from the queue;
 * if the queue is exhausted, the last response repeats. Each response is
 * either:
 *   { kind: "image" }                    → 200 OK with inline_data PNG
 *   { kind: "error", status, body }      → non-200 (triggers categorizeError)
 *   { kind: "stop_no_image" }            → 200 OK with finishReason=STOP, no image
 *   { kind: "safety_block" }             → 200 OK with finishReason=IMAGE_SAFETY
 */
function stubHttpsRequest(responses: Array<
  | { kind: "image" }
  | { kind: "error"; status: number; body: string }
  | { kind: "stop_no_image" }
  | { kind: "safety_block" }
>) {
  let i = 0;
  const handler = (...args: unknown[]) => {
    const callback = args[args.length - 1] as (res: {
      statusCode: number;
      on: (ev: string, cb: (chunk?: Buffer) => void) => void;
    }) => void;
    const response = responses[Math.min(i, responses.length - 1)] ?? {
      kind: "image" as const,
    };
    i++;

    let body: string;
    let statusCode: number;
    if (response.kind === "image") {
      statusCode = 200;
      body = JSON.stringify({
        candidates: [
          {
            finishReason: "STOP",
            content: {
              parts: [
                {
                  inlineData: {
                    mimeType: "image/png",
                    data: Buffer.from("fake-png").toString("base64"),
                  },
                },
              ],
            },
          },
        ],
      });
    } else if (response.kind === "error") {
      statusCode = response.status;
      body = response.body;
    } else if (response.kind === "stop_no_image") {
      statusCode = 200;
      body = JSON.stringify({
        candidates: [
          { finishReason: "STOP", content: { parts: [{ text: "I cannot generate this image." }] } },
        ],
      });
    } else {
      // safety_block
      statusCode = 200;
      body = JSON.stringify({
        candidates: [{ finishReason: "IMAGE_SAFETY" }],
      });
    }

    // Defer the callback to mimic real async behavior.
    setImmediate(() => {
      const dataHandlers: Array<(chunk?: Buffer) => void> = [];
      const endHandlers: Array<() => void> = [];
      callback({
        statusCode,
        on: (ev, cb) => {
          if (ev === "data") dataHandlers.push(cb);
          else if (ev === "end") endHandlers.push(() => cb());
        },
      });
      // Push body then end.
      setImmediate(() => {
        for (const h of dataHandlers) h(Buffer.from(body, "utf8"));
        for (const h of endHandlers) h();
      });
    });

    return {
      on: (_ev: string, _cb: () => void) => {
        // No-op — timeout/error events not exercised in these tests.
      },
      write: (_chunk: string) => {},
      end: () => {},
      destroy: () => {},
    };
  };
  httpsRequestMock.mockImplementation(handler as never);
}

const STD_INPUT = {
  orderId: "order-123",
  positivePrompt: "watercolor scene of an Egyptian girl in Cairo",
  negativePrompt: "",
  customerPhotoUrls: ["https://res.cloudinary.com/test/photo1.jpg"],
  protagonistName: "Hena",
  outfit: "yellow cotton sundress with white daisy print",
};

describe("generateCoverIllustration (Google direct + multi-turn)", () => {
  it("returns image URL + multiTurnStats when both turns succeed", async () => {
    stubHttpsRequest([{ kind: "image" }, { kind: "image" }]);
    const { generateCoverIllustration } = await import(
      "../../src/lib/ai/illustration-generator.js"
    );

    const result = await generateCoverIllustration(STD_INPUT);

    expect(result.url).toContain("res.cloudinary.com");
    expect(result.modelId).toBe("gemini-3.1-flash-image-preview");
    expect(result.multiTurnStats.turn2Succeeded).toBe(true);
    expect(result.multiTurnStats.fallbackToTurn1).toBe(false);
  });

  it("falls back to turn 1's image (with stats) when turn 2 fails permanently", async () => {
    // Turn 1 → image OK; Turn 2 → IMAGE_SAFETY (permanent, no retry).
    stubHttpsRequest([{ kind: "image" }, { kind: "safety_block" }]);
    const { generateCoverIllustration } = await import(
      "../../src/lib/ai/illustration-generator.js"
    );

    const result = await generateCoverIllustration(STD_INPUT);

    expect(result.url).toContain("res.cloudinary.com");
    expect(result.multiTurnStats.turn2Succeeded).toBe(false);
    expect(result.multiTurnStats.fallbackToTurn1).toBe(true);
    expect(result.multiTurnStats.turn2FailureCategory).toMatch(/IMAGE_SAFETY|Output Safety/);
  });

  it("throws when no customer photos provided", async () => {
    const { generateCoverIllustration } = await import(
      "../../src/lib/ai/illustration-generator.js"
    );
    await expect(
      generateCoverIllustration({ ...STD_INPUT, customerPhotoUrls: [] }),
    ).rejects.toThrow(/customer photo upload is required/i);
  });

  it("clamps customerPhotoUrls to MAX_CUSTOMER_PHOTOS=3 (V12 fix)", async () => {
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => "image/jpeg" },
      arrayBuffer: async () => new ArrayBuffer(8),
    }));
    vi.stubGlobal("fetch", fetchSpy);
    stubHttpsRequest([{ kind: "image" }, { kind: "image" }]);
    const { generateCoverIllustration } = await import(
      "../../src/lib/ai/illustration-generator.js"
    );

    await generateCoverIllustration({
      ...STD_INPUT,
      customerPhotoUrls: [
        "https://res.cloudinary.com/test/p1.jpg",
        "https://res.cloudinary.com/test/p2.jpg",
        "https://res.cloudinary.com/test/p3.jpg",
        "https://res.cloudinary.com/test/p4.jpg",
        "https://res.cloudinary.com/test/p5.jpg",
      ],
    });

    // Static anchor + 3 photos = 4 prefetches (NOT 6).
    expect(fetchSpy).toHaveBeenCalledTimes(4);
  });
});

describe("generateBodyIllustration (Google direct + multi-turn)", () => {
  it("renders a body page with multiTurnStats", async () => {
    stubHttpsRequest([{ kind: "image" }, { kind: "image" }]);
    const { generateBodyIllustration } = await import(
      "../../src/lib/ai/illustration-generator.js"
    );

    const result = await generateBodyIllustration({
      ...STD_INPUT,
      pageNumber: 5,
    });

    expect(result.url).toBeTruthy();
    expect(result.modelId).toBe("gemini-3.1-flash-image-preview");
    expect(result.multiTurnStats.turn2Succeeded).toBe(true);
  });

  it("throws when no customer photos provided", async () => {
    const { generateBodyIllustration } = await import(
      "../../src/lib/ai/illustration-generator.js"
    );
    await expect(
      generateBodyIllustration({
        ...STD_INPUT,
        pageNumber: 1,
        customerPhotoUrls: [],
      }),
    ).rejects.toThrow(/customer photo upload is required/i);
  });
});

describe("generateAllIllustrations (skip-and-continue orchestrator, V6 fix)", () => {
  it("returns all-success BatchResult when every page renders", async () => {
    // 4 illustrations × 2 turns = 8 successful https.request calls.
    stubHttpsRequest(Array(8).fill({ kind: "image" as const }));
    const { generateAllIllustrations } = await import(
      "../../src/lib/ai/illustration-generator.js"
    );

    const result = await generateAllIllustrations({
      orderId: "order-123",
      protagonistName: "Hena",
      cover: {
        positivePrompt: "cover",
        negativePrompt: "",
        outfit: "yellow sundress",
      },
      pages: [
        { pageNumber: 1, positivePrompt: "p1", negativePrompt: "", outfit: "yellow sundress" },
        { pageNumber: 2, positivePrompt: "p2", negativePrompt: "", outfit: "yellow sundress" },
        { pageNumber: 3, positivePrompt: "p3", negativePrompt: "", outfit: "yellow sundress" },
      ],
      customerPhotoUrls: ["https://res.cloudinary.com/test/p1.jpg"],
    });

    expect(result.cover).not.toBeNull();
    expect(result.cover?.url).toContain("res.cloudinary.com");
    expect(result.pages).toHaveLength(3);
    expect(result.coverFailure).toBeNull();
    expect(result.pageFailures).toEqual([]);
  });

  it("collects per-page failures without throwing — other pages still render (UC10/V6 fix)", async () => {
    // Sequence (worker concurrency = 3):
    //   - cover turn 1 → image; cover turn 2 → image  (success)
    //   - page 1 turn 1 → safety_block (permanent; turn 2 not called)
    //   - page 2 turn 1 → image; page 2 turn 2 → image (success)
    //   - page 3 turn 1 → image; page 3 turn 2 → image (success)
    //
    // Total https calls: 2 (cover) + 1 (page 1 fails) + 2 (page 2) + 2 (page 3) = 7
    // Order is non-deterministic across the 3 body workers; but assertion is
    // on AGGREGATE shape, not call order.
    //
    // Simpler: queue 7 responses in fixed order, accept that the failure
    // distribution depends on how the queue is consumed. We pad with images
    // so any extra attempts succeed (no spurious extra failures).
    stubHttpsRequest([
      { kind: "image" }, // cover turn 1
      { kind: "image" }, // cover turn 2
      { kind: "safety_block" }, // first body page's turn 1 → fails
      { kind: "image" }, // body turn 1
      { kind: "image" }, // body turn 2
      { kind: "image" }, // body turn 1
      { kind: "image" }, // body turn 2
    ]);

    const { generateAllIllustrations } = await import(
      "../../src/lib/ai/illustration-generator.js"
    );

    const result = await generateAllIllustrations({
      orderId: "order-123",
      protagonistName: "Hena",
      cover: { positivePrompt: "cover", negativePrompt: "", outfit: "y" },
      pages: [
        { pageNumber: 1, positivePrompt: "p1", negativePrompt: "", outfit: "y" },
        { pageNumber: 2, positivePrompt: "p2", negativePrompt: "", outfit: "y" },
        { pageNumber: 3, positivePrompt: "p3", negativePrompt: "", outfit: "y" },
      ],
      customerPhotoUrls: ["https://res.cloudinary.com/test/p1.jpg"],
    });

    // Cover succeeded.
    expect(result.cover).not.toBeNull();
    // Some body pages succeeded (the orchestrator did NOT short-circuit).
    expect(result.pages.length).toBeGreaterThanOrEqual(2);
    // Exactly 1 body page failed.
    expect(result.pageFailures).toHaveLength(1);
    expect(result.pageFailures[0]?.severity).toBe("error");
    expect(result.pageFailures[0]?.retryable).toBe(false); // IMAGE_SAFETY = no-retry
    expect(result.pageFailures[0]?.categoryLabel).toMatch(/Safety|Blocked/);
  });

  it("captures cover failure independently from body pages (skip-and-continue)", async () => {
    // Cover turn 1 fails permanently; body pages succeed.
    stubHttpsRequest([
      { kind: "safety_block" }, // cover turn 1 → fails
      { kind: "image" }, // body 1 turn 1
      { kind: "image" }, // body 1 turn 2
    ]);
    const { generateAllIllustrations } = await import(
      "../../src/lib/ai/illustration-generator.js"
    );

    const result = await generateAllIllustrations({
      orderId: "order-123",
      protagonistName: "Hena",
      cover: { positivePrompt: "cover", negativePrompt: "", outfit: "y" },
      pages: [
        { pageNumber: 1, positivePrompt: "p1", negativePrompt: "", outfit: "y" },
      ],
      customerPhotoUrls: ["https://res.cloudinary.com/test/p1.jpg"],
    });

    expect(result.cover).toBeNull();
    expect(result.coverFailure).not.toBeNull();
    expect(result.coverFailure?.pageNumber).toBe(0);
    expect(result.coverFailure?.retryable).toBe(false);
    expect(result.pages).toHaveLength(1);
    expect(result.pageFailures).toEqual([]);
  });
});
