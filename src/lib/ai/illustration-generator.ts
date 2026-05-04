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

// === Legacy batch shape — kept temporarily so the orchestrator keeps
// compiling between Tasks 9–10. Task 11 rewrites the orchestrator to use
// the new Bible-driven shape and removes this shim. ===

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

  // Body pages — stub returning cover for every page until Task 10 implements
  // generateBodyIllustration with PuLID/reference handling. Lets typecheck +
  // existing flows compile. The stub is exercised end-to-end only after Task 10.
  const pages: Array<IllustrationResult & { pageNumber: number }> = input.pages.map(
    (p) => ({ ...cover, pageNumber: p.pageNumber }),
  );

  return {
    cover,
    pages,
    totalDurationMs: Date.now() - startedAt,
  };
}
