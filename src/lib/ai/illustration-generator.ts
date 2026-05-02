// Illustration generator — uses Google's @google/genai SDK directly to call
// gemini-2.5-flash-image (Nano Banana). Per session 9.5 lock: Ahmed has a
// Google Pro account with billing enabled, so we go direct rather than
// through fal.ai for the dev path.
//
// Returned bytes are uploaded to Cloudinary so we own the hosting (and can
// apply transformations + serve to the customer's WhatsApp message later).
//
// fal.ai + OpenAI Image fallbacks are deliberately NOT in v1 — admin can
// flip ai_settings.illustrationModel later, but the routing is dev-mode
// Google-only for now per ADR-020 cost-minimizing defaults.

import { GoogleGenAI, Modality } from "@google/genai";
import { eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { aiSettings } from "../../db/schema.js";
import { uploadImage } from "../cloudinary.js";

interface GenerateIllustrationInput {
  prompt: string;
  orderId: string;
  // 0 for cover, 1..N for body pages. Used in Cloudinary folder naming.
  pageNumber: number;
}

interface GenerateIllustrationResult {
  url: string;
  contentType: string;
  fileSize: number;
  modelId: string;
  durationMs: number;
}

let _client: GoogleGenAI | null = null;

function getGoogleClient(): GoogleGenAI {
  if (_client) return _client;
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GOOGLE_AI_API_KEY not set — cannot generate illustrations.",
    );
  }
  _client = new GoogleGenAI({ apiKey });
  return _client;
}

export async function generateIllustration(
  input: GenerateIllustrationInput,
): Promise<GenerateIllustrationResult> {
  const settings = await loadAiSettings();
  const modelId = settings.illustrationModel;

  if (!modelId.startsWith("gemini-")) {
    throw new Error(
      `illustrationModel "${modelId}" not supported by this generator (Google direct only). Set ai_settings.illustration_model to a gemini-* model.`,
    );
  }

  const client = getGoogleClient();

  const startedAt = Date.now();
  const response = await client.models.generateContent({
    model: modelId,
    contents: input.prompt,
    config: {
      responseModalities: [Modality.IMAGE],
    },
  });
  const durationMs = Date.now() - startedAt;

  const base64Data = extractInlineImageBase64(response);
  if (!base64Data) {
    throw new Error(
      `Gemini did not return image data for page ${input.pageNumber}. Response shape: ${summarizeResponse(response)}`,
    );
  }

  const buffer = Buffer.from(base64Data, "base64");
  const ownerType =
    input.pageNumber === 0
      ? "illustration_cover"
      : `illustration_page_${input.pageNumber}`;
  const upload = await uploadImage(
    buffer,
    input.orderId,
    ownerType,
    "image/png",
  );

  return {
    url: upload.url,
    contentType: upload.contentType,
    fileSize: upload.fileSize,
    modelId,
    durationMs,
  };
}

// Generate cover + all body pages with bounded concurrency. Google's free-tier
// + early-paid quota is rate-limited; running all 9 in parallel can trigger
// 429s. Concurrency 3 keeps us safely under quota without being painfully slow.
const ILLUSTRATION_CONCURRENCY = 3;

interface BatchInput {
  orderId: string;
  cover: { prompt: string };
  pages: Array<{ pageNumber: number; prompt: string }>;
}

interface BatchResult {
  cover: GenerateIllustrationResult;
  pages: Array<GenerateIllustrationResult & { pageNumber: number }>;
  totalDurationMs: number;
}

export async function generateAllIllustrations(
  input: BatchInput,
): Promise<BatchResult> {
  const startedAt = Date.now();

  // Cover first (its prompt is the most important and we want it cached/tested
  // independently if something fails downstream).
  const cover = await generateIllustration({
    prompt: input.cover.prompt,
    orderId: input.orderId,
    pageNumber: 0,
  });

  const pages = await runWithConcurrency(
    input.pages,
    ILLUSTRATION_CONCURRENCY,
    async (page) => {
      const result = await generateIllustration({
        prompt: page.prompt,
        orderId: input.orderId,
        pageNumber: page.pageNumber,
      });
      return { ...result, pageNumber: page.pageNumber };
    },
  );

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
  async function worker() {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]!);
    }
  }
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}

async function loadAiSettings() {
  const rows = await db
    .select()
    .from(aiSettings)
    .where(eq(aiSettings.id, "singleton"))
    .limit(1);
  const row = rows[0];
  if (!row) {
    throw new Error(
      "ai_settings singleton row missing. Run `pnpm db:seed:ai-settings`.",
    );
  }
  return row;
}

// Defensive extraction — Gemini responses can include text + image parts;
// we want the first inlineData (image) part regardless of position.
function extractInlineImageBase64(response: {
  candidates?: Array<{
    content?: { parts?: Array<{ inlineData?: { data?: string } }> };
  }>;
}): string | null {
  const candidate = response.candidates?.[0];
  const parts = candidate?.content?.parts ?? [];
  for (const part of parts) {
    const data = part.inlineData?.data;
    if (data) return data;
  }
  return null;
}

function summarizeResponse(response: unknown): string {
  try {
    return JSON.stringify(response).slice(0, 500);
  } catch {
    return "(unserializable)";
  }
}
