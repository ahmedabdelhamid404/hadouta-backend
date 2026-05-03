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

function renderCoverPage(args: {
  title: string;
  dedication: string;
  coverUrl: string | null;
}): string {
  const imgTag = args.coverUrl
    ? `<img src="${escapeAttr(args.coverUrl)}" alt="" />`
    : "";
  return `
    <section class="page cover-page">
      <div class="cover-illus">${imgTag}</div>
      <div class="cover-caption">
        <div class="ornament-row">
          <span class="line"></span><span class="ornament">✦</span><span class="line"></span>
        </div>
        <h1 class="cover-title">${escapeText(args.title)}</h1>
        <div class="cover-dedication">${escapeText(args.dedication)}</div>
      </div>
      <div class="brand-mark">حدوتة</div>
    </section>
  `;
}

const EASTERN_DIGITS = ["٠", "١", "٢", "٣", "٤", "٥", "٦", "٧", "٨", "٩"];

function toEasternArabic(n: number): string {
  return String(n)
    .split("")
    .map((d) => EASTERN_DIGITS[Number(d)] ?? d)
    .join("");
}

function renderBodyPage(args: {
  pageNumber: number;
  storyText: string;
  illustrationUrl: string;
  moralMoment: boolean;
}): string {
  const moralLabel = args.moralMoment
    ? `<div class="moral-label">★ لحظة الحكاية</div>`
    : "";
  return `
    <section class="page body-page">
      <span class="corner-flourish corner-tl">✦</span>
      <span class="corner-flourish corner-tr">✦</span>
      <span class="corner-flourish corner-bl">✦</span>
      <span class="corner-flourish corner-br">✦</span>

      <div class="body-illus">
        <img src="${escapeAttr(args.illustrationUrl)}" alt="" />
      </div>

      <div class="body-divider">
        <span class="line"></span><span class="ornament">✦</span><span class="line"></span>
      </div>

      ${moralLabel}

      <div class="body-text-wrap">
        <p class="body-text">${escapeText(args.storyText)}</p>
      </div>

      <div class="page-number">
        <span class="ornament">✦</span>
        <span class="label">صفحة</span>
        <span class="num">${toEasternArabic(args.pageNumber)}</span>
        <span class="ornament">✦</span>
      </div>

      <div class="brand-tick">حدوتة</div>
    </section>
  `;
}

