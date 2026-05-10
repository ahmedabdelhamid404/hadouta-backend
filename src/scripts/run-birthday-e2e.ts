// Birthday end-to-end test for حنين — full 16-page production cycle.
// Uses the 3 photos already uploaded to Cloudinary from iter-8 to keep
// hair styling + identity locked across the new generation.
//
// What this does:
//   1. Creates a fresh order for حنين (girl, age 5) with theme=Birthday +
//      moral=Generosity + appearanceInputType=photo.
//   2. Inserts photo rows pointing at the 3 Cloudinary URLs already on file.
//   3. Creates a generation row with status=queued and triggers the
//      orchestrator (story → Bible → 17 illustrations → awaiting_review).
//   4. Polls until status=awaiting_review or failed, then prints the
//      admin URL for the user to review + approve.

import { db } from "../db/index.js";
import {
  orders,
  photos,
  generations,
  themes,
  moralValues,
} from "../db/schema.js";
import { eq } from "drizzle-orm";
import { runGenerationPipeline } from "../jobs/generate-book.js";

const BIRTHDAY_THEME_ID = "54562229-c560-4c8a-a0bc-659e8bd73e54";
const GENEROSITY_MORAL_ID = "686c728e-20dd-4cf1-809d-e8c51aa425ab";

const REUSE_PHOTOS = [
  "https://res.cloudinary.com/dvewybhzv/image/upload/v1777932529/hadouta/orders/36e86090-6f28-450a-8a61-812d5f610ed0/main_child/tn5kxhrdntukilb2izpe.jpg",
  "https://res.cloudinary.com/dvewybhzv/image/upload/v1777932531/hadouta/orders/36e86090-6f28-450a-8a61-812d5f610ed0/main_child/mmuwe5afjepxaztztaq3.jpg",
  "https://res.cloudinary.com/dvewybhzv/image/upload/v1777932532/hadouta/orders/36e86090-6f28-450a-8a61-812d5f610ed0/main_child/ktky210rdyd9ifh4d1mj.jpg",
];

async function main() {
  // Sanity-check the theme + moral still exist.
  const [theme] = await db.select().from(themes).where(eq(themes.id, BIRTHDAY_THEME_ID));
  const [moral] = await db
    .select()
    .from(moralValues)
    .where(eq(moralValues.id, GENEROSITY_MORAL_ID));
  if (!theme || !moral) throw new Error("theme or moral missing — re-seed");
  console.log(`Theme: ${theme.titleAr} (${theme.titleEn})`);
  console.log(`Moral: ${moral.nameAr} (${moral.nameEn})`);

  // Create the order.
  const [order] = await db
    .insert(orders)
    .values({
      themeId: BIRTHDAY_THEME_ID,
      moralValueId: GENEROSITY_MORAL_ID,
      status: "review",
      style: "watercolor",
      buyerName: "Birthday E2E",
      childName: "حنين",
      childAgeBand: "5-7",
      childAgeExact: 5,
      childGender: "girl",
      appearanceInputType: "photo",
      hasSupportingCharacters: false,
      specialOccasionText: "عيد ميلادها الخامس",
    })
    .returning();
  if (!order) throw new Error("order insert returned no row");
  console.log(`\nOrder created: ${order.id}`);

  // Insert the 3 main_child photos.
  for (const url of REUSE_PHOTOS) {
    await db.insert(photos).values({
      orderId: order.id,
      ownerType: "main_child",
      url,
      contentType: "image/jpeg",
      fileSize: 0, // unknown — fileSize is informational, not used in pipeline
    });
  }
  console.log(`Photos: ${REUSE_PHOTOS.length} main_child rows inserted`);

  // Create the generation row.
  const [gen] = await db
    .insert(generations)
    .values({
      orderId: order.id,
      status: "queued",
    })
    .returning();
  if (!gen) throw new Error("generation insert returned no row");
  console.log(`Generation created: ${gen.id}\n`);

  // Trigger the orchestrator. In-process fire-and-forget like the
  // payment webhook does in production.
  console.log("Triggering pipeline (story → Bible → 17 illustrations → PDF)...");
  console.log("Expected duration: ~3 minutes.\n");

  await runGenerationPipeline(gen.id, order.id);

  // Re-fetch final status.
  const [final] = await db.select().from(generations).where(eq(generations.id, gen.id));
  console.log(`\nFinal status: ${final?.status}`);
  console.log(`Cost: ~$${((final?.estimatedCostCents ?? 0) / 100).toFixed(2)}`);
  if (final?.coverUrl) console.log(`Cover: ${final.coverUrl}`);
  if (final?.pdfUrl) console.log(`PDF: ${final.pdfUrl}`);

  console.log(`\nReview in admin: https://hadouta-admin.vercel.app/orders/${order.id}`);
  console.log(
    `(Or filter the queue: https://hadouta-admin.vercel.app/ — generation ${gen.id})`,
  );

  process.exit(0);
}

main().catch((err) => {
  console.error("Birthday e2e FAILED:", err);
  process.exit(1);
});
