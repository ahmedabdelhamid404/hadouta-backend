// Illustration generator — Flux 1.1 Pro via Fal.ai (replaces Gemini 2.5 Flash Image
// per docs/design/specs/2026-05-03-illustration-pipeline-redesign-spec.md §5.5).
//
// Pipeline:
//   - Cover: Flux only (no reference yet) via fal-ai/flux-pro/v1.1.
//   - Body pages: Flux + optional PuLID (face injection from customer photo)
//                 + reference_image_url = generated cover URL (Edit-based pipeline).
//                 [body path implemented in Task 10]
//
// All uploads to Cloudinary as before (preserve existing storage path and
// folder convention for backward compatibility with admin UI image lookups).

import { fal } from "@fal-ai/client";
import { uploadImage } from "../cloudinary.js";
import { appendPixarStyleAnchor } from "./prompts/build-illustration-prompt.js";

const FLUX_KONTEXT_MULTI = "fal-ai/flux-pro/kontext/multi";

export type IllustrationProvider = "nano-banana" | "flux-kontext-pixar";

// Pivot to Nano Banana (Gemini 2.5 Flash Image) per Phase H iteration 3 (2026-05-05):
// 3 iterations of Flux+PuLID tuning showed PuLID's portrait-only ceiling can't
// render character-in-scene illustrations. Nano Banana renders rich Egyptian
// scenes well (Sprint 2 confirmed) and Pro-Edit accepts multiple reference
// images for character continuity.
//
// Architecture:
//   Cover       → fal-ai/nano-banana-2/edit, image_urls = [photoUrl]
//                 Or non-edit if no photo. Photo provides identity.
//   Body pages  → fal-ai/nano-banana-2/edit, image_urls = [coverUrl, photoUrl?]
//                 Cover provides character/style/scene continuity. Photo (if any)
//                 reinforces face identity. Gemini's multimodal vision merges both.
//
// Phase 1 iteration 6 (2026-05-06): upgraded from `nano-banana-pro` (Gemini 3 Pro
// Image, $0.15/edit) to `nano-banana-2` (Gemini 3.1 Flash Image, $0.08/edit). The
// "2" model is Google's Feb-2026 release combining Pro-quality reasoning with
// Flash-tier speed at ~half the price. Same multi-image-edit API shape, drop-in
// swap. See https://fal.ai/models/fal-ai/nano-banana-2/edit
const NANO_BANANA_2_EDIT = "fal-ai/nano-banana-2/edit";
const NANO_BANANA_2 = "fal-ai/nano-banana-2";
// Legacy Flux endpoints — kept for reference; no longer called.
// const FLUX_PRO_ENDPOINT = "fal-ai/flux-pro/v1.1";
// const FLUX_REDUX_ENDPOINT = "fal-ai/flux-pro/v1.1/redux";
// const FLUX_PULID_ENDPOINT = "fal-ai/flux-pulid";

/**
 * Apply Cloudinary face-detection crop transformation to a customer photo URL
 * before passing to PuLID. PuLID's InsightFace face encoder needs the face to
 * occupy ≥30% of the frame for a strong identity vector; full-body wizard
 * uploads typically have face at ~10% of frame, producing weak vectors.
 *
 * Cloudinary's c_thumb,g_face crops to a face-centered square. If the URL is
 * not a Cloudinary URL or already has transformations, returns it unchanged.
 *
 * Per Phase H verification 2026-05-04 — full-body photos produced illustrations
 * where the boy's face only weakly matched the photo. Face-crop addresses this
 * without touching the original photo (which is still used as-is by the Bible
 * vision call to capture clothing context).
 */
function pulidFaceCropUrl(url: string): string {
  if (!url.includes("res.cloudinary.com") || !url.includes("/upload/")) {
    return url;
  }
  if (
    url.includes("/upload/c_") ||
    url.includes("/upload/g_") ||
    url.includes("/upload/w_")
  ) {
    return url; // already has transformations — don't double-apply
  }
  return url.replace(
    "/upload/",
    "/upload/c_thumb,g_face,w_512,h_512,z_0.7,f_jpg/",
  );
}