function renderEndPage(args: { moralStatement: string; backdropUrl: string }): string {
  const imgTag = args.backdropUrl
    ? `<img src="${escapeAttr(args.backdropUrl)}" alt="" />`
    : "";
  return `
    <section class="page end-page">
      <div class="end-illus">${imgTag}</div>
      <div class="end-caption">
        <div class="end-moral">${escapeText(args.moralStatement)}</div>
        <div class="nihaya">النهاية</div>
      </div>
      <div class="brand-mark">حدوتة</div>
    </section>
  `;
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

  /* === Cover page === */
  .cover-page { padding: 0; }
  .cover-illus {
    position: absolute;
    top: 0; left: 0; right: 0;
    height: 75%;
    overflow: hidden;
    z-index: 1;
  }
  .cover-illus img {
    width: 100%; height: 100%; object-fit: cover; display: block;
  }
  /* Watercolor fade at bottom of cover image */
  .cover-illus::after {
    content: "";
    position: absolute;
    left: 0; right: 0; bottom: 0;
    height: 32px;
    background: linear-gradient(180deg,
      transparent 0%,
      rgba(255,251,243,0.50) 60%,
      rgba(255,251,243,0.88) 92%,
      #fffbf3 100%);
    pointer-events: none;
  }
  /* Painterly vignette */
  .cover-illus::before {
    content: "";
    position: absolute; inset: 0;
    background: radial-gradient(ellipse at center, transparent 65%, rgba(0,0,0,0.12) 100%);
    pointer-events: none;
    z-index: 2;
  }

  /* Caption block — anchored to bottom of cream zone */
  .cover-caption {
    position: absolute;
    top: 75%; left: 0; right: 0; bottom: 0;
    z-index: 2;
    padding: 0 12mm 12mm;
    display: flex; flex-direction: column;
    justify-content: flex-end; align-items: center;
    text-align: center;
  }
  /* Watercolor washes inside cream zone */
  .cover-caption::before {
    content: "";
    position: absolute;
    top: -4px; left: -16mm;
    width: 55%; height: 90%;
    background:
      radial-gradient(circle at 60% 50%, rgba(86,124,122,0.10) 0%, transparent 65%),
      radial-gradient(circle at 50% 70%, rgba(232,201,160,0.30) 0%, transparent 70%);
    filter: blur(2px);
    pointer-events: none;
    z-index: 1;
  }
  .cover-caption::after {
    content: "";
    position: absolute;
    top: -4px; right: -20mm;
    width: 50%; height: 85%;
    background:
      radial-gradient(circle at 30% 40%, rgba(198,106,61,0.10) 0%, transparent 65%),
      radial-gradient(circle at 50% 70%, rgba(232,201,160,0.20) 0%, transparent 70%);
    filter: blur(2px);
    pointer-events: none;
    z-index: 1;
  }

  /* Ornament row (line ✦ line) */
  .ornament-row {
    display: flex; align-items: center; justify-content: center;
    gap: 10px;
    margin-bottom: 10px;
    color: rgba(198,106,61,0.55);
    z-index: 2; position: relative;
  }
  .ornament-row .line {
    width: 32px; height: 1px;
    background: linear-gradient(90deg, transparent 0%, rgba(198,106,61,0.5) 50%, transparent 100%);
  }
  .ornament-row .ornament {
    color: #c66a3d; font-size: 12px; line-height: 1;
  }

  .cover-title {
    font-family: 'El Messiri', 'Cairo', serif;
    font-size: 28pt;
    font-weight: 700;
    color: #c66a3d;
    margin: 0;
    line-height: 1.2;
    letter-spacing: 0.01em;
    z-index: 2; position: relative;
  }
  .cover-dedication {
    font-family: 'Cairo', 'Tajawal', sans-serif;
    font-size: 12pt;
    color: #8b6a4a;
    font-style: italic;
    line-height: 1.6;
    margin-top: 10px;
    max-width: 110mm;
    z-index: 2; position: relative;
  }

  /* === Body page (framed island) === */
  .body-page {
    padding: 11mm 11mm 10mm;
    display: flex; flex-direction: column;
  }
  /* Inner border at 6mm inset */
  .body-page::before {
    content: "";
    position: absolute;
    inset: 6mm;
    border: 0.4pt solid rgba(198,106,61,0.18);
    pointer-events: none;
  }
  /* Corner flourishes outside the inner border */
  .corner-flourish {
    position: absolute;
    color: rgba(198,106,61,0.4);
    font-size: 12pt;
    line-height: 1;
    z-index: 3;
  }
  .corner-tl { top: 4mm; right: 4mm; }
  .corner-tr { top: 4mm; left: 4mm; }
  .corner-bl { bottom: 20mm; right: 4mm; }
  .corner-br { bottom: 20mm; left: 4mm; }

  .body-illus {
    width: 100%;
    aspect-ratio: 4 / 3.4;
    border-radius: 4px;
    overflow: hidden;
    margin-top: 1mm;
    box-shadow: 0 2px 6px rgba(80,60,40,0.08), 0 6px 18px rgba(80,60,40,0.10);
    z-index: 2;
    position: relative;
  }
  .body-illus img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .body-illus::after {
    content: "";
    position: absolute; inset: 0;
    box-shadow: inset 0 0 18px rgba(80,60,40,0.10);
    pointer-events: none;
  }

  /* Ornamental divider between image and text */
  .body-divider {
    margin: 7mm auto 6mm;
    display: flex; align-items: center; justify-content: center;
    gap: 4mm; width: 60%;
    color: rgba(198,106,61,0.55);
    z-index: 2; position: relative;
  }
  .body-divider .line {
    flex: 1; height: 1px;
    background: linear-gradient(90deg, transparent 0%, rgba(198,106,61,0.35) 50%, transparent 100%);
  }
  .body-divider .ornament { color: #c66a3d; font-size: 10pt; }

  /* Moral-moment label (only on moralMoment pages) */
  .moral-label {
    text-align: center;
    font-family: 'El Messiri', serif;
    font-size: 8pt;
    color: #c66a3d;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    font-weight: 600;
    margin-bottom: 4mm;
    z-index: 2; position: relative;
  }

  /* Story text block */
  .body-text-wrap {
    flex: 1;
    display: flex; align-items: center; justify-content: center;
    padding: 0 3mm;
    z-index: 2; position: relative;
  }
  .body-text {
    font-family: 'Cairo', 'Tajawal', sans-serif;
    font-size: 13pt;
    line-height: 2.0;
    color: #2d2421;
    margin: 0;
    text-align: center;
    font-weight: 500;
    letter-spacing: 0.01em;
  }

  /* Page number — symmetric ✦ صفحة ١٤ ✦ */
  .page-number {
    text-align: center;
    margin-top: 5mm;
    color: #c66a3d;
    font-family: 'El Messiri', serif;
    font-weight: 600;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 3mm;
    z-index: 2; position: relative;
  }
  .page-number .ornament { color: rgba(198,106,61,0.45); font-size: 9pt; }
  .page-number .label { font-size: 11pt; }
  .page-number .num { font-size: 12pt; }

  /* Brand tick on body pages — slightly muted vs cover/end brand-mark */
  .body-page .brand-tick {
    position: absolute;
    bottom: 2.5mm; left: 0; right: 0;
    text-align: center;
    color: rgba(181,148,120,0.55);
    font-family: 'Cairo', sans-serif;
    font-size: 8pt;
    letter-spacing: 0.25em;
    font-weight: 600;
    z-index: 3;
  }

  /* Brand wordmark — bottom of cover/end pages */
  .brand-mark {
    position: absolute;
    bottom: 4mm; left: 0; right: 0;
    text-align: center;
    color: rgba(181,148,120,0.7);
    font-family: 'Cairo', sans-serif;
    font-size: 9pt;
    letter-spacing: 0.35em;
    font-weight: 600;
    z-index: 3;
  }

  /* === End page (mirrors cover) === */
  .end-page { padding: 0; }
  .end-illus {
    position: absolute;
    top: 0; left: 0; right: 0;
    height: 70%;
    overflow: hidden;
    z-index: 1;
  }
  .end-illus img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .end-illus::after {
    content: "";
    position: absolute;
    left: 0; right: 0; bottom: 0;
    height: 32px;
    background: linear-gradient(180deg,
      transparent 0%,
      rgba(255,251,243,0.50) 60%,
      rgba(255,251,243,0.88) 92%,
      #fffbf3 100%);
    pointer-events: none;
  }
  .end-illus::before {
    content: "";
    position: absolute; inset: 0;
    background: radial-gradient(ellipse at center, transparent 65%, rgba(0,0,0,0.12) 100%);
    pointer-events: none;
    z-index: 2;
  }

  .end-caption {
    position: absolute;
    top: 70%; left: 0; right: 0; bottom: 0;
    z-index: 2;
    padding: 6mm 11mm 12mm;
    display: flex; flex-direction: column;
    justify-content: flex-end; align-items: center;
    text-align: center;
  }
  /* Same watercolor washes as cover */
  .end-caption::before {
    content: "";
    position: absolute;
    top: -4px; left: -16mm;
    width: 55%; height: 95%;
    background:
      radial-gradient(circle at 60% 50%, rgba(86,124,122,0.10) 0%, transparent 65%),
      radial-gradient(circle at 50% 70%, rgba(232,201,160,0.30) 0%, transparent 70%);
    filter: blur(2px);
    pointer-events: none;
    z-index: 1;
  }
  .end-caption::after {
    content: "";
    position: absolute;
    top: -4px; right: -20mm;
    width: 50%; height: 90%;
    background:
      radial-gradient(circle at 30% 40%, rgba(198,106,61,0.10) 0%, transparent 65%),
      radial-gradient(circle at 50% 70%, rgba(232,201,160,0.20) 0%, transparent 70%);
    filter: blur(2px);
    pointer-events: none;
    z-index: 1;
  }

  /* Moral statement (Cairo, with hairline rule above) */
  .end-moral {
    font-family: 'Cairo', 'Tajawal', sans-serif;
    font-size: 12pt;
    line-height: 1.85;
    color: #2d2421;
    font-weight: 500;
    margin-bottom: 6mm;
    max-width: 110mm;
    text-align: center;
    z-index: 2; position: relative;
  }
  .end-moral::before {
    content: "";
    display: block;
    width: 12mm;
    height: 1px;
    background: rgba(198,106,61,0.4);
    margin: 0 auto 4mm;
  }

  /* "النهاية" stamp in Aref Ruqaa */
  .nihaya {
    font-family: 'Aref Ruqaa', 'El Messiri', 'Cairo', serif;
    font-size: 30pt;
    font-weight: 700;
    color: #c66a3d;
    line-height: 1.0;
    padding: 1mm 0 0.5mm;
    z-index: 2; position: relative;
  }
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
