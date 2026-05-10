// ITER 8 — FULL BOOK with ANCHOR IMAGE PATTERN + comprehensive error taxonomy.
//
// vs iter 7:
//   ✓ Image 3 = WARDROBE ANCHOR (iter 8 cover passed as 3rd ref to body pages)
//   ✓ Verbatim outfit string injected 3× per prompt (SUBJECT, IDENTITY, LOCK)
//   ✓ [WARDROBE LOCK] as FINAL prompt block (Gemini 3 planner prioritizes last)
//   ✓ Turn-2 critique = FACE + WARDROBE + SCALE axis (was face-only)
//   ✓ Supporting-character age/appearance anchors injected from Bible
//   ✓ Strict [SCALE] rules — no oversized protagonist unless story dictates
//   ✓ Creative, lively COVER prose (movement, real smile, atmosphere)
//
// Error handling (per AI Engineer research dispatch 2026-05-10 + ADR-029):
//   ✓ Parse-time extraction of finishReason + promptFeedback.blockReason
//      (content blocks return HTTP 200 — without this, blocks become silent fails)
//   ✓ categorizeError() with 18+ Gemini + 11+ Cloudinary specific labels
//   ✓ Per-category retry policy:
//      - forever-1min: 503 capacity (Tier-1 throttling)
//      - honor-retryDelay: 429 throttle (transient rate limit)
//      - 3x-backoff: Cloudinary 5xx, Gemini 500/502, network blips
//      - 1x-then-alert: Gemini STOP-no-image (model returned text)
//      - no-retry: billing depleted, auth errors, content blocks, daily quota
//   ✓ Each failure surfaced with: severity (warn/error/critical), label,
//     actionable admin instruction (e.g. "Top up Google AI prepay balance")
//   ✓ Cover errors abort run; body page errors skip + continue.
//
// Run fresh:    pnpm tsx src/scripts/_iter8_full_book.ts
// Resume:       pnpm tsx src/scripts/_iter8_full_book.ts <gen_id>

import "dotenv/config";
import { randomUUID } from "node:crypto";
import * as https from "node:https";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  generations,
  bookPages,
  photos as photosTable,
} from "../db/schema.js";
import { uploadImage } from "../lib/cloudinary.js";

const SOURCE_GEN_ID = "68d5add6-48da-4a3e-baf3-054ad2162326";
const ORDER_ID = "76e6226a-452e-47d6-9209-b53717d6d1cd";
const PRIMARY_MODEL = "gemini-3.1-flash-image-preview";
const ASPECT_RATIO = "3:4";
const ALL_PAGES = Array.from({ length: 16 }, (_, i) => i + 1);

const argGenId = process.argv[2];
const RETRY_COVER = process.env.RETRY_COVER === "1";
const STOP_AT_PAGE = process.env.STOP_AT_PAGE ? parseInt(process.env.STOP_AT_PAGE, 10) : 16;

interface InlineImage { data: string; mimeType: string }
interface ContentPart { text?: string; inlineData?: InlineImage; rawModelPart?: Record<string, unknown> }
interface ContentTurn { role: "user" | "model"; parts: ContentPart[] }
interface ApiResult { image: InlineImage; rawParts: Array<Record<string, unknown>> }

interface BibleOutfitVariation { pageNumbers?: number[]; description?: string }
interface BibleOutfit { default?: string; variations?: BibleOutfitVariation[] }
interface BibleSupportingCharacter { name?: string; relationship?: string; appearance?: string }
interface BibleMainChild {
  name?: string;
  age?: number;
  gender?: string;
  outfit?: BibleOutfit;
  appearance?: { hair?: string; skin?: string; eyes?: string; distinguishing?: string };
}
interface BibleType {
  characterBible?: { mainChild?: BibleMainChild; supportingCharacters?: BibleSupportingCharacter[] };
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

interface PageFailure {
  pageNumber: number | "cover";
  label: string;
  severity: string;
  action: string;
  error: string;
}

function shrinkCloudinaryUrl(url: string): string {
  if (!url.includes("res.cloudinary.com") || !url.includes("/upload/")) return url;
  if (url.includes("/upload/c_") || url.includes("/upload/w_")) return url;
  return url.replace("/upload/", "/upload/c_limit,w_768,f_jpg,q_70/");
}

async function fetchAsBase64(url: string): Promise<InlineImage> {
  // 3-attempt retry with backoff — Node fetch + Cloudinary occasionally
  // ETIMEDOUTs on flaky networks. Without this, the top-level customer-photo
  // and wardrobe-anchor pre-fetches crash the whole script.
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(shrinkCloudinaryUrl(url));
      if (!res.ok) throw new Error(`fetch ${res.status}`);
      const ct = res.headers.get("content-type") ?? "image/jpeg";
      const buf = Buffer.from(await res.arrayBuffer());
      console.log(`    fetched ${(buf.length / 1024).toFixed(0)}KB${attempt > 1 ? ` (attempt ${attempt})` : ""}`);
      return { data: buf.toString("base64"), mimeType: ct };
    } catch (err) {
      lastErr = err;
      console.log(`    fetch attempt ${attempt}/3 failed: ${(err as Error).message?.slice(0, 100)}`);
      if (attempt < 3) await new Promise((r) => setTimeout(r, 5_000 * attempt));
    }
  }
  throw lastErr;
}

