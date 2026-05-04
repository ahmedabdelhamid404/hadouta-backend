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

// Pivot to Nano Banana (Gemini 2.5 Flash Image) per Phase H iteration 3 (2026-05-05):
// 3 iterations of Flux+PuLID tuning showed PuLID's portrait-only ceiling can't
// render character-in-scene illustrations. Nano Banana renders rich Egyptian
// scenes well (Sprint 2 confirmed) and Pro-Edit accepts multiple reference
// images for character continuity.
//
// Architecture:
//   Cover       → fal-ai/nano-banana-pro/edit, image_urls = [photoUrl]
//                 Or non-edit if no photo. Photo provides identity.
//   Body pages  → fal-ai/nano-banana-pro/edit, image_urls = [coverUrl, photoUrl?]
//                 Cover provides character/style/scene continuity. Photo (if any)
//                 reinforces face identity. Gemini's multimodal vision merges both.
const NANO_BANANA_PRO_EDIT = "fal-ai/nano-banana-pro/edit";
const NANO_BANANA_PRO = "fal-ai/nano-banana-pro";
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
  /** Optional — when set, used as reference image so cover reflects the actual child. */
  customerPhotoUrl?: string | null;
}

export interface IllustrationResult {
  url: string;
  contentType: string;
  fileSize: number;
  modelId: string;
  durationMs: number;
}

export async function generateCoverIllustration(
  input: CoverInput,
): Promise<IllustrationResult> {
  ensureFalConfigured();
  const startedAt = Date.now();

  // Nano Banana doesn't accept a separate negative_prompt — fold it into the
  // positive prompt as natural-language constraints. Gemini's instruction-
  // following is strong enough to honor "avoid X" phrasing.
  const promptWithNegatives = input.negativePrompt
    ? `${input.positivePrompt}. Avoid: ${input.negativePrompt}.`
    : input.positivePrompt;

  // If a customer photo was provided, use the edit endpoint with the photo
  // as reference (preserves identity). Otherwise text-to-image.
  let result;
  if (input.customerPhotoUrl) {
    result = await fal.subscribe(NANO_BANANA_PRO_EDIT, {
      input: {
        prompt: promptWithNegatives,
        image_urls: [input.customerPhotoUrl],
        aspect_ratio: "3:4",
        output_format: "png",
        num_images: 1,
      },
      logs: false,
    });
  } else {
    result = await fal.subscribe(NANO_BANANA_PRO, {
      input: {
        prompt: promptWithNegatives,
        aspect_ratio: "3:4",
        output_format: "png",
        num_images: 1,
      },
      logs: false,
    });
  }

  const durationMs = Date.now() - startedAt;
  const image = (result as { data?: { images?: Array<{ url?: string; content_type?: string }> } })
    .data?.images?.[0];
  if (!image?.url) {
    throw new Error(
      `Nano Banana returned no image for cover. Response: ${JSON.stringify(result.data ?? null).slice(0, 500)}`,
    );
  }

  const buffer = await downloadAsBuffer(image.url);
  const uploaded = await uploadImage(
    buffer,
    input.orderId,
    "illustration_cover",
    image.content_type ?? "image/png",
  );

  return {
    url: uploaded.url,
    contentType: uploaded.contentType,
    fileSize: uploaded.fileSize,
    modelId: input.customerPhotoUrl ? "nano-banana-pro-edit" : "nano-banana-pro",
    durationMs,
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
  customerPhotoUrl: string | null;
}

export async function generateBodyIllustration(
  input: BodyInput,
): Promise<IllustrationResult> {
  ensureFalConfigured();
  const startedAt = Date.now();

  // Phase H iteration 4 (2026-05-05): passing [coverUrl, photoUrl] caused Nano
  // Banana to anchor on the cover image and produce near-duplicates across
  // pages. Fix: prefer ONLY the photo as reference when available — child
  // identity preserved, scene varies freely per prompt. When no photo, fall
  // back to cover (so character at least matches; better than no reference).
  const imageUrls: string[] = input.customerPhotoUrl
    ? [input.customerPhotoUrl]
    : [input.coverImageUrl];

  const promptWithNegatives = input.negativePrompt
    ? `${input.positivePrompt}. Avoid: ${input.negativePrompt}.`
    : input.positivePrompt;

  const result = await fal.subscribe(NANO_BANANA_PRO_EDIT, {
    input: {
      prompt: promptWithNegatives,
      image_urls: imageUrls,
      aspect_ratio: "3:4",
      output_format: "png",
      num_images: 1,
    },
    logs: false,
  });

  const durationMs = Date.now() - startedAt;
  const image = (result as { data?: { images?: Array<{ url?: string; content_type?: string }> } })
    .data?.images?.[0];
  if (!image?.url) {
    throw new Error(
      `Nano Banana returned no image for page ${input.pageNumber}. Response: ${JSON.stringify(result.data ?? null).slice(0, 500)}`,
    );
  }

  const buffer = await downloadAsBuffer(image.url);
  const uploaded = await uploadImage(
    buffer,
    input.orderId,
    `illustration_page_${input.pageNumber}`,
    image.content_type ?? "image/png",
  );

  return {
    url: uploaded.url,
    contentType: uploaded.contentType,
    fileSize: uploaded.fileSize,
    modelId: "nano-banana-pro-edit",
    durationMs,
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
  customerPhotoUrl: string | null;
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
    customerPhotoUrl: input.customerPhotoUrl,
  });

  const pages = await runWithConcurrency(input.pages, ILLUSTRATION_CONCURRENCY, async (page) => {
    const result = await generateBodyIllustration({
      orderId: input.orderId,
      pageNumber: page.pageNumber,
      positivePrompt: page.positivePrompt,
      negativePrompt: page.negativePrompt,
      coverImageUrl: cover.url,
      customerPhotoUrl: input.customerPhotoUrl,
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
