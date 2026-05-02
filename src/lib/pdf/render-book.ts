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
    parentDiscussionQuestion: story.parentDiscussionQuestion,
    coverUrl: generation.coverUrl ?? null,
    pages: pages.map((p) => ({
      pageNumber: p.pageNumber,
      storyText: p.storyText,
      illustrationUrl: p.illustrationUrl ?? "",
    })),
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

interface HtmlInput {
  title: string;
  dedication: string;
  parentDiscussionQuestion: string;
  coverUrl: string | null;
  pages: Array<{ pageNumber: number; storyText: string; illustrationUrl: string }>;
}

function buildHtml(input: HtmlInput): string {
  const pageHtml = input.pages
    .map(
      (p) => `
      <section class="page body-page">
        <div class="illustration">
          <img src="${escapeAttr(p.illustrationUrl)}" alt="" />
        </div>
        <div class="text">
          <p>${escapeText(p.storyText)}</p>
        </div>
        <div class="page-number">${p.pageNumber}</div>
      </section>
    `,
    )
    .join("\n");

  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8" />
<title>${escapeText(input.title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;800&family=Lalezar&display=swap" rel="stylesheet" />
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Cairo', sans-serif; color: #2d2421; background: #fffaf3; }
  .page {
    page-break-after: always;
    width: 148mm; height: 210mm;
    padding: 12mm;
    display: flex; flex-direction: column;
    position: relative;
    background: #fffaf3;
  }
  .page:last-child { page-break-after: auto; }
  .cover {
    background: linear-gradient(135deg, #f5e8d4 0%, #e8c9a0 100%);
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: 18mm;
  }
  .cover .cover-image {
    width: 100%; max-height: 110mm; object-fit: contain;
    border-radius: 8px;
    margin-bottom: 12mm;
  }
  .cover h1 {
    font-family: 'Lalezar', 'Cairo', sans-serif;
    font-size: 32pt;
    font-weight: 800;
    color: #c66a3d;
    line-height: 1.2;
    margin-bottom: 8mm;
  }
  .cover .dedication {
    font-size: 12pt;
    color: #5b4a3e;
    font-style: italic;
    line-height: 1.6;
    max-width: 110mm;
  }
  .body-page .illustration {
    width: 100%; height: 60%;
    display: flex; align-items: center; justify-content: center;
  }
  .body-page .illustration img {
    width: 100%; height: 100%; object-fit: contain;
    border-radius: 4px;
  }
  .body-page .text {
    flex: 1;
    display: flex; align-items: center; justify-content: center;
    padding: 6mm 4mm 0 4mm;
    text-align: center;
  }
  .body-page .text p {
    font-size: 14pt;
    line-height: 2;
    color: #2d2421;
  }
  .page-number {
    position: absolute;
    bottom: 8mm; left: 50%; transform: translateX(-50%);
    font-size: 10pt;
    color: #b59478;
    font-weight: 600;
  }
  .end-page {
    align-items: center;
    justify-content: center;
    text-align: center;
    background: #f9efde;
    padding: 18mm;
  }
  .end-page h2 {
    font-family: 'Lalezar', 'Cairo', sans-serif;
    font-size: 22pt;
    color: #c66a3d;
    margin-bottom: 8mm;
  }
  .end-page p { font-size: 14pt; line-height: 1.8; color: #5b4a3e; }
  .end-page .brand {
    margin-top: 12mm;
    font-size: 10pt; color: #b59478;
    letter-spacing: 0.1em;
  }
</style>
</head>
<body>
  <section class="page cover">
    ${input.coverUrl ? `<img class="cover-image" src="${escapeAttr(input.coverUrl)}" alt="" />` : ""}
    <h1>${escapeText(input.title)}</h1>
    <div class="dedication">${escapeText(input.dedication)}</div>
  </section>

  ${pageHtml}

  <section class="page end-page">
    <h2>سؤال للحدوتة بعد القراية</h2>
    <p>${escapeText(input.parentDiscussionQuestion)}</p>
    <div class="brand">حدوتة · HADOUTA</div>
  </section>
</body>
</html>`;
}

function escapeText(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttr(s: string): string {
  return escapeText(s).replace(/"/g, "&quot;");
}
