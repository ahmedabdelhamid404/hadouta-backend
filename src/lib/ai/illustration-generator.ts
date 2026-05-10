// Illustration generator — Google AI Studio direct API (NOT fal.ai).
//
// 2026-05-10 architectural lock-in (per ADR-029 + founder directive):
//   - Direct Google API (gemini-3.1-flash-image-preview) — only API that
//     supports multi-turn refinement (turn 1 + turn 2 self-critique with
//     thought_signature pass-through). This is the killer feature that
//     justified migrating off fal.ai.
//   - Multi-turn refinement: turn 1 generates, turn 2 self-critiques on
//     5 axes (face, wardrobe, scale, full-body, expression) — ports the
//     iter 7/8 architecture proven on Hena's order.
//   - Comprehensive error taxonomy with per-category retry policy:
//     forever-1min on 503 capacity, honor-retryDelay on 429-throttle,
//     no-retry on 429-billing-depleted / auth / content-blocks, 3x-backoff
//     on 500/network, 1x-then-alert on STOP-no-image. Distinguishes the
//     three sub-types of 429 (throttle vs daily-quota vs billing-depleted)
//     by message body to avoid the silent-retry-forever billing trap.
//   - Customer photos (mandatory, 1-3) as Images 1..N (identity); static
//     watercolor anchor (Beatrix Potter PD plate) as the FINAL image (style).
//     2026-05-10: order matches iter 8's empirically-proven pattern.
//
// All uploads to Cloudinary as before (preserve admin UI compatibility).

import * as https from "node:https";
import { uploadImage } from "../cloudinary.js";

// Provider type kept for telemetry — the only valid value is "nano-banana"
// (the underlying model is gemini-3.1-flash-image-preview, branded by Google
// as "Nano Banana 2"). Other providers removed per ADR-028 watercolor revert.
export type IllustrationProvider = "nano-banana";

const PRIMARY_MODEL = "gemini-3.1-flash-image-preview";
const ASPECT_RATIO = "3:4" as const;

/** Maximum customer photos passed as Image 2..N+1 references. Wizard enforces
 *  1-3 at upload; this is a defensive clamp in case the data layer ever yields
 *  more (e.g. legacy seed data, admin manual override). Past 3 photos the
 *  multi-image conditioning gains plateau and per-call payload bloats Tier-1
 *  throttling. V12 fix (2026-05-10). */
const MAX_CUSTOMER_PHOTOS = 3;

// =============================================================================
// Types
// =============================================================================

interface InlineImage {
  /** base64-encoded image data (no data: prefix). */
  data: string;
  mimeType: string;
}

interface ContentPart {
  text?: string;
  inlineData?: InlineImage;
  /** Raw response part captured from a prior turn — replayed verbatim in
   *  multi-turn so Google's thought_signature is preserved. */
  rawModelPart?: Record<string, unknown>;
}

interface ContentTurn {
  role: "user" | "model";
  parts: ContentPart[];
}

interface ApiResult {
  image: InlineImage;
  /** All response parts including reasoning; needed to replay thought_signature
   *  in subsequent multi-turn calls. */
  rawParts: Array<Record<string, unknown>>;
}

type RetryPolicy =
  | "forever-1min"
  | "honor-retryDelay"
  | "3x-backoff"
  | "1x-then-alert"
  | "retry-after-midnight-PT"
  | "no-retry";

interface ErrorCategory {
  label: string;
  retry: RetryPolicy;
  severity: "warn" | "error" | "critical";
  action: string;
}

// =============================================================================
// Static watercolor anchor (Image 1 in every prompt's image_urls).
// 2026-05-10 architectural fix: replaced recursive AI baseline with a static
// public-domain watercolor (Beatrix Potter, 1902, PD since 2014). URL pinned
// in env var to avoid runtime file-read (Railway compat) and cold-start cost.
// =============================================================================

function getStaticWatercolorUrl(): string {
  const url = process.env.STATIC_WATERCOLOR_ANCHOR_URL;
  if (!url) {
    throw new Error(
      "STATIC_WATERCOLOR_ANCHOR_URL env var not set. " +
        "Run `pnpm tsx src/scripts/_upload_static_watercolor.ts` once " +
        "and set the resulting URL in the env (locally + on Railway).",
    );
  }
  return url;
}

// =============================================================================
// Helpers — fetch URL → base64 with retry, Cloudinary URL shrinking
// =============================================================================

function shrinkCloudinaryUrl(url: string): string {
  if (!url.includes("res.cloudinary.com") || !url.includes("/upload/")) return url;
  if (url.includes("/upload/c_") || url.includes("/upload/w_")) return url;
  return url.replace("/upload/", "/upload/c_limit,w_768,f_jpg,q_70/");
}

