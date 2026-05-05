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
import {
  generateCoverIllustration,
  generateBodyIllustration,
  generateAllIllustrations,
} from "../../src/lib/ai/illustration-generator.js";

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

    // Cover with no customer photo → text-to-image endpoint (no edit).
    expect(fal.subscribe).toHaveBeenCalledWith(
      "fal-ai/nano-banana-pro",
      expect.objectContaining({
        input: expect.objectContaining({
          prompt: expect.stringContaining("watercolor scene of an Egyptian girl in Cairo"),
        }),
      }),
    );
    // Verify negatives are folded into the prompt text.
    const lastCall = (fal.subscribe as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(lastCall[1].input.prompt).toContain("NOT photorealistic");
    expect(result.url).toContain("res.cloudinary.com");
    expect(result.modelId).toBe("nano-banana-pro");
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

describe("generateBodyIllustration", () => {
  it("uses Nano Banana edit with cover as only reference when no photoUrl", async () => {
    (fal.subscribe as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { images: [{ url: "https://fal.ai/page1.png", content_type: "image/png" }] },
    });

    await generateBodyIllustration({
      orderId: "order-123",
      pageNumber: 1,
      positivePrompt: "scene 1",
      negativePrompt: "no flat",
      coverImageUrl: "https://example.com/cover.png",
      customerPhotoUrls: [],
    });

    const lastCall = (fal.subscribe as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1)!;
    expect(lastCall[0]).toBe("fal-ai/nano-banana-pro/edit");
    expect(lastCall[1].input).toMatchObject({
      prompt: expect.stringContaining("scene 1"),
      image_urls: ["https://example.com/cover.png"],
    });
    expect(lastCall[1].input.prompt).toContain("no flat");
  });

  it("uses Nano Banana edit with photo only (NOT cover) when photoUrl provided", async () => {
    // Per iteration 7 (rollback to iter 5 architecture): body pages use ONLY
    // the photo as reference. Identity continuity reinforced via prompt
    // language in build-illustration-prompt.ts, not via additional image refs.
    (fal.subscribe as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { images: [{ url: "https://fal.ai/page2.png", content_type: "image/png" }] },
    });

    await generateBodyIllustration({
      orderId: "order-123",
      pageNumber: 2,
      positivePrompt: "scene 2",
      negativePrompt: "no flat",
      coverImageUrl: "https://example.com/cover.png",
      customerPhotoUrls: ["https://example.com/photo.jpg"],
    });

    const lastCall = (fal.subscribe as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1)!;
    expect(lastCall[0]).toBe("fal-ai/nano-banana-pro/edit");
    expect(lastCall[1].input).toMatchObject({
      image_urls: ["https://example.com/photo.jpg"],
    });
    expect(lastCall[1].input.prompt).toContain("scene 2");
  });
});

describe("generateCoverIllustration with provider=flux-kontext-pixar", () => {
  beforeEach(() => {
    process.env.PIXAR_STYLE_LORA_URL =
      "https://example.com/test-pixar-lora.safetensors";
  });

  it("calls fal-ai/flux-pro/kontext/multi with image_urls + loras", async () => {
    (fal.subscribe as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: {
        images: [{ url: "https://fal.ai/example.png", content_type: "image/png" }],
      },
    });

    const result = await generateCoverIllustration({
      orderId: "order-123",
      positivePrompt: "Egyptian girl in Cairo school courtyard",
      negativePrompt: "NOT photorealistic",
      customerPhotoUrls: [
        "https://res.cloudinary.com/test/photo1.jpg",
        "https://res.cloudinary.com/test/photo2.jpg",
      ],
      provider: "flux-kontext-pixar",
    });

    expect(fal.subscribe).toHaveBeenCalledWith(
      "fal-ai/flux-pro/kontext/multi",
      expect.objectContaining({
        input: expect.objectContaining({
          prompt: expect.stringContaining("Pixar 3D animated style"),
          image_urls: [
            "https://res.cloudinary.com/test/photo1.jpg",
            "https://res.cloudinary.com/test/photo2.jpg",
          ],
          loras: expect.arrayContaining([
            expect.objectContaining({
              path: "https://example.com/test-pixar-lora.safetensors",
            }),
          ]),
        }),
      }),
    );
    expect(result.modelId).toBe("flux-kontext-pixar");
  });

  it("falls back to existing nano-banana path when provider omitted", async () => {
    (fal.subscribe as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: {
        images: [{ url: "https://fal.ai/example.png", content_type: "image/png" }],
      },
    });
    await generateCoverIllustration({
      orderId: "order-123",
      positivePrompt: "watercolor scene",
      negativePrompt: "NOT 3D",
      customerPhotoUrls: ["https://res.cloudinary.com/test/photo1.jpg"],
    });
    expect(fal.subscribe).toHaveBeenCalledWith(
      "fal-ai/nano-banana-pro/edit",
      expect.any(Object),
    );
  });
});

describe("generateBodyIllustration with provider=flux-kontext-pixar", () => {
  beforeEach(() => {
    process.env.PIXAR_STYLE_LORA_URL =
      "https://example.com/test-pixar-lora.safetensors";
  });

  it("calls fal-ai/flux-pro/kontext/multi with image_urls + loras", async () => {
    (fal.subscribe as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: {
        images: [{ url: "https://fal.ai/page.png", content_type: "image/png" }],
      },
    });

    const result = await generateBodyIllustration({
      orderId: "order-123",
      pageNumber: 1,
      positivePrompt: "Egyptian girl walking to school",
      negativePrompt: "NOT photorealistic",
      coverImageUrl: "https://res.cloudinary.com/test/cover.png",
      customerPhotoUrls: [
        "https://res.cloudinary.com/test/photo1.jpg",
        "https://res.cloudinary.com/test/photo2.jpg",
      ],
      provider: "flux-kontext-pixar",
    });

    const call = (fal.subscribe as unknown as ReturnType<typeof vi.fn>).mock
      .calls.at(-1)!;
    expect(call[0]).toBe("fal-ai/flux-pro/kontext/multi");
    expect(call[1].input.prompt).toContain("Pixar 3D animated style");
    expect(call[1].input.image_urls).toEqual([
      "https://res.cloudinary.com/test/photo1.jpg",
      "https://res.cloudinary.com/test/photo2.jpg",
    ]);
    expect(call[1].input.loras[0].path).toBe(
      "https://example.com/test-pixar-lora.safetensors",
    );
    expect(result.modelId).toBe("flux-kontext-pixar");
  });
});

describe("generateAllIllustrations (orchestrator)", () => {
  it("generates cover first, then bodies", async () => {
    let callCount = 0;
    (fal.subscribe as unknown as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      callCount++;
      return {
        data: { images: [{ url: `https://fal.ai/img-${callCount}.png`, content_type: "image/png" }] },
      };
    });

    const result = await generateAllIllustrations({
      orderId: "order-123",
      cover: { positivePrompt: "cover", negativePrompt: "no flat" },
      pages: Array.from({ length: 3 }, (_, i) => ({
        pageNumber: i + 1,
        positivePrompt: `page ${i + 1}`,
        negativePrompt: "no flat",
      })),
      customerPhotoUrls: [],
    });

    expect(result.cover.url).toBeTruthy();
    expect(result.pages).toHaveLength(3);
    expect(callCount).toBe(4); // 1 cover + 3 pages
  });
});
