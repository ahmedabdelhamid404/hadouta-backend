// Server-side PDF assembly via Puppeteer + HTML template.
// Per session 9.8: one canonical PDF per generation, stored in Cloudinary
// as a raw resource so customer downloads are fast and identical across devices.
//
// Why Puppeteer (not pdf-lib): Arabic text in PDF requires bidi reordering
// + letter shaping + RTL layout. Chromium handles all three natively when
// rendering HTML; pdf-lib does not (it would render disconnected letters
// in left-to-right order, looking broken).

import puppeteer from "puppeteer";
import { v2 as cloudinary } from "cloudinary";
import { eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { generations, bookPages, orders } from "../../db/schema.js";
import type { StoryOutput } from "../ai/schemas/story.js";

interface AssembleOptions {
  generationId: string;
}

interface AssembleResult {
  pdfUrl: string;
  pageCount: number;
  bytes: number;
  durationMs: number;
}

export async function assembleBookPdf(
  opts: AssembleOptions,
): Promise<AssembleResult> {
  const startedAt = Date.now();

  const genRows = await db
    .select()
    .from(generations)
    .where(eq(generations.id, opts.generationId))
    .limit(1);
  const generation = genRows[0];
  if (!generation) {
    throw new Error(`Generation ${opts.generationId} not found`);
  }

  const story = generation.storyJson as StoryOutput | null;
  if (!story) {
    throw new Error(`Generation ${opts.generationId} has no storyJson`);
  }

  const pages = await db
    .select()
    .from(bookPages)
    .where(eq(bookPages.generationId, opts.generationId))
    .orderBy(bookPages.pageNumber);

  if (pages.length === 0) {
    throw new Error(
      `Generation ${opts.generationId} has no book_pages rows`,
    );
  }
  const missingIllustrations = pages.filter((p) => !p.illustrationUrl);
  if (missingIllustrations.length > 0) {
    throw new Error(
      `Cannot assemble PDF: ${missingIllustrations.length} pages missing illustrations`,
    );
  }

  const orderRows = await db
    .select({ id: orders.id, childName: orders.childName })
    .from(orders)
    .where(eq(orders.id, generation.orderId))
    .limit(1);
  const order = orderRows[0];
  if (!order) throw new Error(`Order ${generation.orderId} not found`);

  const html = buildHtml({
    title: story.title,
    dedication: story.dedication,
    // Backward-compat: generations created before moralStatement existed
    // fall back to a generic closing line so the end-page still renders.
    moralStatement:
      (story as StoryOutput & { moralStatement?: string }).moralStatement ??
      "حدوتة من القلب لقلبك",
    coverUrl: generation.coverUrl ?? null,
    pages: pages.map((p) => {
      const meta = story.pages.find((sp) => sp.number === p.pageNumber);
      return {
        pageNumber: p.pageNumber,
        storyText: p.storyText,
        illustrationUrl: p.illustrationUrl ?? "",
        moralMoment: meta?.moralMoment ?? false,
      };
    }),
  });

  // Launch headless Chromium. PUPPETEER_EXECUTABLE_PATH lets prod (Railway)
  // override with a system Chromium install if the bundled one is too big.
  const browser = await puppeteer.launch({
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
    headless: true,
  });

  let pdfBuffer: Uint8Array;
  try {
    const page = await browser.newPage();
    // 'networkidle0' waits for fonts + Cloudinary images to load before rendering.
    await page.setContent(html, { waitUntil: "networkidle0", timeout: 60_000 });
    pdfBuffer = await page.pdf({
      format: "A5",
      printBackground: true,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
    });
  } finally {
    await browser.close();
  }

  const buffer = Buffer.from(pdfBuffer);

  // Upload to Cloudinary as a raw asset (PDFs are 'raw' resource_type, not 'image').
  const uploadResult = await new Promise<{ secure_url: string; bytes: number }>(
    (resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: `hadouta/orders/${generation.orderId}/books`,
          resource_type: "raw",
          public_id: `book-${opts.generationId}.pdf`,
          overwrite: true,
        },
        (error, uploaded) => {
          if (error || !uploaded) {
            reject(error ?? new Error("Cloudinary PDF upload returned no result"));
            return;
          }
          resolve({ secure_url: uploaded.secure_url, bytes: uploaded.bytes });
        },
      );
      stream.end(buffer);
    },
  );

  await db
    .update(generations)
    .set({
      pdfUrl: uploadResult.secure_url,
      status: "delivered",
      deliveredAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(generations.id, opts.generationId));

  await db
    .update(orders)
    .set({ status: "delivered", deliveredAt: new Date(), updatedAt: new Date() })
    .where(eq(orders.id, generation.orderId));

  return {
    pdfUrl: uploadResult.secure_url,
    pageCount: pages.length + 1, // +1 for cover
    bytes: uploadResult.bytes,
    durationMs: Date.now() - startedAt,
  };
}