let _falConfigured = false;
function ensureFalConfigured(): void {
  if (_falConfigured) return;
  const key = process.env.FAL_KEY;
  if (!key) {
    throw new Error("FAL_KEY not set — cannot generate illustrations.");
  }
  fal.config({ credentials: key });
  _falConfigured = true;
}

export interface CoverInput {
  orderId: string;
  positivePrompt: string;
  negativePrompt: string;
  /** Optional — when set (1-3 photos), used as reference images so cover reflects the actual child. */
  customerPhotoUrls?: string[];
  /** Provider selector — default 'nano-banana'. 'flux-kontext-pixar' uses Flux Kontext Multi + Pixar style LoRA. */
  provider?: IllustrationProvider;
}

export interface IllustrationResult {
  url: string;
  contentType: string;
  fileSize: number;
  modelId: string;
  durationMs: number;
}

/**
 * Phase 1 (2026-05-05) — Flux Kontext Multi + Pixar-3D Style LoRA.
 *
 * Used when ai_settings.illustration_model = 'flux-kontext-pixar'.
 * Falls back to plain `fal-ai/flux-pro/kontext/multi` (no LoRA) if
 * PIXAR_STYLE_LORA_URL is not set in env (per spec §4.5 Fallback A).
 */
async function callFluxKontextPixar(args: {
  positivePrompt: string;
  negativePrompt: string;
  imageUrls: string[];
}): Promise<{
  url: string;
  contentType: string;
}> {
  const enrichedPrompt = appendPixarStyleAnchor(args.positivePrompt);
  const promptWithNegatives = args.negativePrompt
    ? `${enrichedPrompt}. Avoid: ${args.negativePrompt}.`
    : enrichedPrompt;

  const loraUrl = process.env.PIXAR_STYLE_LORA_URL;
  // Phase 1 iteration 2 (2026-05-06): bumped scale 0.85 → 0.95 after first run
  // produced one outlier image that looked photographic rather than Pixar-styled.
  // Root cause was Bible's styleBible.negativeStyle ("NOT 3D-rendered") fighting
  // the LoRA — once that's countered by anti-watercolor negatives in the prompt
  // (see appendPixarStyleAnchor), higher LoRA scale is safe and gives stronger
  // style adherence.
  const loras = loraUrl ? [{ path: loraUrl, scale: 0.95 }] : undefined;

  // The fal.ai SDK's `FluxKontextMultiInput` type doesn't include `loras` yet
  // even though the runtime accepts it (Task 0 verified empirically on
  // 2026-05-05 — see src/scripts/verify-fal-kontext-lora.ts). Build the input
  // object with the SDK's expected fields, then attach `loras` via
  // `Object.assign` so TS doesn't see it in the literal-typed object. DO NOT
  // use `as any`.
  const baseInput = {
    prompt: promptWithNegatives,
    image_urls: args.imageUrls,
    aspect_ratio: "3:4" as const,
    output_format: "png" as const,
    num_images: 1,
  };
  const input = loras
    ? Object.assign({}, baseInput, { loras })
    : baseInput;

  const result = await fal.subscribe(FLUX_KONTEXT_MULTI, {
    input,
    logs: false,
  });

  const image = (result as {
    data?: { images?: Array<{ url?: string; content_type?: string }> };
  }).data?.images?.[0];
  if (!image?.url) {
    throw new Error(
      `Flux Kontext returned no image. Response: ${JSON.stringify(result.data ?? null).slice(0, 500)}`,
    );
  }
  return {
    url: image.url,
    contentType: image.content_type ?? "image/png",
  };
}