// Parse-time fix: detect content blocks (HTTP 200 with finishReason !== STOP,
// or 200 with promptFeedback.blockReason). Without this, the API "succeeds"
// but returns no image, and our retry loop hammers it forever silently.
function callGoogleApiOnce(contents: ContentTurn[]): Promise<ApiResult> {
  return new Promise((resolve, reject) => {
    const apiKey = process.env.GOOGLE_AI_API_KEY!;
    const restContents = contents.map((turn) => ({
      role: turn.role,
      parts: turn.parts.map((part) => {
        if (part.rawModelPart) return part.rawModelPart;
        if (part.inlineData) return { inline_data: { mime_type: part.inlineData.mimeType, data: part.inlineData.data } };
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
    const url = new URL(`https://generativelanguage.googleapis.com/v1beta/models/${PRIMARY_MODEL}:generateContent?key=${apiKey}`);
    const req = https.request(
      {
        hostname: url.hostname,
        path: url.pathname + url.search,
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
        timeout: 1_200_000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const responseBody = Buffer.concat(chunks).toString("utf8");
          if (res.statusCode !== 200) {
            const e = new Error(`Google ${res.statusCode}: ${responseBody.slice(0, 500)}`) as Error & { statusCode?: number };
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
              const e = new Error(`Gemini prompt blocked: ${json.promptFeedback.blockReason}`) as Error & { blockReason?: string };
              e.blockReason = json.promptFeedback.blockReason;
              return reject(e);
            }

            for (const cand of json.candidates ?? []) {
              // Output content block (200 OK with non-STOP finishReason)
              if (cand.finishReason && cand.finishReason !== "STOP") {
                const e = new Error(`Gemini ${cand.finishReason}: no image returned`) as Error & { finishReason?: string };
                e.finishReason = cand.finishReason;
                return reject(e);
              }

              const rawParts = cand.content?.parts ?? [];
              for (const part of rawParts) {
                const camel = part.inlineData as { data?: string; mimeType?: string } | undefined;
                if (camel?.data && camel?.mimeType) return resolve({ image: { data: camel.data, mimeType: camel.mimeType }, rawParts });
                const snake = part.inline_data as { data?: string; mime_type?: string } | undefined;
                if (snake?.data && snake?.mime_type) return resolve({ image: { data: snake.data, mimeType: snake.mime_type }, rawParts });
              }

              // STOP but no inline image — model returned text instead of image
              if (cand.finishReason === "STOP") {
                const e = new Error(`No image: model returned text only (finishReason STOP)`) as Error & { finishReason?: string };
                e.finishReason = "STOP";
                return reject(e);
              }
            }
            reject(new Error(`No image: ${responseBody.slice(0, 200)}`));
          } catch (e) { reject(e); }
        });
      },
    );
    req.on("timeout", () => { req.destroy(); reject(new Error("Timeout 20min")); });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// Extract Google's RetryInfo.retryDelay from the error response body. Format
// is `"retryDelay": "60s"` per google.rpc.RetryInfo. Returns ms or undefined.
function extractRetryDelayMs(err: unknown): number | undefined {
  const msg = (err as Error).message ?? "";
  const match = msg.match(/"retryDelay":\s*"(\d+)s"/);
  if (match && match[1]) return parseInt(match[1], 10) * 1000;
  return undefined;
}

// Comprehensive error taxonomy (Gemini + Cloudinary + network + DB + content
// blocks). Each branch returns an ErrorCategory with retry policy, severity,
// and an actionable admin instruction. Order matters — billing patterns
// FIRST in the 429 disambiguation, throttle as fallthrough.
function categorizeError(err: unknown): ErrorCategory {
  const e = err as { statusCode?: number; http_code?: number; message?: string; finishReason?: string; blockReason?: string };
  const status = e.statusCode;
  const msg = (e.message ?? "").toString();
  const lower = msg.toLowerCase();

  // ---- Gemini 200-with-block (must check BEFORE generic "no image") ----
  if (e.finishReason === "IMAGE_SAFETY") return { label: "Gemini Content Blocked - Output Safety", retry: "no-retry", severity: "error", action: "Review prompt; may need manual illustration" };
  if (e.finishReason === "PROHIBITED_CONTENT" || e.finishReason === "IMAGE_PROHIBITED_CONTENT") return { label: "Gemini Content Blocked - Layer 2", retry: "no-retry", severity: "error", action: "Layer-2 block (CSAM/copyright/celebrity-likeness) — rephrase prompt" };
  if (e.finishReason === "RECITATION" || e.finishReason === "IMAGE_RECITATION") return { label: "Gemini Recitation Block", retry: "no-retry", severity: "warn", action: "Output matched copyrighted training data — vary prompt" };
  if (e.blockReason === "SAFETY" || e.blockReason === "BLOCKLIST" || e.blockReason === "PROHIBITED_CONTENT") return { label: "Gemini Prompt Blocked - Input", retry: "no-retry", severity: "error", action: "Input prompt failed safety pre-check — review wording" };
  if (e.finishReason === "STOP" && /^no image/i.test(msg)) return { label: "Gemini No Image Generated", retry: "1x-then-alert", severity: "warn", action: "Model returned text only; one reroll usually fixes" };

  // ---- Gemini 429 — THREE-WAY DISAMBIGUATION (order matters!) ----
  if (status === 429) {
    if (/prepayment\s+credits.*deplet/i.test(msg) || /no\s+available\s+credits/i.test(msg)) return { label: "Gemini Billing - Credits Depleted", retry: "no-retry", severity: "critical", action: "Top up Google AI prepay balance" };
    if (/monthly\s+spending\s+cap/i.test(msg) || /billing\s+account.*exceed/i.test(msg)) return { label: "Gemini Billing - Spending Cap", retry: "no-retry", severity: "critical", action: "Raise spending cap or wait for next billing cycle" };
    if (/per\s+day|requests\s+per\s+day|RPD/i.test(msg)) return { label: "Gemini Quota - Daily Exhausted", retry: "retry-after-midnight-PT", severity: "error", action: "Wait until 00:00 PT reset; request quota increase" };
    if (/free_tier/i.test(msg) && /quota.*0/i.test(msg)) return { label: "Gemini Tier Misconfigured", retry: "no-retry", severity: "error", action: "Verify Tier 1 billing took effect; contact GCP support" };
    return { label: "Gemini Rate Limit - Throttle", retry: "honor-retryDelay", severity: "warn", action: "Transient throttle — backoff and retry" };
  }

  // ---- Gemini 4xx auth/config (permanent) ----
  if (status === 400 && /(location.*not\s+supported|billing.*not\s+enabled|FAILED_PRECONDITION)/i.test(msg)) return { label: "Gemini Billing Region Block", retry: "no-retry", severity: "critical", action: "Enable billing on GCP project; verify region eligibility" };
  if (status === 400) return { label: "Gemini Bad Request", retry: "no-retry", severity: "error", action: "Fix request payload; check schema" };
  if (status === 401 || /API\s+key\s+not\s+valid|API_KEY_INVALID/i.test(msg)) return { label: "Gemini Auth - Invalid Key", retry: "no-retry", severity: "critical", action: "Rotate GOOGLE_AI_API_KEY" };
  if (status === 403) return { label: "Gemini Auth - Permission Denied", retry: "no-retry", severity: "critical", action: "Enable Generative Language API; check key restrictions" };
  if (status === 404 && /(model|generateContent)/i.test(msg)) return { label: "Gemini Model Deprecated", retry: "no-retry", severity: "critical", action: "Update model name in env; check deprecation notice" };

  // ---- Gemini 5xx transient ----
  if (status === 503 || /overloaded|UNAVAILABLE/i.test(msg)) return { label: "Gemini Capacity (Tier 1)", retry: "forever-1min", severity: "warn", action: "Known Tier-1 capacity pressure; safe to wait" };
  if (status === 500) return { label: "Gemini Internal Error", retry: "3x-backoff", severity: "warn", action: "Transient Google-side; retrying" };
  if (status === 502) return { label: "Gemini Gateway Error", retry: "3x-backoff", severity: "warn", action: "Transient gateway; retrying" };
  if (status === 504 || status === 408 || /(deadline\s+exceeded|^timeout)/i.test(lower)) return { label: "Gemini Timeout", retry: "3x-backoff", severity: "warn", action: "Reduce prompt size or retry" };

  // ---- Cloudinary (matched by err.http_code OR message tokens) ----
  const httpCode = e.http_code;
  if (httpCode || /cloudinary/i.test(msg)) {
    if (/invalid\s+signature|string\s+to\s+sign/i.test(msg)) return { label: "Cloudinary Auth - Bad Signature", retry: "no-retry", severity: "critical", action: "Check CLOUDINARY_API_SECRET matches account" };
    if (/invalid\s+api[_\s]?key/i.test(msg)) return { label: "Cloudinary Auth - Invalid Key", retry: "no-retry", severity: "critical", action: "Rotate CLOUDINARY_API_KEY" };
    if (/(cloud_name.*disabled|customer\s+is\s+disabled)/i.test(msg)) return { label: "Cloudinary Account Suspended", retry: "no-retry", severity: "critical", action: "Contact Cloudinary support" };
    if (/(file\s+size\s+too\s+large|maximum\s+is\s+\d+)/i.test(msg) || httpCode === 413) return { label: "Cloudinary File Too Large", retry: "no-retry", severity: "error", action: "Compress image; check tier max (free=10MB)" };
    if (/(empty\s+file|invalid\s+image)/i.test(msg)) return { label: "Cloudinary Bad Input", retry: "no-retry", severity: "error", action: "Image buffer corrupted upstream" };
    if (httpCode === 420 || /(rate\s+limit|concurrent\s+requests|add-on\s+usage)/i.test(msg)) return { label: "Cloudinary Rate Limit / Quota", retry: "3x-backoff", severity: "error", action: "Reduce concurrency; check monthly credit usage" };
    if (httpCode === 403) return { label: "Cloudinary Plan Restricted", retry: "no-retry", severity: "critical", action: "Upgrade plan; verify feature available on tier" };
    if (httpCode && httpCode >= 500) return { label: "Cloudinary Internal Error", retry: "3x-backoff", severity: "warn", action: "Transient Cloudinary-side" };
    return { label: "Cloudinary Upload Error", retry: "3x-backoff", severity: "error", action: "See message for details" };
  }

  // ---- Network / DB fallthrough ----
  if (/(ECONN|ENOTFOUND|ETIMEDOUT|socket\s+hang\s+up)/i.test(msg)) return { label: "Network Error", retry: "3x-backoff", severity: "warn", action: "Transient network blip" };
  if (/(postgres|drizzle|relation|column|constraint|database)/i.test(lower)) return { label: "Database Error", retry: "no-retry", severity: "critical", action: "Check schema/connection" };

  return { label: "Unknown Error", retry: "no-retry", severity: "error", action: "Review logs; investigate" };
}

// Per-category retry executor for Gemini API calls. Replaces the iter 7
// retry-forever-on-503/429/500 pattern with policy-aware retry.
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
          console.log(`      retry in ${(delay / 1000).toFixed(0)}s (honoring Google's retryDelay)...`);
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

// Cloudinary upload retry. Uses categorizeError to decide policy:
//   - 5xx / rate-limit: 3-attempt backoff (5s, 10s, 15s)
//   - auth / file-size / bad-input: no-retry, surface immediately
async function uploadWithRetry(buf: Buffer, ownerType: string, contentType: string, label: string): Promise<{ url: string; contentType: string; fileSize: number; publicId: string }> {
  let attempt = 0;
  while (true) {
    attempt++;
    try {
      console.log(`    [${label}] cloudinary upload attempt ${attempt}/3...`);
      const res = await uploadImage(buf, ORDER_ID, ownerType, contentType);
      console.log(`    [${label}] uploaded ✓`);
      return res;
    } catch (err) {
      const cat = categorizeError(err);
      console.log(`    [${label}] attempt ${attempt} → [${cat.severity.toUpperCase()}] ${cat.label}`);

      // No-retry categories: surface immediately
      if (cat.retry === "no-retry") {
        (err as Error & { category?: ErrorCategory }).category = cat;
        throw err;
      }

      // 3-attempt backoff: stop after 3
      if (attempt >= 3) {
        (err as Error & { category?: ErrorCategory }).category = cat;
        throw err;
      }
      await new Promise((r) => setTimeout(r, 5_000 * attempt));
    }
  }
}

// Surface a failure into the alerts list with full context (severity, action,
// label, raw message) so end-of-run summary + Phase B admin UI can show
// founder exactly what's wrong and what to do.
function recordFailure(err: unknown, pageNumber: number | "cover", failures: PageFailure[]): void {
  const cat = (err as Error & { category?: ErrorCategory }).category ?? categorizeError(err);
  const msg = (err as Error).message?.slice(0, 300) ?? "unknown";
  failures.push({
    pageNumber,
    label: cat.label,
    severity: cat.severity,
    action: cat.action,
    error: msg,
  });
  console.log(`  ⚠️  [${cat.severity.toUpperCase()}] ${cat.label}`);
  console.log(`     Error: ${msg.slice(0, 150)}`);
  console.log(`     Admin action: ${cat.action}`);
}

function getOutfitForPage(bible: BibleType, pageNumber: number): { outfit: string; isVariation: boolean } {
  const outfit = bible?.characterBible?.mainChild?.outfit;
  const fallback = "the protagonist's default clothing";
  if (!outfit) return { outfit: fallback, isVariation: false };
  const variation = (outfit.variations ?? []).find((v) => v.pageNumbers?.includes(pageNumber));
  if (variation?.description) return { outfit: variation.description, isVariation: true };
  return { outfit: outfit.default ?? fallback, isVariation: false };
}

function estimateHeightCm(ageYears: number): number {
  if (ageYears <= 2) return 88;
  if (ageYears <= 4) return 102;
  if (ageYears <= 6) return 113;
  if (ageYears <= 8) return 126;
  if (ageYears <= 10) return 138;
  return 148;
}

function buildSupportingCharacterAnchors(
  bible: BibleType,
  charactersOnPage: string[],
  protagonist: string,
): string {
  const supporting = bible?.characterBible?.supportingCharacters ?? [];
  const otherNames = charactersOnPage.filter((c) => c !== protagonist);
  if (otherNames.length === 0) return "";

  const lines = otherNames.map((name) => {
    const entry = supporting.find((c) => c.name === name);
    if (entry?.appearance) return `- ${name} (${entry.relationship ?? "supporting character"}): ${entry.appearance}`;
    return `- ${name}: render as Egyptian-context appropriate. If an adult: shoulders at ${protagonist}'s eye-level, head one full head-height above hers. If a child within ~2 years of ${protagonist}'s age: IDENTICAL eye-line, top-of-head, and feet-line as ${protagonist} — top-of-head touches the same horizontal ruler, feet touch the same ground plane, body fills the same pixel-height.`;
  });

  return `\n\n[OTHER CHARACTERS ON THIS PAGE — match these descriptions for age, height, and appearance]
${lines.join("\n")}`;
}

// Per AI Engineer 2026-05-10 evening research: full rewrite to fix two
// founder-reported issues:
//   (1) "Why does she look sad?" — old prompt overused "calm neutral" /
//       "softly closed lips" defaults; new version leads with EYE-detail
//       language (catchlights, lash lift, eye-crinkle) per picture-book
//       illustration principle that children read eyes first.
//   (2) "She doesn't feel in contact with other characters" — old prompt
//       literally said "separate from {protagonist}" which the Gemini 3
//       reasoning planner composed as parallel coexistence. New version
//       uses RELATIONAL VERBS (gazes meeting, hands on same object,
//       shoulder-to-shoulder, mirrored posture) that activate the planner's
//       interaction-mode composition.
//
// Strips anti-patterns: "separate from", "with their own distinct faces",
// "present in the scene", "calm neutral", "softly closed lips" overuse,
// "mouth corners held flat".
function sceneNarrativeFromBeat(beat: string, charactersOnPage: string[], protagonist: string): string {
  const beatLower = beat.toLowerCase();
  const otherChars = charactersOnPage.filter((c) => c !== protagonist);
  const hasOthers = otherChars.length > 0;
  const otherList = otherChars.join(" and ");

  // RELATIONAL CLAUSE — replaces the old "separate from" anti-pattern.
  // When others are present, we explicitly prompt connection (eye contact,
  // shared focus, physical proximity). The substitution at the end converts
  // any literal "${protagonist}" inside the verb string to the actual name.
  const withOthers = (interactionVerb: string): string =>
    hasOthers
      ? ` ${otherList} ${interactionVerb.replace(/\$\{protagonist\}/g, protagonist)}`
      : "";

  // --- OPENING / ANTICIPATION ---
  if (beatLower.includes("new beginning") || beatLower.includes("excitement") || beatLower.includes("excited"))
    return `${protagonist} is in three-quarter view, leaning slightly forward into the scene with bright anticipation. Her eyes are wide and lit from within — pupils catching the light, lashes lifted, brows raised in soft delight. The corners of her mouth curve up in a small, real smile that reaches her eyes (the eye-crinkle leads, the smile follows). Her shoulders are open, hands loose and ready, body angled toward what's about to happen.${withOthers("are turned toward her, sharing the same forward-leaning energy — their gazes meeting hers in mutual excitement, bodies oriented into the same focal moment.")}`;

  if (beatLower.includes("nervous") || beatLower.includes("anticipat"))
    return `${protagonist} is in three-quarter view, hands lightly clasped in front of her or fingertips touching her sleeve. Her eyes are wide and alert, looking softly toward what's ahead — searching, not afraid. Her brows are gently raised, lips just barely parted in a small inhale. The corners of her mouth are soft and slightly lifted — a hopeful, brave-but-uncertain warmth, never stoic.${withOthers("are nearby and turned toward her with reassuring presence, one of them angled to catch her eye — the composition reads as 'she is not alone in this nervous moment.'")}`;

  // --- LONELY / SOLITARY (still warm + sympathetic, never blank) ---
  if (beatLower.includes("lonel") || beatLower.includes("isolat") || beatLower.includes("initial loneliness"))
    return `${protagonist} is in three-quarter view, sitting or standing slightly apart from the action. Her eyes are large, soft, and luminous — catchlights still alive in them, lashes lowered just a fraction. Her gaze is directed gently outward (toward the other children playing, toward a window, toward something she wishes to join), NOT downcast at the floor. Her lips are softly closed with the corners just barely turned down in a wistful, tender quiet — sympathetic, NOT stoic. The viewer should feel for her, want to reach into the page and bring her in.${withOthers("are visible in the middle-distance of the frame, engaged with each other; the composition lets her eyes travel toward them with quiet longing, creating a visible emotional bridge across the negative space.")}`;

  // --- MEETING / NEW CONNECTION ---
  if (beatLower.includes("spark") || beatLower.includes("potential friendship") || beatLower.includes("introduc") || beatLower.includes("meet"))
    return `${protagonist} is in three-quarter view, her face turned directly toward the other character, her eyes meeting theirs across a small, intimate distance. Her brows are softly raised in curious openness; her lips are gently parted in a small "oh!" of recognition, the corners just lifting into the beginning of a smile.${withOthers("face her in mirrored three-quarter view — their eyes locked with hers, bodies angled toward each other, the negative space between them small and charged. Both characters lean fractionally toward the other, as if the air between them is pulling them together.")}`;

  // --- TRYING / FAILING / KEEPING TRYING ---
  if (beatLower.includes("first attempt") || beatLower.includes("misunderstanding"))
    return `${protagonist} is in three-quarter view, hands actively engaged in the shared task with the other character. Her brows are knit in earnest concentration, lips pressed in a soft, determined line with the corners holding warmth — focused but not grim. Her eyes flick toward her partner with a flicker of "wait, that's not quite it…" — alive with effort, not defeat.${withOthers("are right there in the same frame, hands on the same object as ${protagonist}, faces mirroring her concentration, gazes crossing between her hands and her face — clearly working on the SAME thing together, even if not yet in sync.")}`;

  if (beatLower.includes("second attempt") || beatLower.includes("clumsy") || beatLower.includes("coordination"))
    return `${protagonist} is in three-quarter view, leaning into a shared physical effort with the other character — both bodies dynamic, hands engaged on the same task. Her cheeks are warm with effort, eyes bright and watching her partner's hands closely. A small closed-mouth smile holds steady at the corners of her lips — concentrated, hopeful, never overstated. The energy is warm and trying-together, never frustrated.${withOthers("are mirroring her posture from the opposite side of the shared object — knees bent the same way, hands inches from hers, eyes flicking to meet hers in shared 'oops, almost!' — bodies forming a closed loop around the activity.")}`;

  if (beatLower.includes("third attempt") || beatLower.includes("teamwork emerges") || beatLower.includes("teamwork"))
    return `${protagonist} is in three-quarter view, fully engaged in the shared task with the other character — her hands on the same object as theirs, fingers nearly touching. Her face shows quiet, dawning satisfaction: eyes softly bright with the corners just barely crinkling, a small closed-mouth smile that pulls one cheek warm, brows in their natural resting position (NOT raised). The expression reads as "this is starting to work" — calm, internal, eye-led — never theatrical, never an open-mouth grin, never a wide-eyed surprise face.${withOthers("are leaning in from the opposite side of the activity, hands on the same object as ${protagonist}'s, faces turned toward hers with the same understated, eye-led smile at matching intensity. The three characters form a tight visual triangle (hands → object → meeting eyes); the connection reads in the calm shoulders and shared focus, not in big facial gestures.")}`;

  // --- REALIZATION / WORKING TOGETHER ---
  if (beatLower.includes("realization") || beatLower.includes("shared goal"))
    return `${protagonist} is in three-quarter view, her face lit with the bright, warm glow of understanding. Her eyes are wide with recognition, brows raised, lips parted in a soft "ohhh!" of insight. The corners of her mouth turn up into a real smile that crinkles her eyes.${withOthers("face her in mirrored realization — their eyes locking with hers in a shared 'we both see it now' moment. Both bodies turn toward each other, hands lifting in matching gestures of recognition.")}`;

  if (beatLower.includes("working harmoni") || beatLower.includes("harmoniously") || beatLower.includes("blossoming"))
    return `${protagonist} is in three-quarter view, hands moving in confident rhythm with the other character on the shared task. Her face is relaxed and joyful: eyes soft and bright, mouth curved in an easy, real smile, cheeks warm. Her whole body reads as "in flow" — shoulders loose, posture open, no tension.${withOthers("move in matching rhythm beside her — hands choreographed with hers, shoulders lightly brushing or inches apart, faces turning toward each other every few beats with shared delight. The composition reads as a single connected unit working as one.")}`;

  // --- CELEBRATION / SUCCESS / JOY ---
  if (beatLower.includes("celebrat") || beatLower.includes("success") || beatLower.includes("joy") || beatLower.includes("happ"))
    return `${protagonist} is in three-quarter view, joyful — a real warm smile reaches the eyes first, mouth softly parted in quiet delight, eyes warm and crinkled at the corners. Cheeks softly flushed, hands lifted in gentle celebration. The expression is quietly happy, eye-led, watercolor-restrained — never open-mouthed laughing.${withOthers("share her quiet delight — heads turned warmly toward each other, eyes meeting hers in shared softly-glowing joy, hands gently raised or clasped. The three (or two) of them lean toward a shared center in calm warmth, not big-gesture celebration.")}`;

  // --- REFLECTION / GRATITUDE / WARMTH / BELONGING ---
  if (beatLower.includes("reflection") || beatLower.includes("gratitude") || beatLower.includes("connection") || beatLower.includes("warmth") || beatLower.includes("belonging"))
    return `${protagonist} is in three-quarter view, her face soft and luminous with quiet contentment. Her eyes are gentle and warm, looking thoughtfully toward the other character (or toward the setting sun / the room / the moment). Her lips curve in a small, private, real smile — the kind that lives mostly in the eyes. Cheeks warm, shoulders relaxed.${withOthers("are close beside her, often leaning shoulder-to-shoulder or with one of their hands resting gently on hers — their gaze meeting hers in shared, comfortable belonging. The two figures read as a single warm unit.")}`;

  // --- COURAGE / DECISIVENESS ---
  if (beatLower.includes("courage") || beatLower.includes("brave") || beatLower.includes("decisive"))
    return `${protagonist} is in three-quarter view, her eyes focused forward with bright, alive determination — not steely, but warm and resolved. Her brows are softly drawn together; lips firm but with the corners holding a trace of tender courage. Her body leans into the challenge, hands ready.${withOthers("stand close behind or beside her, their faces turned toward her with visible support — gazes resting on her with warmth, not detached observation.")}`;

  // --- NOTICING / OBSERVING ---
  if (beatLower.includes("notic") || beatLower.includes("observ"))
    return `${protagonist} is in three-quarter view, her gaze focused with bright curiosity on what she has just noticed. Her eyes are wide and alive; brows lifted in interest; mouth softly open in an "oh!" of attention. Her whole body is leaning toward what she sees.${withOthers("turn to follow her gaze, their eyes tracking toward the same point of attention — the composition reads as shared focus, not parallel awareness.")}`;

  // --- DEFAULT FALLBACK — engaged warmth, NOT calm neutral ---
  return `${protagonist} is in three-quarter view, fully alive in the moment of the scene. Her eyes are bright with present attention — pupils catching the light, lashes lifted, gaze directed warmly into the action. Her brows are softly mobile (raised, lowered, or knit in response to the scene, never flat). Her lips rest in a small, soft expression that reads as engaged — corners gently lifted in an unposed half-smile, or parted in a quiet exhale of attention. Cheeks warm, posture leaning fractionally into the moment. Her face is unmistakably emotionally readable as a present, feeling child, never a stoic neutral mask.${withOthers("are in the same frame with ${protagonist}, bodies oriented toward her or toward the shared focal point, gazes crossing hers — the composition reads as characters sharing a moment together, never as separate figures coexisting in parallel.")}`;
}

// Pattern A from AI Engineer 2026-05-10 cover research: cinema-poster watercolor
// cover with structured 5-block narrative (purpose + composition + lighting +
// expression + purpose-restate). Replaces the prior "lived-in domestic vitality"
// prose which was producing intimate vignettes instead of magnetic covers.
// Anti-patterns documented in the research: "lived-in", "caught mid-step",
// "hand gesturing in welcome" — all stripped here.
function buildCoverNarrative(args: { childName: string; ageYears: number; heightCm: number }): string {
  return `THIS IS THE COVER ILLUSTRATION of an Egyptian children's storybook — the single most important image in the book, the iconic keyframe that pulls a 4-to-7-year-old reader in from across the room. Treat it as a watercolor cover painting in the tradition of Helen Oxenbury's *We're Going on a Bear Hunt* cover and Tomie dePaola's *Strega Nona* cover: a single magnetic hero portrait, not a domestic vignette.

${args.childName} is the protagonist — a ${args.ageYears}-year-old Egyptian girl, approximately ${args.heightCm}cm tall (the realistic, natural height of a real ${args.ageYears}-year-old child, NOT enlarged or stylized larger). She stands as the clear focal subject of the frame.

[COVER COMPOSITION — overrides body-page composition rules]
- Hero pose, slight low-angle (camera roughly at the child's chest height looking up at her face) so she reads as iconic and inviting rather than observed-from-above.
- Three-quarter body framing: head, shoulders, torso, and at least to mid-thigh in the frame. NOT a full-body wide shot, NOT a tight head-and-shoulders portrait — the cover sweet spot is "hero half-body."
- Her face is anchored at the upper rule-of-thirds intersection (slightly left or right of center, NOT dead-center). Eyes meet the viewer directly with warm, confident invitation — the single strongest pull on a children's-book cover is direct eye contact from the protagonist.
- Strong figure-to-ground separation: her silhouette reads cleanly as a single bold focal shape against an atmospheric, simplified Cairo backdrop that recedes in soft watercolor washes. The background hints at the story's world — a single mashrabiya screen, a sliver of warm Cairo rooftop, the suggestion of a courtyard — never a cluttered domestic interior competing for attention.
- Bottom one-third of the frame stays compositionally calmer (softer washes, fewer focal elements) — the PDF assembly layer places the title there. Top two-thirds carry the hero figure and atmosphere.

[COVER LIGHTING — theatrical but watercolor-faithful]
- Luminous golden-hour backlight from behind and slightly above her, creating a warm rim of light along her hair, shoulder, and cheek edge — the painted equivalent of a hero rim light. Soft directional key light from the front-left fills her face so identity stays fully readable.
- The paper itself glows through the washes behind her (paper-white preserved as halo around the figure). Atmospheric perspective: background washes are paler and bluer than the foreground, pushing her forward as the focal subject.
- This is dramatic-but-soft — luminous, not chiaroscuro; warm, not dark.

[COVER EXPRESSION — the magnetic invitation]
- Real, unposed warmth: eyes bright and softly crinkled at the corners, a genuine closed-mouth smile or barely-parted lips with the corners gently lifted (the eyes lead the smile, the mouth follows). NOT a wide commercial grin, NOT a stiff photo pose, NOT a neutral "caught mid-step" expression.
- Her body is squared toward the viewer with confident ease — shoulders open, head slightly tilted, an implicit "come into this story with me" invitation. She is presenting herself to the reader as the heroine of the book, not caught in a private moment.

[COVER PURPOSE]
This single image must function as a magnetic cinema-poster-quality children's-book cover — the kind of cover a 4-to-7-year-old points at across a bookshop and asks for by name. Iconic, warm, alive, watercolor-soft, theatrically lit, unmistakably the protagonist of THIS book.`;
}

function buildPrompt(args: {
  bible: BibleType;
  childName: string;
  isCover: boolean;
  charactersOnPage: string[];
  emotionalBeat: string;
  storyScene: string;
  outfit: string;
  hasWardrobeAnchor: boolean;
  outfitIsVariation: boolean;
}): string {
  const ageYears = args.bible?.characterBible?.mainChild?.age ?? 5;
  const heightCm = estimateHeightCm(ageYears);

  const sceneNarrative = args.isCover
    ? buildCoverNarrative({ childName: args.childName, ageYears, heightCm })
    : sceneNarrativeFromBeat(args.emotionalBeat, args.charactersOnPage, args.childName);

  const supportingAnchors = args.isCover
    ? ""
    : buildSupportingCharacterAnchors(args.bible, args.charactersOnPage, args.childName);

  const referenceImageBlock = args.hasWardrobeAnchor
    ? `[REFERENCE IMAGES]
Image 1 — IDENTITY REFERENCE for ${args.childName}: use ONLY for face structure, skin tone, hair color, hair texture, hair styling. Ignore expression, pose, lighting, clothing, background.
Image 2 — STYLE REFERENCE: use ONLY for watercolor medium, brushwork, wet-on-wet bleeds, palette, paper texture. Ignore character, expression, pose, composition.
Image 3 — WARDROBE REFERENCE: use ONLY for ${args.childName}'s outfit — exact garment shapes, exact colors, exact accessories. Match her outfit pixel-faithfully to Image 3. Ignore Image 3's face, pose, expression, composition, background.`
    : `[REFERENCE IMAGES]
Image 1 — IDENTITY REFERENCE for ${args.childName}: use ONLY for face structure, skin tone, hair color, hair texture, hair styling. Ignore expression, pose, lighting, clothing, background.
Image 2 — STYLE REFERENCE: use ONLY for watercolor medium, brushwork, wet-on-wet bleeds, palette, paper texture. Ignore character, expression, pose, composition.`;

  const wardrobeLockBlock = args.outfitIsVariation
    ? `[WARDROBE LOCK — non-negotiable, this page uses a STORY-DRIVEN VARIATION outfit, NOT the default]
${args.childName} wears EXACTLY: ${args.outfit}.
This page intentionally departs from the default outfit shown elsewhere — render the variation outfit precisely, do NOT match any reference image's clothing. Every garment, every color, every accessory must match this string verbatim.`
    : `[WARDROBE LOCK — non-negotiable]
${args.childName} wears EXACTLY: ${args.outfit}.
Every garment, every color, every accessory must match this string verbatim${args.hasWardrobeAnchor ? " AND must match Image 3 pixel-faithfully" : ""}. Do NOT introduce a different shirt, a different color, or any new accessory not listed above. If this conflicts with the scene action, render the action while keeping the wardrobe identical.`;

  return `You are illustrating one page of a soft Egyptian watercolor children's storybook. Render the scene below as a fresh, original watercolor painting from scratch — do NOT copy any input image's composition, pose, or expression.

${referenceImageBlock}

[SCENE — paint this exactly as described]
${sceneNarrative}
Specific page action: ${args.storyScene}
Wearing: ${args.outfit}.${supportingAnchors}

[ASPECT RATIO & FRAMING]
3:4 portrait (taller than wide).
${args.isCover
  ? `See [COVER COMPOSITION] in scene narrative — that block is authoritative.`
  : `This is a FULL-BODY GROUP SHOT, head-to-toe. Every child in this frame is rendered from the top of the head to the soles of the shoes — no character is cropped at the waist, knees, or ankles. The bottom edge of the painted frame sits BELOW the children's shoes, with a visible margin of ground (dirt, tile, courtyard floor) painted between the shoes and the bottom edge. ${args.childName}'s feet are planted on the ground in the same plane as every other child's feet — both shoes visible, both legs visible from hip to ankle. The camera is roughly at the children's chest height (a gentle low-angle, not from above), framing all figures full-body within the 3:4 portrait. Reserve the bottom one-quarter of the frame for ground/floor with the children's feet sitting on the upper line of that band — this is the standing-plane anchor.`}

[SCALE — eye-line locked, peers identical, off-center protagonist]
- ${args.childName} is ${ageYears} years old, ~${heightCm}cm tall, with the head-to-body proportions of a real ${ageYears}-year-old (approximately 5.5 heads tall at this age — NOT a chibi, NOT a stylized big-head).
- Every other child of similar age in this frame (peers, classmates, friends, siblings within ~2 years) is rendered at the IDENTICAL height as ${args.childName}: top-of-head at the same horizontal pixel-line, eye-line at the same horizontal pixel-line, shoulder-line at the same horizontal pixel-line, feet-line at the same horizontal pixel-line. Imagine a horizontal ruler at eye level and a second ruler at the top of the head — every child in the frame touches both rulers.
- ${args.childName}'s head, body, hands, and feet occupy the SAME pixel-area as each peer's head, body, hands, and feet (within 5%). She is one peer among peers, drawn at peer scale.
- ${args.childName} is positioned at a rule-of-thirds intersection (off-center), NOT at the geometric center of the frame. The shared activity or object the children work on together occupies the central focal area — the protagonist gets her focus from her placement, lighting, and direct eye-readability, never from being drawn larger.
- Adults (parents, teachers) stand significantly taller — adult shoulder-line sits at the children's forehead-to-eye height; adult head clears every child's head by at least one full head-height.
- Render every character at real-world proportions to each other and to environment objects (doors, walls, furniture).

[EXPRESSION CALIBRATION — picture-book restraint, peer-matched]
${args.childName}'s emotional intensity matches the other children in this frame at the same level — never higher, never more theatrical. The watercolor picture-book register (Helen Oxenbury, Tomie dePaola, Jerry Pinkney) reads emotion through the EYES first (softness, catchlights, gentle crinkle at the outer corners) and the mouth second (a small closed-mouth or barely-parted smile). Avoid the cartoon "shocked-delight" combination of wide eyes + lifted brows + open mouth all at once — pick at most one of those three signals and keep the other two restrained. If a peer in the same frame would smile with a closed mouth, ${args.childName} smiles with a closed mouth.

[COMPOSITION]
${args.isCover
  ? `See [COVER COMPOSITION] above — authoritative.`
  : `${args.childName} is the focal subject but is positioned at a rule-of-thirds vertical line (left-third or right-third intersection), NOT dead-center — the centered position is reserved for the shared activity/object the children are working on together. Her face is fully readable: three-quarter view, both eyes and nose visible. Frame contains the full standing bodies of all children plus a small head-room margin above and a clear ground-margin below.`}

[IDENTITY PRESERVATION]
Match ${args.childName}'s face from Image 1: eye shape, iris color, hair texture, hair styling, skin tone, jaw and chin shape. She is wearing ${args.outfit}.

[LIGHTING]
${args.isCover
  ? `See [COVER LIGHTING] block in scene narrative above — that block is authoritative for cover lighting and overrides any default lighting rules.`
  : `Warm golden afternoon light, gentle directional lighting with luminous edges, ambient watercolor glow.`}

[STYLE]
Visible brush strokes, wet-on-wet bleeds, cold-press paper texture, in the soft watercolor warmth of Tomie dePaola's *Strega Nona* applied to Egyptian children and Cairo apartment settings. No text, letters, or typography anywhere.

${wardrobeLockBlock}`;
}

const TURN_2_CRITIQUE_FACE_WARDROBE = (childName: string, outfit: string, hasWardrobeAnchor: boolean) => `Look at your previous output. Verify FIVE specific axes against the inputs:

AXIS 1 — FACE (compare to Image 1):
Pull ${childName}'s eye shape, iris color, hair texture, hair styling, skin tone, jaw and chin shape closer to Image 1's exact values.

AXIS 2 — WARDROBE (compare to this exact spec):
${childName} must wear EXACTLY: ${outfit}.${hasWardrobeAnchor ? " Match Image 3 pixel-faithfully." : ""}
Regenerate any garment, color, or accessory that differs.

AXIS 3 — SCALE & EYE-LINE LOCK:
Trace a horizontal line through ${childName}'s eyes. Every other similar-aged child in the frame must have their eyes on that SAME horizontal line. Trace a second horizontal line through ${childName}'s top-of-head — every peer's top-of-head touches that line. Trace a third line through ${childName}'s feet — every peer's feet touch that line. If any peer's eye-line, top-of-head, or feet-line is offset from ${childName}'s, redraw the peer at matched height. ${childName} must NOT occupy more pixel-area than any peer.

AXIS 4 — FULL BODY ANTI-CROP:
Every child in the frame must be rendered head-to-toe. Both feet and shoes of every child, including ${childName}, must be visible and planted on the ground inside the frame, with a visible margin of ground painted below the shoes. If ${childName}'s legs, feet, or shoes are missing, hidden by the frame edge, or merged into the ground, redraw her with full legs and shoes visible on the same ground plane as her peers.

AXIS 5 — EXPRESSION RESTRAINT:
${childName}'s expression intensity must match the peers' intensity in this frame — not larger, not more theatrical. If she has wide-open eyes + lifted brows + open-mouth grin all at once, soften to picture-book restraint: eye-led warmth, brows at natural rest, a small closed-mouth or barely-parted smile that matches the peers' smiles.

Re-render the same scene, same pose narrative, same composition, same watercolor style, same 3:4 aspect ratio. Refine ONLY face geometry, wardrobe, scale, framing, and expression intensity.`;

async function multiTurnRefine(args: {
  bible: BibleType;
  childName: string;
  isCover: boolean;
  charactersOnPage: string[];
  emotionalBeat: string;
  storyScene: string;
  outfit: string;
  outfitIsVariation: boolean;
  customerPhoto: InlineImage;
  illustration: InlineImage;
  wardrobeAnchor: InlineImage | null;
}): Promise<InlineImage> {
  const hasWardrobeAnchor = args.wardrobeAnchor !== null;

  const turn1Parts: ContentPart[] = [
    { inlineData: args.customerPhoto },
    { inlineData: args.illustration },
  ];
  if (args.wardrobeAnchor) turn1Parts.push({ inlineData: args.wardrobeAnchor });
  turn1Parts.push({
    text: buildPrompt({
      bible: args.bible,
      childName: args.childName,
      isCover: args.isCover,
      charactersOnPage: args.charactersOnPage,
      emotionalBeat: args.emotionalBeat,
      storyScene: args.storyScene,
      outfit: args.outfit,
      hasWardrobeAnchor,
      outfitIsVariation: args.outfitIsVariation,
    }),
  });

  const turn1Contents: ContentTurn[] = [{ role: "user", parts: turn1Parts }];
  console.log(`    turn 1 (${turn1Parts.length - 1} refs)...`);
  const t0 = Date.now();
  const turn1 = await callGoogleApi(turn1Contents);
  console.log(`    turn 1 done in ${((Date.now() - t0) / 1000).toFixed(0)}s`);

  const turn2Contents: ContentTurn[] = [
    ...turn1Contents,
    { role: "model", parts: turn1.rawParts.map((rp) => ({ rawModelPart: rp })) },
    { role: "user", parts: [{ text: TURN_2_CRITIQUE_FACE_WARDROBE(args.childName, args.outfit, hasWardrobeAnchor) }] },
  ];
  console.log(`    turn 2 (face + wardrobe + scale critique)...`);
  const t1 = Date.now();
  try {
    const turn2 = await callGoogleApi(turn2Contents);
    console.log(`    turn 2 done in ${((Date.now() - t1) / 1000).toFixed(0)}s`);
    return turn2.image;
  } catch (err) {
    console.log(`    ⚠️  turn 2 failed: ${(err as Error).message?.slice(0, 80)} — using turn 1`);
    return turn1.image;
  }
}

function printFailureSummary(failures: PageFailure[], iterGenId: string): void {
  if (failures.length === 0) return;
  const critical = failures.filter((f) => f.severity === "critical").length;
  const error = failures.filter((f) => f.severity === "error").length;
  const warn = failures.filter((f) => f.severity === "warn").length;

  console.log("\n========================================");
  console.log(`ALERTS — ${failures.length} error${failures.length > 1 ? "s" : ""} during this run`);
  console.log(`         ${critical} critical, ${error} error, ${warn} warn`);
  console.log("========================================");
  for (const f of failures) {
    const label = f.pageNumber === "cover" ? "Cover" : `Page ${f.pageNumber}`;
    console.log(`\n  [${f.severity.toUpperCase()}] ${f.label} — ${label}`);
    console.log(`    Error: ${f.error.slice(0, 200)}`);
    console.log(`    Admin action: ${f.action}`);
  }
  console.log("");
  console.log(`To retry: pnpm tsx src/scripts/_iter8_full_book.ts ${iterGenId}`);
  console.log("");
}

async function main(): Promise<void> {
  console.log(`Iter 8 — FULL BOOK with ANCHOR IMAGE PATTERN | aspect ${ASPECT_RATIO} | strict scale | full error taxonomy\n`);

  const sourceGen = await db.select().from(generations).where(eq(generations.id, SOURCE_GEN_ID)).limit(1).then((r) => r[0]);
  if (!sourceGen?.coverUrl || !sourceGen?.storyJson) throw new Error("no source");
  const story = sourceGen.storyJson as {
    title: string;
    coverDescription?: string;
    pages: Array<{ number: number; text: string; scene: string; charactersOnPage: string[]; emotionalBeat: string }>;
  };
  const bible = (sourceGen.bibleJson ?? {}) as BibleType;
  const childAge = bible?.characterBible?.mainChild?.age ?? 5;
  const childHeight = estimateHeightCm(childAge);
  const defaultOutfit = bible?.characterBible?.mainChild?.outfit?.default ?? "(no default outfit in Bible)";
  console.log(`Protagonist: Hena, age ${childAge}, ~${childHeight}cm tall (estimated)`);
  console.log(`Outfit (default): "${defaultOutfit}"`);
  const variations = bible?.characterBible?.mainChild?.outfit?.variations ?? [];
  if (variations.length > 0) {
    console.log(`Outfit variations: ${variations.length}`);
    for (const v of variations) console.log(`  pages [${(v.pageNumbers ?? []).join(", ")}] → ${v.description}`);
  } else {
    console.log(`Outfit variations: none — all 16 pages use default`);
  }
  const supporting = bible?.characterBible?.supportingCharacters ?? [];
  console.log(`Supporting characters in Bible: ${supporting.length}`);
  for (const sc of supporting) console.log(`  ${sc.name} (${sc.relationship ?? "?"})`);
  console.log("");

  const photoRows = await db.select({ url: photosTable.url }).from(photosTable).where(eq(photosTable.orderId, ORDER_ID));
  const customerPhotoUrl = photoRows.map((r) => r.url).filter((u): u is string => typeof u === "string" && u.length > 0)[0]!;

  const sourcePages = await db.select().from(bookPages).where(eq(bookPages.generationId, SOURCE_GEN_ID));

  let iterGenId: string;
  if (argGenId) {
    iterGenId = argGenId;
    console.log(`✓ Resuming generation ${iterGenId}\n`);
  } else {
    iterGenId = randomUUID();
    await db.insert(generations).values({
      id: iterGenId,
      orderId: ORDER_ID,
      status: "generating_illustrations",
      storyJson: sourceGen.storyJson,
      bibleJson: sourceGen.bibleJson,
      illustrationsCount: 1 + ALL_PAGES.length,
      estimatedCostCents: 0,
      startedAt: new Date(),
    });
    console.log(`✓ Created generation ${iterGenId}\n`);
  }

  // RETRY_COVER=1 forces the cover to regenerate even if it already exists.
  // Used when iterating on the cover prompt itself (e.g. cinema-poster rewrite).
  if (RETRY_COVER) {
    await db.update(generations).set({ coverUrl: null }).where(eq(generations.id, iterGenId));
    console.log(`✓ RETRY_COVER=1 — cleared coverUrl, cover will regenerate with current prompt`);
  }

  const existingGen = await db.select().from(generations).where(eq(generations.id, iterGenId)).limit(1).then((r) => r[0]);
  const existingPages = await db.select({ pageNumber: bookPages.pageNumber }).from(bookPages).where(eq(bookPages.generationId, iterGenId));
  const havePages = new Set(existingPages.map((p) => p.pageNumber));
  const haveCover = !!existingGen?.coverUrl;
  console.log(`Already done: cover=${haveCover}, pages=[${[...havePages].sort((a, b) => a - b).join(", ")}]`);
  const remaining = ALL_PAGES.filter((p) => !havePages.has(p));
  console.log(`Remaining: ${haveCover ? "" : "cover, "}pages [${remaining.join(", ")}]\n`);

  console.log(`→ Pre-fetching customer photo...`);
  const customerPhoto = await fetchAsBase64(customerPhotoUrl);

  const failures: PageFailure[] = [];

  // Cover: 2 refs only (no wardrobe anchor exists yet — the cover IS the anchor).
  // Wrapped in try/catch to capture ANY error source (fetch / Gemini / upload / DB).
  if (!haveCover) {
    console.log(`\n→ Cover (creative + 3:4 + scale-fix + multi-turn, 2 refs)...`);
    try {
      const coverIllustration = await fetchAsBase64(sourceGen.coverUrl);
      const coverOutfit = getOutfitForPage(bible, 0);
      const generated = await multiTurnRefine({
        bible,
        childName: "Hena",
        isCover: true,
        charactersOnPage: ["Hena"],
        emotionalBeat: "iconic cover composition",
        storyScene: story.coverDescription ?? "Hena on the cover",
        outfit: coverOutfit.outfit,
        outfitIsVariation: false,
        customerPhoto,
        illustration: coverIllustration,
        wardrobeAnchor: null,
      });
      const buf = Buffer.from(generated.data, "base64");
      const uploaded = await uploadWithRetry(buf, "illustration_cover_iter8", generated.mimeType, "cover");
      console.log(`  ✓ ${uploaded.url}`);
      await db.update(generations).set({ coverUrl: uploaded.url, updatedAt: new Date() }).where(eq(generations.id, iterGenId));
    } catch (err) {
      recordFailure(err, "cover", failures);
      console.log(`     ABORTING: cover is the wardrobe anchor for body pages — cannot continue without it.`);
      printFailureSummary(failures, iterGenId);
      return;
    }
  } else {
    console.log(`\n(cover already done — skipping)`);
  }

  // Fetch the iter 8 cover as the WARDROBE ANCHOR for body pages.
  const iterCoverUrl = (await db.select().from(generations).where(eq(generations.id, iterGenId)).limit(1).then((r) => r[0]))?.coverUrl;
  if (!iterCoverUrl) throw new Error("iter cover URL missing — cannot establish wardrobe anchor");
  console.log(`\n→ Pre-fetching iter cover as wardrobe anchor for body pages...`);
  const wardrobeAnchorImage = await fetchAsBase64(iterCoverUrl);

  for (const pageNum of ALL_PAGES) {
    if (pageNum > STOP_AT_PAGE) {
      console.log(`\n(STOP_AT_PAGE=${STOP_AT_PAGE} reached — halting before page ${pageNum})`);
      break;
    }
    if (havePages.has(pageNum)) {
      console.log(`(page ${pageNum} already done — skipping)`);
      continue;
    }
    const sourceBookPage = sourcePages.find((p) => p.pageNumber === pageNum);
    const storyPage = story.pages.find((p) => p.number === pageNum);
    if (!storyPage) {
      console.log(`⚠️  page ${pageNum} missing story — skipping`);
      continue;
    }

    const outfitForThisPage = getOutfitForPage(bible, pageNum);
    const useAnchor = !outfitForThisPage.isVariation;
    const styleRefUrl = sourceBookPage?.illustrationUrl ?? iterCoverUrl;
    const styleRefSrc = sourceBookPage?.illustrationUrl ? "watercolor source" : "iter cover (fallback)";

    console.log(`\n→ Page ${pageNum}/${ALL_PAGES.length} (3:4) | beat: "${storyPage.emotionalBeat}" | style-ref: ${styleRefSrc} | outfit: ${outfitForThisPage.isVariation ? "VARIATION" : "default"} | anchor: ${useAnchor ? "yes" : "no (variation page)"}`);

    // Wrapped in try/catch to capture ANY error source (fetch / Gemini / upload / DB).
    try {
      const styleIllustration = await fetchAsBase64(styleRefUrl);
      const generated = await multiTurnRefine({
        bible,
        childName: "Hena",
        isCover: false,
        charactersOnPage: storyPage.charactersOnPage,
        emotionalBeat: storyPage.emotionalBeat,
        storyScene: storyPage.scene,
        outfit: outfitForThisPage.outfit,
        outfitIsVariation: outfitForThisPage.isVariation,
        customerPhoto,
        illustration: styleIllustration,
        wardrobeAnchor: useAnchor ? wardrobeAnchorImage : null,
      });
      const buf = Buffer.from(generated.data, "base64");
      const uploaded = await uploadWithRetry(buf, `illustration_page_${pageNum}_iter8`, generated.mimeType, `page${pageNum}`);
      console.log(`  ✓ ${uploaded.url}`);
      await db.insert(bookPages).values({
        generationId: iterGenId,
        pageNumber: pageNum,
        storyText: storyPage.text,
        illustrationUrl: uploaded.url,
        illustrationPrompt: buildPrompt({
          bible,
          childName: "Hena",
          isCover: false,
          charactersOnPage: storyPage.charactersOnPage,
          emotionalBeat: storyPage.emotionalBeat,
          storyScene: storyPage.scene,
          outfit: outfitForThisPage.outfit,
          hasWardrobeAnchor: useAnchor,
          outfitIsVariation: outfitForThisPage.isVariation,
        }).slice(0, 2000),
        illustrationProvider: "gemini-3.1-iter8-anchor",
        illustrationGeneratedAt: new Date(),
      });
    } catch (err) {
      recordFailure(err, pageNum, failures);
      console.log(`     [SKIPPED] Page ${pageNum} not saved. Continuing to next page.`);
    }
  }

  const finalCount = await db.select({ pageNumber: bookPages.pageNumber }).from(bookPages).where(eq(bookPages.generationId, iterGenId));
  const allComplete = finalCount.length === ALL_PAGES.length && failures.length === 0;
  await db.update(generations).set({
    status: allComplete ? "awaiting_review" : "generating_illustrations",
    updatedAt: new Date(),
    ...(allComplete ? { completedAt: new Date() } : {}),
  }).where(eq(generations.id, iterGenId));

  if (allComplete) {
    console.log(`\n✅ FULL BOOK COMPLETE.`);
  } else {
    console.log(`\n⚠️  PARTIAL — ${finalCount.length}/${ALL_PAGES.length} pages saved, ${failures.length} alerts`);
  }
  console.log(`   Generation ID: ${iterGenId}`);
  console.log(`   Admin URL:     https://hadouta-admin.vercel.app/orders/${iterGenId}`);
  console.log(`   To resume if interrupted: pnpm tsx src/scripts/_iter8_full_book.ts ${iterGenId}`);

  printFailureSummary(failures, iterGenId);
}

main()
  .catch((err) => { console.error("FAILED:", err); process.exit(1); })
  .then(() => process.exit(0));