export interface HtmlInput {
  title: string;
  dedication: string;
  /** Distilled single-sentence moral takeaway. Rendered on end-page above "النهاية". */
  moralStatement: string;
  coverUrl: string | null;
  pages: Array<{
    pageNumber: number;
    storyText: string;
    illustrationUrl: string;
    /** True on the single page where the moral is most clearly demonstrated. Drives optional moral-moment label. */
    moralMoment: boolean;
  }>;
}

export function buildHtml(input: HtmlInput): string {
  const coverHtml = renderCoverPage({
    title: input.title,
    dedication: input.dedication,
    coverUrl: input.coverUrl,
  });

  const bodyHtml = input.pages
    .map((p) =>
      renderBodyPage({
        pageNumber: p.pageNumber,
        storyText: p.storyText,
        illustrationUrl: p.illustrationUrl,
        moralMoment: p.moralMoment,
      }),
    )
    .join("\n");

  const lastBodyPage = input.pages[input.pages.length - 1];
  const endHtml = renderEndPage({
    moralStatement: input.moralStatement,
    backdropUrl: lastBodyPage?.illustrationUrl ?? input.coverUrl ?? "",
  });

  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8" />
<title>${escapeText(input.title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Aref+Ruqaa:wght@400;700&family=El+Messiri:wght@400;500;600;700&family=Cairo:wght@400;500;600;700&display=swap" rel="stylesheet" />
<style>${SHARED_CSS}</style>
</head>
<body>
${coverHtml}
${bodyHtml}
${endHtml}
</body>
</html>`;
}

// Stub helpers — implemented in subsequent commits (Tasks 5–7).
function renderCoverPage(_args: {
  title: string;
  dedication: string;
  coverUrl: string | null;
}): string {
  return "";
}

function renderBodyPage(_args: {
  pageNumber: number;
  storyText: string;
  illustrationUrl: string;
  moralMoment: boolean;
}): string {
  return "";
}

function renderEndPage(_args: { moralStatement: string; backdropUrl: string }): string {
  return "";
}

const SHARED_CSS = `
  /* Reset */
  * { box-sizing: border-box; margin: 0; padding: 0; }

  /* Page-level: A5 */
  body { font-family: 'Cairo', 'Tajawal', sans-serif; color: #2d2421; }
  .page {
    page-break-after: always;
    width: 148mm; height: 210mm;
    position: relative;
    overflow: hidden;
    background:
      /* paper grain */
      repeating-linear-gradient(92deg, rgba(139,106,74,0.012) 0, rgba(139,106,74,0.012) 1px, transparent 1px, transparent 3px),
      repeating-linear-gradient(2deg,  rgba(139,106,74,0.018) 0, rgba(139,106,74,0.018) 1px, transparent 1px, transparent 4px),
      /* warm cream radial */
      radial-gradient(ellipse at 50% 50%, #fffbf3 0%, #fbf4e6 90%);
  }
  .page:last-child { page-break-after: auto; }
`;

function escapeText(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttr(s: string): string {
  return escapeText(s).replace(/"/g, "&quot;");
}