export async function generateCoverIllustration(
  input: CoverInput,
): Promise<IllustrationResult> {
  ensureFalConfigured();
  const startedAt = Date.now();
  const provider = input.provider ?? "nano-banana";
  const photoUrls = input.customerPhotoUrls ?? [];

  let imageMeta: { url: string; contentType: string };
  let modelId: string;

  if (provider === "flux-kontext-pixar") {
    if (photoUrls.length === 0) {
      throw new Error(
        "flux-kontext-pixar provider requires at least 1 customer photo for cover.",
      );
    }
    imageMeta = await callFluxKontextPixar({
      positivePrompt: input.positivePrompt,
      negativePrompt: input.negativePrompt,
      imageUrls: photoUrls,
    });
    modelId = "flux-kontext-pixar";
  } else {
    // Existing Nano Banana path — unchanged behavior.
    // Nano Banana doesn't accept a separate negative_prompt — fold it into the
    // positive prompt as natural-language constraints. Gemini's instruction-
    // following is strong enough to honor "avoid X" phrasing.
    const promptWithNegatives = input.negativePrompt
      ? `${input.positivePrompt}. Avoid: ${input.negativePrompt}.`
      : input.positivePrompt;

    // If customer photos provided, use the edit endpoint with ALL photos
    // (multi-angle gives Gemini richer 3D face understanding for stronger
    // identity preservation). Otherwise fall back to text-to-image.
    let result;
    if (photoUrls.length > 0) {
      result = await fal.subscribe(NANO_BANANA_2_EDIT, {
        input: {
          prompt: promptWithNegatives,
          image_urls: photoUrls,
          aspect_ratio: "3:4",
          output_format: "png",
          num_images: 1,
        },
        logs: false,
      });
    } else {
      result = await fal.subscribe(NANO_BANANA_2, {
        input: {
          prompt: promptWithNegatives,
          aspect_ratio: "3:4",
          output_format: "png",
          num_images: 1,
        },
        logs: false,
      });
    }

    const image = (result as {
      data?: { images?: Array<{ url?: string; content_type?: string }> };
    }).data?.images?.[0];
    if (!image?.url) {
      throw new Error(
        `Nano Banana returned no image for cover. Response: ${JSON.stringify(result.data ?? null).slice(0, 500)}`,
      );
    }
    imageMeta = { url: image.url, contentType: image.content_type ?? "image/png" };
    modelId = photoUrls.length > 0 ? "nano-banana-2-edit" : "nano-banana-2";
  }

  const buffer = await downloadAsBuffer(imageMeta.url);
  const uploaded = await uploadImage(
    buffer,
    input.orderId,
    "illustration_cover",
    imageMeta.contentType,
  );

  return {
    url: uploaded.url,
    contentType: uploaded.contentType,
    fileSize: uploaded.fileSize,
    modelId,
    durationMs: Date.now() - startedAt,
  };
}

async function downloadAsBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to download generated image: ${res.status}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

// === Body-page generation ===
//
// Routes per page based on whether the customer uploaded a photo:
//   - WITH photo: fal-ai/flux-pulid endpoint, photo as reference_image_url
//                 → injects actual face geometry into the illustration
//   - WITHOUT photo: fal-ai/flux-pro/v1.1/redux, cover as image_url
//                 → image-to-image conditioning carries character/style continuity
//
// PuLID + Redux both accept native negative_prompt (unlike Flux 1.1 Pro).

export interface BodyInput {
  orderId: string;
  pageNumber: number;
  positivePrompt: string;
  negativePrompt: string;
  coverImageUrl: string;
  /** 1-3 customer photos. Multi-angle uploads improve identity preservation. */
  customerPhotoUrls: string[];
  /** Provider selector — default 'nano-banana'. 'flux-kontext-pixar' uses Flux Kontext Multi + Pixar style LoRA. */
  provider?: IllustrationProvider;
}

