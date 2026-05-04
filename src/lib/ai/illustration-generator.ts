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

const FLUX_PRO_ENDPOINT = "fal-ai/flux-pro/v1.1";
const FLUX_REDUX_ENDPOINT = "fal-ai/flux-pro/v1.1/redux";
const FLUX_PULID_ENDPOINT = "fal-ai/flux-pulid";

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

  // Flux 1.1 Pro (cover endpoint) is text-only — no native negative_prompt
  // field. Embed negatives into the positive prompt as natural-language
  // constraints, which Flux models honor reasonably well. (Body pages use
  // Redux / PuLID endpoints that DO accept native negative_prompt.)
  const promptWithNegatives = input.negativePrompt
    ? `${input.positivePrompt}. Avoid: ${input.negativePrompt}.`
    : input.positivePrompt;

  const result = await fal.subscribe(FLUX_PRO_ENDPOINT, {
    input: {
      prompt: promptWithNegatives,
      image_size: "portrait_4_3",
      output_format: "png",
      safety_tolerance: "2",
    },
    logs: false,
  });

  const durationMs = Date.now() - startedAt;
  const image = (result as { data?: { images?: Array<{ url?: string; content_type?: string }> } })
    .data?.images?.[0];
  if (!image?.url) {
    throw new Error(
      `Flux returned no image for cover. Response: ${JSON.stringify(result.data ?? null).slice(0, 500)}`,
    );
  }

  // Download Fal.ai's CDN URL and re-upload to Cloudinary so we own the
  // hosting (and so admin UI image lookups continue to work via the existing
  // hadouta/orders/<orderId>/illustration_<owner> folder convention).
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
    modelId: "flux-pro-1.1",
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

  const usePuLID = !!input.customerPhotoUrl;

  let result;
  if (usePuLID) {
    result = await fal.subscribe(FLUX_PULID_ENDPOINT, {
      input: {
        prompt: input.positivePrompt,
        negative_prompt: input.negativePrompt,
        reference_image_url: input.customerPhotoUrl!,
        image_size: "portrait_4_3",
        num_inference_steps: 28,
        guidance_scale: 4,
        // Per research: 0.7-0.8 is the identity-strength sweet spot.
        // Default is 1.0 — too strong, faces dominate scene composition.
        id_weight: 0.75,
        // Mid-window injection: let Flux build composition first (steps 0–start),
        // then inject identity, then polish style (steps end–total).
        start_step: 0,
        enable_safety_checker: true,
      },
      logs: false,
    });
  } else {
    result = await fal.subscribe(FLUX_REDUX_ENDPOINT, {
      input: {
        // Note: Redux endpoint uses prompt + image_url for image-to-image
        // conditioning. The cover-derived character + style transfers via
        // image_url; the per-page scene comes via prompt.
        prompt: `${input.positivePrompt}. Avoid: ${input.negativePrompt}.`,
        image_url: input.coverImageUrl,
        image_size: "portrait_4_3",
        num_inference_steps: 28,
        guidance_scale: 3.5,
        output_format: "png",
      },
      logs: false,
    });
  }

  const durationMs = Date.now() - startedAt;
  const image = (result as { data?: { images?: Array<{ url?: string; content_type?: string }> } })
    .data?.images?.[0];
  if (!image?.url) {
    throw new Error(
      `Flux returned no image for page ${input.pageNumber}. Response: ${JSON.stringify(result.data ?? null).slice(0, 500)}`,
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
    modelId: usePuLID ? "flux-pulid" : "flux-pro-1.1",
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