async function fetchAsBase64(url: string): Promise<InlineImage> {
  // 3-attempt retry with backoff — Node fetch + Cloudinary occasionally
  // ETIMEDOUTs on flaky networks. Without this, the image-prefetch step
  // crashes the whole generation.
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(shrinkCloudinaryUrl(url));
      if (!res.ok) throw new Error(`fetch ${res.status}`);
      const ct = res.headers.get("content-type") ?? "image/jpeg";
      const buf = Buffer.from(await res.arrayBuffer());
      return { data: buf.toString("base64"), mimeType: ct };
    } catch (err) {
      lastErr = err;
      if (attempt < 3) await new Promise((r) => setTimeout(r, 5_000 * attempt));
    }
  }
  throw lastErr;
}

// =============================================================================
// Google direct API — single call with parse-time error extraction
// =============================================================================

function callGoogleApiOnce(contents: ContentTurn[]): Promise<ApiResult> {
  return new Promise((resolve, reject) => {
    const apiKey = process.env.GOOGLE_AI_API_KEY;
    if (!apiKey) {
      return reject(new Error("GOOGLE_AI_API_KEY env var not set"));
    }
    const restContents = contents.map((turn) => ({
      role: turn.role,
      parts: turn.parts.map((part) => {
        if (part.rawModelPart) return part.rawModelPart;
        if (part.inlineData) {
          return {
            inline_data: {
              mime_type: part.inlineData.mimeType,
              data: part.inlineData.data,
            },
          };
        }
        return { text: part.text };
      }),
    }));
    const body = JSON.stringify({
      contents: restContents,
      generationConfig: {
        responseModalities: ["IMAGE"],
        temperature: 0.4,
        imageConfig: { aspectRatio: ASPECT_RATIO },
      },
    });
    const url = new URL(
      `https://generativelanguage.googleapis.com/v1beta/models/${PRIMARY_MODEL}:generateContent?key=${apiKey}`,
    );
    const req = https.request(
      {
        hostname: url.hostname,
        path: url.pathname + url.search,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
        timeout: 1_200_000, // 20 min — bypasses Node's undici 5-min headers timeout
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const responseBody = Buffer.concat(chunks).toString("utf8");
          if (res.statusCode !== 200) {
            const e = new Error(
              `Google ${res.statusCode}: ${responseBody.slice(0, 500)}`,
            ) as Error & { statusCode?: number };
            e.statusCode = res.statusCode;
            return reject(e);
          }
          try {
            const json = JSON.parse(responseBody) as {
              candidates?: Array<{
                finishReason?: string;
                content?: { parts?: Array<Record<string, unknown>> };
              }>;
              promptFeedback?: { blockReason?: string };
            };

            // Input-prompt safety block (200 OK with blockReason)
            if (json.promptFeedback?.blockReason) {
              const e = new Error(
                `Gemini prompt blocked: ${json.promptFeedback.blockReason}`,
              ) as Error & { blockReason?: string };
              e.blockReason = json.promptFeedback.blockReason;
              return reject(e);
            }

            for (const cand of json.candidates ?? []) {
              // Output content block (200 OK with non-STOP finishReason)
              if (cand.finishReason && cand.finishReason !== "STOP") {
                const e = new Error(
                  `Gemini ${cand.finishReason}: no image returned`,
                ) as Error & { finishReason?: string };
                e.finishReason = cand.finishReason;
                return reject(e);
              }

              const rawParts = cand.content?.parts ?? [];
              for (const part of rawParts) {
                const camel = part.inlineData as
                  | { data?: string; mimeType?: string }
                  | undefined;
                if (camel?.data && camel?.mimeType) {
                  return resolve({
                    image: { data: camel.data, mimeType: camel.mimeType },
                    rawParts,
                  });
                }
                const snake = part.inline_data as
                  | { data?: string; mime_type?: string }
                  | undefined;
                if (snake?.data && snake?.mime_type) {
                  return resolve({
                    image: { data: snake.data, mimeType: snake.mime_type },
                    rawParts,
                  });
                }
              }

              // STOP but no inline image — model returned text instead of image
              if (cand.finishReason === "STOP") {
                const e = new Error(
                  `No image: model returned text only (finishReason STOP)`,
                ) as Error & { finishReason?: string };
                e.finishReason = "STOP";
                return reject(e);
              }
            }
            reject(new Error(`No image: ${responseBody.slice(0, 200)}`));
          } catch (e) {
            reject(e);
          }
        });
      },
    );
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Timeout 20min"));
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// =============================================================================
// Comprehensive error taxonomy — distinguishes 429-billing vs 429-throttle vs
// 429-quota by message body, content blocks (200-with-finishReason), auth
// errors, network blips, etc. Per-category retry policy keyed off label.
//
// Per AI Engineer 2026-05-10 research dispatch + ADR-029 addendum.
// =============================================================================

function extractRetryDelayMs(err: unknown): number | undefined {
  const msg = (err as Error).message ?? "";
  const match = msg.match(/"retryDelay":\s*"(\d+)s"/);
  if (match && match[1]) return parseInt(match[1], 10) * 1000;
  return undefined;
}

function categorizeError(err: unknown): ErrorCategory {
  const e = err as {
    statusCode?: number;
    http_code?: number;
    message?: string;
    finishReason?: string;
    blockReason?: string;
  };
  const status = e.statusCode;
  const msg = (e.message ?? "").toString();
  const lower = msg.toLowerCase();

  // ---- Gemini 200-with-block (must check BEFORE generic "no image") ----
  if (e.finishReason === "IMAGE_SAFETY")
    return {
      label: "Gemini Content Blocked - Output Safety",
      retry: "no-retry",
      severity: "error",
      action: "Review prompt; may need manual illustration",
    };
  if (e.finishReason === "PROHIBITED_CONTENT" || e.finishReason === "IMAGE_PROHIBITED_CONTENT")
    return {
      label: "Gemini Content Blocked - Layer 2",
      retry: "no-retry",
      severity: "error",
      action: "Layer-2 block (CSAM/copyright/celebrity) — rephrase prompt",
    };
  if (e.finishReason === "RECITATION" || e.finishReason === "IMAGE_RECITATION")
    return {
      label: "Gemini Recitation Block",
      retry: "no-retry",
      severity: "warn",
      action: "Output matched copyrighted training data — vary prompt",
    };
  if (
    e.blockReason === "SAFETY" ||
    e.blockReason === "BLOCKLIST" ||
    e.blockReason === "PROHIBITED_CONTENT"
  )
    return {
      label: "Gemini Prompt Blocked - Input",
      retry: "no-retry",
      severity: "error",
      action: "Input prompt failed safety pre-check — review wording",
    };
  if (e.finishReason === "STOP" && /^no image/i.test(msg))
    return {
      label: "Gemini No Image Generated",
      retry: "1x-then-alert",
      severity: "warn",
      action: "Model returned text only; one reroll usually fixes",
    };

  // ---- Gemini 429 — THREE-WAY DISAMBIGUATION (order matters!) ----
  if (status === 429) {
    if (/prepayment\s+credits.*deplet/i.test(msg) || /no\s+available\s+credits/i.test(msg))
      return {
        label: "Gemini Billing - Credits Depleted",
        retry: "no-retry",
        severity: "critical",
        action: "Top up Google AI prepay balance",
      };
    if (/monthly\s+spending\s+cap/i.test(msg) || /billing\s+account.*exceed/i.test(msg))
      return {
        label: "Gemini Billing - Spending Cap",
        retry: "no-retry",
        severity: "critical",
        action: "Raise spending cap or wait for next billing cycle",
      };
    if (/per\s+day|requests\s+per\s+day|RPD/i.test(msg))
      return {
        label: "Gemini Quota - Daily Exhausted",
        retry: "retry-after-midnight-PT",
        severity: "error",
        action: "Wait until 00:00 PT reset; request quota increase",
      };
    if (/free_tier/i.test(msg) && /quota.*0/i.test(msg))
      return {
        label: "Gemini Tier Misconfigured",
        retry: "no-retry",
        severity: "error",
        action: "Verify Tier 1 billing took effect; contact GCP support",
      };
    return {
      label: "Gemini Rate Limit - Throttle",
      retry: "honor-retryDelay",
      severity: "warn",
      action: "Transient throttle — backoff and retry",
    };
  }

  // ---- Gemini 4xx auth/config (permanent) ----
  if (status === 400 && /(location.*not\s+supported|billing.*not\s+enabled|FAILED_PRECONDITION)/i.test(msg))
    return {
      label: "Gemini Billing Region Block",
      retry: "no-retry",
      severity: "critical",
      action: "Enable billing on GCP project; verify region eligibility",
    };
  if (status === 400)
    return {
      label: "Gemini Bad Request",
      retry: "no-retry",
      severity: "error",
      action: "Fix request payload; check schema",
    };
  if (status === 401 || /API\s+key\s+not\s+valid|API_KEY_INVALID/i.test(msg))
    return {
      label: "Gemini Auth - Invalid Key",
      retry: "no-retry",
      severity: "critical",
      action: "Rotate GOOGLE_AI_API_KEY",
    };
  if (status === 403)
    return {
      label: "Gemini Auth - Permission Denied",
      retry: "no-retry",
      severity: "critical",
      action: "Enable Generative Language API; check key restrictions",
    };
  if (status === 404 && /(model|generateContent)/i.test(msg))
    return {
      label: "Gemini Model Deprecated",
      retry: "no-retry",
      severity: "critical",
      action: "Update model name in env; check deprecation notice",
    };

  // ---- Gemini 5xx transient ----
  if (status === 503 || /overloaded|UNAVAILABLE/i.test(msg))
    return {
      label: "Gemini Capacity (Tier 1)",
      retry: "forever-1min",
      severity: "warn",
      action: "Known Tier-1 capacity pressure; safe to wait",
    };
  if (status === 500)
    return {
      label: "Gemini Internal Error",
      retry: "3x-backoff",
      severity: "warn",
      action: "Transient Google-side; retrying",
    };
  if (status === 502)
    return {
      label: "Gemini Gateway Error",
      retry: "3x-backoff",
      severity: "warn",
      action: "Transient gateway; retrying",
    };
  if (status === 504 || status === 408 || /(deadline\s+exceeded|^timeout)/i.test(lower))
    return {
      label: "Gemini Timeout",
      retry: "3x-backoff",
      severity: "warn",
      action: "Reduce prompt size or retry",
    };

  // ---- Network / DB fallthrough ----
  if (/(ECONN|ENOTFOUND|ETIMEDOUT|socket\s+hang\s+up|fetch\s+failed)/i.test(msg))
    return {
      label: "Network Error",
      retry: "3x-backoff",
      severity: "warn",
      action: "Transient network blip",
    };

  return {
    label: "Unknown Error",
    retry: "no-retry",
    severity: "error",
    action: "Review logs; investigate",
  };
}

// =============================================================================
// Per-category retry executor for Google API calls. Replaces the simplistic
// "retry on 503/429/500" pattern with policy-aware retry — billing errors
// surface immediately; capacity errors retry forever; throttle honors Google's
// retryDelay hint; transient 5xx gets bounded 3x backoff.
// =============================================================================

async function callGoogleApi(contents: ContentTurn[]): Promise<ApiResult> {
  let attempt = 0;
  while (true) {
    attempt++;
    try {
      return await callGoogleApiOnce(contents);
    } catch (err) {
      const cat = categorizeError(err);
      console.log(`      attempt ${attempt} → [${cat.severity.toUpperCase()}] ${cat.label}`);

      switch (cat.retry) {
        case "no-retry":
        case "retry-after-midnight-PT":
          (err as Error & { category?: ErrorCategory }).category = cat;
          throw err;
        case "forever-1min":
          console.log(`      retry in 60s (Tier-1 capacity wait)...`);
          await new Promise((r) => setTimeout(r, 60_000));
          continue;
        case "honor-retryDelay": {
          const delay = extractRetryDelayMs(err) ?? Math.min(60_000, 1000 * 2 ** attempt);
          console.log(`      retry in ${(delay / 1000).toFixed(0)}s (per Google retryDelay)...`);
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        case "3x-backoff":
          if (attempt >= 3) {
            (err as Error & { category?: ErrorCategory }).category = cat;
            throw err;
          }
          await new Promise((r) => setTimeout(r, 5_000 * attempt));
          continue;
        case "1x-then-alert":
          if (attempt >= 2) {
            (err as Error & { category?: ErrorCategory }).category = cat;
            throw err;
          }
          console.log(`      reroll once (model returned text only)...`);
          await new Promise((r) => setTimeout(r, 2_000));
          continue;
      }
    }
  }
}

// =============================================================================
// Multi-turn refinement — turn 1 generates, turn 2 self-critiques on 5 axes
// (face, wardrobe, scale, full-body, expression). thought_signature is
// preserved by replaying the model's raw response parts in turn 2.
// =============================================================================

function buildTurn2Critique(args: {
  protagonistName: string;
  outfit: string;
}): string {
  return `Look at your previous output. Verify FIVE specific axes against the inputs:

AXIS 1 — FACE (compare to Images 1..N, the customer photos):
Pull ${args.protagonistName}'s eye shape, iris color, hair texture, hair styling, skin tone, jaw and chin shape closer to the customer photos' exact values. Ignore the FINAL image (Beatrix Potter watercolor reference) for face — that's a STYLE swatch only.
The customer photos (Images 1..N) apply ONLY to ${args.protagonistName}. Every other character in this frame (mothers, fathers, teachers, friends, classmates, siblings) MUST keep the face you drew in turn 1 — do NOT pull customer-photo features into them, do NOT make supporting characters look like older or different versions of ${args.protagonistName}.

AXIS 2 — WARDROBE:
${args.protagonistName} must wear EXACTLY: ${args.outfit}. Regenerate any garment, color, or accessory that differs. Do NOT introduce new accessories. Do NOT use the FINAL image (Beatrix Potter) for wardrobe inspiration — no rabbits, no blue jackets, no Edwardian English imagery.

AXIS 3 — SCALE & EYE-LINE LOCK:
Trace a horizontal line through ${args.protagonistName}'s eyes. Every other similar-aged child in the frame must have their eyes on that SAME horizontal line. Trace a second line through ${args.protagonistName}'s top-of-head — every peer's top-of-head touches that line. Trace a third through her feet — every peer's feet touch that line. ${args.protagonistName} must NOT occupy more pixel-area than any peer.

AXIS 4 — FULL BODY ANTI-CROP:
Every child in the frame must be rendered head-to-toe. Both feet and shoes of every child, including ${args.protagonistName}, must be visible and planted on the ground inside the frame, with a visible margin of ground painted below the shoes. If ${args.protagonistName}'s legs, feet, or shoes are missing, hidden by the frame edge, or merged into the ground, redraw her with full legs and shoes visible.

AXIS 5 — EXPRESSION RESTRAINT:
${args.protagonistName}'s expression intensity must match the peers' intensity in this frame — not larger, not more theatrical. If she has wide-open eyes + lifted brows + open-mouth grin all at once, soften to picture-book restraint: eye-led warmth, brows at natural rest, a small closed-mouth or barely-parted smile that matches the peers' smiles.

Re-render the same scene, same pose narrative, same composition, same watercolor style, same 3:4 aspect ratio. Refine ONLY face geometry, wardrobe, scale, framing, and expression intensity.`;
}

interface MultiTurnArgs {
  prompt: string;
  protagonistName: string;
  outfit: string;
  staticAnchor: InlineImage;
  customerPhotos: InlineImage[];
}

/** Telemetry returned alongside the refined image so the orchestrator can
 *  count turn-2 success vs fallback rate per generation. V8 fix (2026-05-10).
 *  When fallbackToTurn1 is true, turn-2's $0.04 was spent without quality gain;
 *  if this rate exceeds ~20% across a run, the multi-turn architecture is
 *  paying for nothing on a fifth of pages and admin should be alerted. */
export interface MultiTurnStats {
  /** True when turn 2 succeeded and produced the returned image. */
  turn2Succeeded: boolean;
  /** True when turn 2 threw and the returned image is turn 1's. */
  fallbackToTurn1: boolean;
  /** Category label of the turn-2 failure, when fallbackToTurn1=true. */
  turn2FailureCategory?: string;
  turn1DurationMs: number;
  turn2DurationMs: number;
}

async function multiTurnRefine(
  args: MultiTurnArgs,
): Promise<{ image: InlineImage; stats: MultiTurnStats }> {
  // Turn 1: prompt + Images 1..N (customer photos) + Image N+1 (static anchor).
  // 2026-05-10 FACE-FIDELITY FIX: customer photos LEAD the array per iter 8's
  // empirically-proven pattern. Putting the static anchor first (earlier
  // attempt) regressed face fidelity — Gemini's planner gives Image 1 ordinal
  // priority, so identity must be Image 1, style must be the LAST image.
  const turn1Parts: ContentPart[] = [];
  for (const photo of args.customerPhotos) {
    turn1Parts.push({ inlineData: photo });
  }
  turn1Parts.push({ inlineData: args.staticAnchor });
  turn1Parts.push({ text: args.prompt });

  const turn1Contents: ContentTurn[] = [{ role: "user", parts: turn1Parts }];
  console.log(`    turn 1 (${args.customerPhotos.length} photos + 1 anchor)...`);
  const t0 = Date.now();
  const turn1 = await callGoogleApi(turn1Contents);
  const turn1DurationMs = Date.now() - t0;
  console.log(`    turn 1 done in ${(turn1DurationMs / 1000).toFixed(0)}s`);

  // Turn 2: replay turn 1 contents + model's raw response parts (preserves
  // thought_signature) + 5-axis critique.
  const turn2Contents: ContentTurn[] = [
    ...turn1Contents,
    { role: "model", parts: turn1.rawParts.map((rp) => ({ rawModelPart: rp })) },
    {
      role: "user",
      parts: [
        {
          text: buildTurn2Critique({
            protagonistName: args.protagonistName,
            outfit: args.outfit,
          }),
        },
      ],
    },
  ];
  console.log(`    turn 2 (face + wardrobe + scale + framing + expression)...`);
  const t1 = Date.now();
  try {
    const turn2 = await callGoogleApi(turn2Contents);
    const turn2DurationMs = Date.now() - t1;
    console.log(`    turn 2 done in ${(turn2DurationMs / 1000).toFixed(0)}s`);
    return {
      image: turn2.image,
      stats: {
        turn2Succeeded: true,
        fallbackToTurn1: false,
        turn1DurationMs,
        turn2DurationMs,
      },
    };
  } catch (err) {
    // If turn 2 fails (e.g. content-block on the critique input), fall back
    // to turn 1's image rather than failing the whole illustration. V8 fix
    // (2026-05-10): record the fallback in stats so the orchestrator can
    // count turn-2 success rate per generation.
    const cat = (err as Error & { category?: ErrorCategory }).category;
    const turn2DurationMs = Date.now() - t1;
    const failureLabel =
      cat?.label ?? (err as Error).message?.slice(0, 80) ?? "Unknown";
    console.log(`    ⚠️  turn 2 failed: ${failureLabel} — using turn 1`);
    return {
      image: turn1.image,
      stats: {
        turn2Succeeded: false,
        fallbackToTurn1: true,
        turn2FailureCategory: failureLabel,
        turn1DurationMs,
        turn2DurationMs,
      },
    };
  }
}

// =============================================================================
// Public interfaces — same shape as before so generate-book.ts doesn't change
// =============================================================================

export interface CoverInput {
  orderId: string;
  positivePrompt: string;
  negativePrompt: string;
  /** REQUIRED — 1-3 customer-uploaded photos. Photo upload is mandatory at
   *  the wizard layer (founder lock-in 2026-05-10); the orchestrator throws
   *  early if missing. Multi-photo (different angles) gives richer 3D face
   *  geometry for stronger identity preservation. */
  customerPhotoUrls: string[];
  /** REQUIRED for multi-turn critique — protagonist's name from Bible. */
  protagonistName: string;
  /** REQUIRED for multi-turn critique — verbatim outfit string from Bible
   *  (resolved for cover via outfit.default; never a variation). */
  outfit: string;
  /** Provider selector — telemetry only; only valid value is "nano-banana". */
  provider?: IllustrationProvider;
}

export interface BodyInput {
  orderId: string;
  pageNumber: number;
  positivePrompt: string;
  negativePrompt: string;
  /** REQUIRED — 1-3 customer photos. */
  customerPhotoUrls: string[];
  /** REQUIRED — protagonist's name from Bible. */
  protagonistName: string;
  /** REQUIRED — outfit string for THIS page (default OR variation per Bible). */
  outfit: string;
  /** Provider selector — telemetry only; only valid value is "nano-banana". */
  provider?: IllustrationProvider;
}

export interface IllustrationResult {
  url: string;
  contentType: string;
  fileSize: number;
  modelId: string;
  durationMs: number;
  /** Multi-turn telemetry (V8 fix 2026-05-10). When fallbackToTurn1=true the
   *  illustration is the turn-1 output because turn-2 failed. The orchestrator
   *  aggregates this across the batch to compute a turn-2 success rate per
   *  generation. */
  multiTurnStats: MultiTurnStats;
}

// =============================================================================
// Generate cover — Google direct + multi-turn refinement
// =============================================================================

export async function generateCoverIllustration(
  input: CoverInput,
): Promise<IllustrationResult> {
  const startedAt = Date.now();
  if (input.customerPhotoUrls.length === 0) {
    throw new Error(
      "generateCoverIllustration: customer photo upload is required. " +
        "Wizard should enforce; orchestrator should validate before calling.",
    );
  }

  // V12 (2026-05-10): clamp to MAX_CUSTOMER_PHOTOS. buildIllustrationPrompt
  // returns negative=""; the Avoid-wrap below is therefore inert in production
  // but kept for forward-compat if the prompt builder ever switches modes.
  const clampedPhotoUrls = input.customerPhotoUrls.slice(0, MAX_CUSTOMER_PHOTOS);
  if (input.customerPhotoUrls.length > MAX_CUSTOMER_PHOTOS) {
    console.warn(
      `  [cover] clamped ${input.customerPhotoUrls.length} photos to ${MAX_CUSTOMER_PHOTOS} (wizard upper bound).`,
    );
  }

  // Compose the user prompt — fold negativePrompt into positive for Gemini
  // (Gemini's instruction-following honors "Avoid: X" phrasing inline).
  const promptText = input.negativePrompt
    ? `${input.positivePrompt}. Avoid: ${input.negativePrompt}.`
    : input.positivePrompt;

  // Pre-fetch all reference images as base64. Customer photos LEAD (Image 1..N
  // = identity); static anchor is LAST (Image N+1 = style). Per iter 8 pattern.
  console.log(`  [cover] pre-fetching ${clampedPhotoUrls.length + 1} ref images...`);
  const customerPhotos = await Promise.all(
    clampedPhotoUrls.map((url) => fetchAsBase64(url)),
  );
  const staticAnchor = await fetchAsBase64(getStaticWatercolorUrl());

  // Multi-turn refine.
  const { image: refined, stats } = await multiTurnRefine({
    prompt: promptText,
    protagonistName: input.protagonistName,
    outfit: input.outfit,
    staticAnchor,
    customerPhotos,
  });

  // Upload result to Cloudinary.
  const buffer = Buffer.from(refined.data, "base64");
  const uploaded = await uploadImage(
    buffer,
    input.orderId,
    "illustration_cover",
    refined.mimeType,
  );

  return {
    url: uploaded.url,
    contentType: uploaded.contentType,
    fileSize: uploaded.fileSize,
    modelId: PRIMARY_MODEL,
    durationMs: Date.now() - startedAt,
    multiTurnStats: stats,
  };
}

// =============================================================================
// Generate body page — same multi-turn pattern as cover
// =============================================================================

export async function generateBodyIllustration(
  input: BodyInput,
): Promise<IllustrationResult> {
  const startedAt = Date.now();
  if (input.customerPhotoUrls.length === 0) {
    throw new Error(
      `generateBodyIllustration page=${input.pageNumber}: customer photo upload is required. ` +
        "Wizard should enforce; orchestrator should validate before calling.",
    );
  }

  // V12 (2026-05-10): clamp to MAX_CUSTOMER_PHOTOS — see generateCoverIllustration.
  const clampedPhotoUrls = input.customerPhotoUrls.slice(0, MAX_CUSTOMER_PHOTOS);
  if (input.customerPhotoUrls.length > MAX_CUSTOMER_PHOTOS) {
    console.warn(
      `  [page${input.pageNumber}] clamped ${input.customerPhotoUrls.length} photos to ${MAX_CUSTOMER_PHOTOS}.`,
    );
  }

  const promptText = input.negativePrompt
    ? `${input.positivePrompt}. Avoid: ${input.negativePrompt}.`
    : input.positivePrompt;

  // Customer photos LEAD (Image 1..N = identity); static anchor LAST (style).
  console.log(
    `  [page${input.pageNumber}] pre-fetching ${clampedPhotoUrls.length + 1} ref images...`,
  );
  const customerPhotos = await Promise.all(
    clampedPhotoUrls.map((url) => fetchAsBase64(url)),
  );
  const staticAnchor = await fetchAsBase64(getStaticWatercolorUrl());

  const { image: refined, stats } = await multiTurnRefine({
    prompt: promptText,
    protagonistName: input.protagonistName,
    outfit: input.outfit,
    staticAnchor,
    customerPhotos,
  });

  const buffer = Buffer.from(refined.data, "base64");
  const uploaded = await uploadImage(
    buffer,
    input.orderId,
    `illustration_page_${input.pageNumber}`,
    refined.mimeType,
  );

  return {
    url: uploaded.url,
    contentType: uploaded.contentType,
    fileSize: uploaded.fileSize,
    modelId: PRIMARY_MODEL,
    durationMs: Date.now() - startedAt,
    multiTurnStats: stats,
  };
}

// =============================================================================
// Batch orchestrator — cover first, then body pages with bounded concurrency.
// Per ADR-029, multi-turn refinement on Google direct doesn't tolerate high
// concurrency well (Tier-1 throttling intensifies). Reduced to 3 from 5 to
// stay below capacity-pressure thresholds.
// =============================================================================

const ILLUSTRATION_CONCURRENCY = 3;

export interface BatchInput {
  orderId: string;
  protagonistName: string;
  cover: { positivePrompt: string; negativePrompt: string; outfit: string };
  pages: Array<{
    pageNumber: number;
    positivePrompt: string;
    negativePrompt: string;
    outfit: string;
  }>;
  customerPhotoUrls: string[];
  provider?: IllustrationProvider;
}

export interface PageFailure {
  /** 0 = cover, 1..N = body page. */
  pageNumber: number;
  /** Human-readable category from categorizeError, e.g.
   *  "Gemini Content Blocked - Output Safety". */
  categoryLabel: string;
  /** Original error message, truncated to 500 chars. */
  message: string;
  /** Admin-UI severity. */
  severity: "warn" | "error" | "critical";
  /** Suggested admin action. */
  action: string;
  /** True for transient errors that exhausted their retry budget (e.g. 3x-backoff
   *  failed all 3 times). False for permanent errors (safety, billing, auth) that
   *  can never be retried as-is. Drives retry-queue eligibility (V7). */
  retryable: boolean;
}

export interface BatchResult {
  /** Cover illustration. Null iff cover failed permanently — see coverFailure. */
  cover: IllustrationResult | null;
  /** Successfully-rendered body pages, sorted by pageNumber. */
  pages: Array<IllustrationResult & { pageNumber: number }>;
  /** Cover failure — present iff cover threw (permanent OR exhausted-transient). */
  coverFailure: PageFailure | null;
  /** Per-page failures. Orchestrator decides terminal generation status:
   *  any failures → failed_human_review (or failed_retry_pending if retryable);
   *  no failures → awaiting_review. */
  pageFailures: PageFailure[];
  totalDurationMs: number;
}

/**
 * Skip-and-continue orchestrator. V6 fix (2026-05-10):
 *   - If cover fails, body pages still render.
 *   - If a body page fails, the other body pages still render.
 *   - All failures are collected and returned alongside successes — generate-book.ts
 *     decides terminal generation status based on failure mix.
 *   - Transient errors are retried inside callGoogleApi (ADR-029 Layer 1);
 *     anything that escapes to this layer is either permanent or out-of-budget.
 */
export async function generateAllIllustrations(
  input: BatchInput,
): Promise<BatchResult> {
  const startedAt = Date.now();

  // --- Cover (single attempt; transient retry inside generator) ---
  let cover: IllustrationResult | null = null;
  let coverFailure: PageFailure | null = null;
  try {
    cover = await generateCoverIllustration({
      orderId: input.orderId,
      positivePrompt: input.cover.positivePrompt,
      negativePrompt: input.cover.negativePrompt,
      customerPhotoUrls: input.customerPhotoUrls,
      protagonistName: input.protagonistName,
      outfit: input.cover.outfit,
      provider: input.provider,
    });
  } catch (err) {
    coverFailure = errorToPageFailure(err, 0);
    console.error(
      `  [cover] permanent failure: [${coverFailure.severity.toUpperCase()}] ` +
        `${coverFailure.categoryLabel} — ${coverFailure.message.slice(0, 120)}`,
    );
  }

  // --- Body pages (concurrent; per-page failure capture) ---
  const { successes, failures } = await runWithConcurrencyCollecting(
    input.pages,
    ILLUSTRATION_CONCURRENCY,
    async (page) => {
      const result = await generateBodyIllustration({
        orderId: input.orderId,
        pageNumber: page.pageNumber,
        positivePrompt: page.positivePrompt,
        negativePrompt: page.negativePrompt,
        customerPhotoUrls: input.customerPhotoUrls,
        protagonistName: input.protagonistName,
        outfit: page.outfit,
        provider: input.provider,
      });
      return { ...result, pageNumber: page.pageNumber };
    },
    (page) => page.pageNumber,
  );

  return {
    cover,
    pages: successes,
    coverFailure,
    pageFailures: failures,
    totalDurationMs: Date.now() - startedAt,
  };
}

/**
 * Translates a thrown error (with optional `category` attached by callGoogleApi)
 * into the PageFailure shape consumed by the orchestrator + admin UI.
 * Errors thrown OUTSIDE the Gemini call (Cloudinary upload, photo prefetch)
 * are re-categorized from the raw error here.
 */
function errorToPageFailure(err: unknown, pageNumber: number): PageFailure {
  const e = err as Error & { category?: ErrorCategory };
  const cat = e.category ?? categorizeError(err);
  // "Retryable" maps the categorical retry policy to a single boolean for the
  // retry queue. forever-1min / honor-retryDelay / 3x-backoff / 1x-then-alert
  // / retry-after-midnight-PT — all retryable from the queue's perspective.
  // Only "no-retry" is permanent.
  const retryable = cat.retry !== "no-retry";
  return {
    pageNumber,
    categoryLabel: cat.label,
    message: (e.message ?? String(err)).slice(0, 500),
    severity: cat.severity,
    action: cat.action,
    retryable,
  };
}

/**
 * Concurrency-bounded executor that collects per-item failures rather than
 * short-circuiting the whole batch on the first throw. Returns successes +
 * failures; never throws. Successes + failures are returned sorted by
 * pageNumber for deterministic downstream persistence.
 */
async function runWithConcurrencyCollecting<T, U extends { pageNumber: number }>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<U>,
  pageNumberOf: (item: T) => number,
): Promise<{ successes: U[]; failures: PageFailure[] }> {
  const successes: U[] = [];
  const failures: PageFailure[] = [];
  let cursor = 0;
  async function worker(): Promise<void> {
    while (true) {
      const i = cursor++;
      const item = items[i];
      if (item === undefined || i >= items.length) return;
      try {
        const result = await fn(item);
        successes.push(result);
      } catch (err) {
        const failure = errorToPageFailure(err, pageNumberOf(item));
        failures.push(failure);
        console.error(
          `  [page${failure.pageNumber}] permanent failure: ` +
            `[${failure.severity.toUpperCase()}] ${failure.categoryLabel} — ` +
            `${failure.message.slice(0, 120)}`,
        );
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );
  successes.sort((a, b) => a.pageNumber - b.pageNumber);
  failures.sort((a, b) => a.pageNumber - b.pageNumber);
  return { successes, failures };
}