export async function generateBodyIllustration(
  input: BodyInput,
): Promise<IllustrationResult> {
  ensureFalConfigured();
  const startedAt = Date.now();
  const provider = input.provider ?? "nano-banana";

  // Reference images: prefer customer photos; fall back to cover for nano-banana.
  // For flux-kontext-pixar, multi-photo identity reference is essential — REQUIRE photos.
  let imageUrls: string[];
  if (provider === "flux-kontext-pixar") {
    if (input.customerPhotoUrls.length === 0) {
      throw new Error(
        "flux-kontext-pixar provider requires at least 1 customer photo for body pages.",
      );
    }
    imageUrls = input.customerPhotoUrls;
  } else {
    // Phase H iteration 8 (2026-05-05): multi-photo support. Pass ALL customer
    // photos (typically 1-3 from wizard's photo-upload, different angles) as
    // references — Gemini's multimodal vision builds richer 3D face geometry
    // from multiple angles than from one. When no photos, fall back to cover
    // (so character at least matches; better than no reference).
    imageUrls =
      input.customerPhotoUrls.length > 0
        ? input.customerPhotoUrls
        : [input.coverImageUrl];
  }

  let imageMeta: { url: string; contentType: string };
  let modelId: string;

  if (provider === "flux-kontext-pixar") {
    imageMeta = await callFluxKontextPixar({
      positivePrompt: input.positivePrompt,
      negativePrompt: input.negativePrompt,
      imageUrls,
    });
    modelId = "flux-kontext-pixar";
  } else {
    const promptWithNegatives = input.negativePrompt
      ? `${input.positivePrompt}. Avoid: ${input.negativePrompt}.`
      : input.positivePrompt;
    const result = await fal.subscribe(NANO_BANANA_2_EDIT, {
      input: {
        prompt: promptWithNegatives,
        image_urls: imageUrls,
        aspect_ratio: "3:4",
        output_format: "png",
        num_images: 1,
      },
      logs: false,
    });
    const image = (result as {
      data?: { images?: Array<{ url?: string; content_type?: string }> };
    }).data?.images?.[0];
    if (!image?.url) {
      throw new Error(
        `Nano Banana returned no image for page ${input.pageNumber}. Response: ${JSON.stringify(result.data ?? null).slice(0, 500)}`,
      );
    }
    imageMeta = { url: image.url, contentType: image.content_type ?? "image/png" };
    modelId = "nano-banana-2-edit";
  }

  const buffer = await downloadAsBuffer(imageMeta.url);
  const uploaded = await uploadImage(
    buffer,
    input.orderId,
    `illustration_page_${input.pageNumber}`,
    imageMeta.contentType,
  );

  return {
    url: uploaded.url,
    contentType: uploaded.contentType,
    fileSize: uploaded.fileSize,
    modelId,
    durationMs: Date.now() - startedAt,
  };
}

// === Batch orchestrator ===
//
// Cover first (its URL is the reference for all body pages without photos).
// Then body pages run in parallel with bounded concurrency. Concurrency 5 is
// permissive within Fal.ai's typical rate limits; if 429s appear in prod,
// reduce in ai_settings.

const ILLUSTRATION_CONCURRENCY = 5;

export interface BatchInput {
  orderId: string;
  cover: { positivePrompt: string; negativePrompt: string };
  pages: Array<{
    pageNumber: number;
    positivePrompt: string;
    negativePrompt: string;
  }>;
  customerPhotoUrls: string[];
  /** Provider for both cover + body pages. Defaults to 'nano-banana'. */
  provider?: IllustrationProvider;
}

export interface BatchResult {
  cover: IllustrationResult;
  pages: Array<IllustrationResult & { pageNumber: number }>;
  totalDurationMs: number;
}

export async function generateAllIllustrations(
  input: BatchInput,
): Promise<BatchResult> {
  const startedAt = Date.now();
  const cover = await generateCoverIllustration({
    orderId: input.orderId,
    positivePrompt: input.cover.positivePrompt,
    negativePrompt: input.cover.negativePrompt,
    customerPhotoUrls: input.customerPhotoUrls,
    provider: input.provider,
  });

  const pages = await runWithConcurrency(input.pages, ILLUSTRATION_CONCURRENCY, async (page) => {
    const result = await generateBodyIllustration({
      orderId: input.orderId,
      pageNumber: page.pageNumber,
      positivePrompt: page.positivePrompt,
      negativePrompt: page.negativePrompt,
      coverImageUrl: cover.url,
      customerPhotoUrls: input.customerPhotoUrls,
      provider: input.provider,
    });
    return { ...result, pageNumber: page.pageNumber };
  });

  return {
    cover,
    pages,
    totalDurationMs: Date.now() - startedAt,
  };
}

async function runWithConcurrency<T, U>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<U>,
): Promise<U[]> {
  const results: U[] = new Array(items.length);
  let cursor = 0;
  async function worker(): Promise<void> {
    while (true) {
      const i = cursor++;
      const item = items[i];
      if (item === undefined || i >= items.length) return;
      results[i] = await fn(item);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );
  return results;
}
