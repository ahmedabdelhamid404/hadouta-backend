// Single-image probe — generates ONE illustration for an existing generation
// (cover by default, or a specific page via --page=N) and prints the URL.
// Used to validate Gemini 2.5 Flash Image output quality without burning
// the full 17-call budget. Per Ahmed's "only one image" budget guard.
//
// Usage:
//   pnpm tsx src/scripts/test-generate-illustration.ts <generationId>
//   pnpm tsx src/scripts/test-generate-illustration.ts <generationId> --page=3

import "dotenv/config";
import { eq, and, desc } from "drizzle-orm";
import { db } from "../db/index.js";
import { generations, bookPages } from "../db/schema.js";
import { generateIllustration } from "../lib/ai/illustration-generator.js";

interface CliArgs {
  generationId: string | null;
  page: number; // 0 = cover, 1..N = body page
}

function parseCliArgs(argv: string[]): CliArgs {
  const args = argv.slice(2);
  let generationId: string | null = null;
  let page = 0;
  for (const a of args) {
    if (a.startsWith("--page=")) page = parseInt(a.slice(7), 10);
    else if (!a.startsWith("--")) generationId = a;
  }
  return { generationId, page };
}

async function pickLatestGeneration(): Promise<string> {
  const rows = await db
    .select({ id: generations.id })
    .from(generations)
    .orderBy(desc(generations.createdAt))
    .limit(1);
  if (!rows[0]) throw new Error("No generations found.");
  console.log(`Picked latest generation: ${rows[0].id}`);
  return rows[0].id;
}

async function main() {
  const cli = parseCliArgs(process.argv);
  const generationId = cli.generationId ?? (await pickLatestGeneration());

  // Load generation + the page (or cover) prompt.
  const genRows = await db
    .select()
    .from(generations)
    .where(eq(generations.id, generationId))
    .limit(1);
  const gen = genRows[0];
  if (!gen) throw new Error(`Generation ${generationId} not found`);

  let prompt: string;
  if (cli.page === 0) {
    const story = gen.storyJson as { coverDescription?: string } | null;
    if (!story?.coverDescription) {
      throw new Error("Generation has no coverDescription in storyJson");
    }
    prompt = story.coverDescription;
    console.log(`Using cover prompt for generation ${generationId}`);
  } else {
    const pageRows = await db
      .select()
      .from(bookPages)
      .where(
        and(
          eq(bookPages.generationId, generationId),
          eq(bookPages.pageNumber, cli.page),
        ),
      )
      .limit(1);
    const page = pageRows[0];
    if (!page) throw new Error(`Page ${cli.page} not found`);
    prompt = page.illustrationPrompt;
    console.log(`Using page-${cli.page} prompt`);
  }

  console.log("\nPrompt:");
  console.log(`  ${prompt}\n`);

  console.log("=== Calling Gemini 2.5 Flash Image ===");
  const result = await generateIllustration({
    prompt,
    orderId: gen.orderId,
    pageNumber: cli.page,
  });

  console.log(`\n✓ Generated in ${result.durationMs}ms`);
  console.log(`  URL: ${result.url}`);
  console.log(`  Size: ${result.fileSize} bytes`);
  console.log(`  Type: ${result.contentType}`);
  console.log(`  Model: ${result.modelId}`);

  // Persist to DB so admin UI can render it later.
  if (cli.page === 0) {
    await db
      .update(generations)
      .set({ coverUrl: result.url, updatedAt: new Date() })
      .where(eq(generations.id, generationId));
    console.log("\n  → persisted to generations.cover_url");
  } else {
    await db
      .update(bookPages)
      .set({
        illustrationUrl: result.url,
        illustrationProvider: result.modelId,
        illustrationGeneratedAt: new Date(),
      })
      .where(
        and(
          eq(bookPages.generationId, generationId),
          eq(bookPages.pageNumber, cli.page),
        ),
      );
    console.log(`\n  → persisted to book_pages (page ${cli.page})`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("\n✗ Test failed:");
  console.error(err);
  process.exit(1);
});
