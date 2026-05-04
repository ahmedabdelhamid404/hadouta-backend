import { describe, expect, it, vi, beforeEach } from "vitest";
import "dotenv/config";

// Mock @fal-ai/client BEFORE importing the module under test so the import
// of `fal` resolves to the mock.
vi.mock("@fal-ai/client", () => ({
  fal: {
    config: vi.fn(),
    subscribe: vi.fn(),
  },
}));

// Mock the cloudinary wrapper module since we don't want real uploads either.
vi.mock("../../src/lib/cloudinary.js", () => ({
  uploadImage: vi.fn(async () => ({
    publicId: "mock-public-id",
    url: "https://res.cloudinary.com/mock/image/upload/v1/path.png",
    contentType: "image/png",
    fileSize: 12345,
  })),
}));

// Stub global fetch (the implementation downloads Fal.ai's image bytes via fetch).
beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(8),
    })),
  );
  // Ensure FAL_KEY is set for the configure-once code path.
  process.env.FAL_KEY = "test-key";
});

import { fal } from "@fal-ai/client";
import { generateCoverIllustration } from "../../src/lib/ai/illustration-generator.js";

describe("generateCoverIllustration", () => {
  it("calls fal-ai/flux-pro/v1.1 with positive + negative prompt", async () => {
    (fal.subscribe as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: {
        images: [{ url: "https://fal.ai/example.png", content_type: "image/png" }],
      },
    });

    const result = await generateCoverIllustration({
      orderId: "order-123",
      positivePrompt: "watercolor scene of an Egyptian girl in Cairo",
      negativePrompt: "NOT photorealistic NOT 3D",
    });

    expect(fal.subscribe).toHaveBeenCalledWith(
      "fal-ai/flux-pro/v1.1",
      expect.objectContaining({
        input: expect.objectContaining({
          // Flux 1.1 Pro doesn't accept negative_prompt — negatives are
          // embedded into the positive prompt as natural-language constraints.
          prompt: expect.stringContaining("watercolor scene of an Egyptian girl in Cairo"),
        }),
      }),
    );
    // Verify negatives are folded into the prompt text.
    const lastCall = (fal.subscribe as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(lastCall[1].input.prompt).toContain("NOT photorealistic");
    expect(result.url).toContain("res.cloudinary.com");
    expect(result.modelId).toBe("flux-pro-1.1");
  });

  it("throws if no image returned", async () => {
    (fal.subscribe as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { images: [] },
    });

    await expect(
      generateCoverIllustration({
        orderId: "order-123",
        positivePrompt: "x",
        negativePrompt: "y",
      }),
    ).rejects.toThrow(/no image|empty/i);
  });
});
