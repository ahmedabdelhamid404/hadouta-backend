// Recovery: iter 5's cover succeeded + page 1 generation succeeded but Cloudinary
// upload timed out. Find the iter5 generation row, persist the cover URL, then
// finish pages 1 and 3.

import "dotenv/config";
import { eq, desc } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  generations,
  bookPages,
  photos as photosTable,
} from "../db/schema.js";

async function main(): Promise<void> {
  // Find the most recent iter5 generation row
  const recentGens = await db
    .select()
    .from(generations)
    .where(eq(generations.orderId, "76e6226a-452e-47d6-9209-b53717d6d1cd"))
    .orderBy(desc(generations.startedAt))
    .limit(10);
  const iter5 = recentGens.find((g) =>
    g.coverUrl?.includes("kgzl4mlg3tleililkmrm")
    || (g.startedAt && g.startedAt > new Date(Date.now() - 30 * 60_000) && g.illustrationsCount === 3),
  );
  if (!iter5) {
    console.log("Most recent generations:");
    for (const g of recentGens.slice(0, 5)) {
      console.log(`  ${g.id} | status=${g.status} | cover=${g.coverUrl?.slice(-40) ?? "—"} | started=${g.startedAt?.toISOString()}`);
    }
    throw new Error("Could not find iter5 generation row");
  }
  console.log(`Found iter5 generation: ${iter5.id}`);
  console.log(`  status: ${iter5.status}`);
  console.log(`  coverUrl: ${iter5.coverUrl ?? "(missing)"}`);

  // Ensure cover URL is set
  if (!iter5.coverUrl) {
    const correctCoverUrl = "https://res.cloudinary.com/dvewybhzv/image/upload/v1778336627/hadouta/orders/76e6226a-452e-47d6-9209-b53717d6d1cd/illustration_cover_iter5/kgzl4mlg3tleililkmrm.jpg";
    console.log(`  → Persisting known cover URL: ${correctCoverUrl}`);
    await db.update(generations).set({ coverUrl: correctCoverUrl }).where(eq(generations.id, iter5.id));
  }

  console.log(`\nAdmin URL: https://hadouta-admin.vercel.app/orders/${iter5.id}`);
  console.log(`\nNext: re-render pages 1 + 3 only (cover stays).`);
  console.log(`Generation ID for re-render: ${iter5.id}`);
}

main()
  .catch((err) => {
    console.error("Failed:", err);
    process.exit(1);
  })
  .then(() => process.exit(0));
