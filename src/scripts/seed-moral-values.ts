// Seed 8 moral values per Phase 3 design spec Decision 2.
// Idempotent — uses ON CONFLICT DO NOTHING via Drizzle's onConflictDoNothing().

import "dotenv/config";
import { db } from "../db";
import { moralValues } from "../db/schema";

const VALUES = [
  {
    nameAr: "الشجاعة",
    nameEn: "Courage",
    description: "Standing up for what is right despite fear",
    sortOrder: 1,
  },
  {
    nameAr: "الأمانة",
    nameEn: "Honesty",
    description: "Telling the truth even when it's hard",
    sortOrder: 2,
  },
  {
    nameAr: "الكرم",
    nameEn: "Generosity",
    description: "Sharing freely with others",
    sortOrder: 3,
  },
  {
    nameAr: "احترام الكبار",
    nameEn: "Respect for Elders",
    description: "Honoring grandparents, teachers, and family",
    sortOrder: 4,
  },
  {
    nameAr: "المثابرة",
    nameEn: "Perseverance",
    description: "Trying again after setbacks",
    sortOrder: 5,
  },
  {
    nameAr: "اللطف",
    nameEn: "Kindness",
    description: "Being gentle and caring with others",
    sortOrder: 6,
  },
  {
    nameAr: "التعاون",
    nameEn: "Cooperation",
    description: "Working together toward a shared goal",
    sortOrder: 7,
  },
  {
    nameAr: "الصبر",
    nameEn: "Patience",
    description: "Waiting calmly without frustration",
    sortOrder: 8,
  },
];

async function seed() {
  for (const value of VALUES) {
    await db
      .insert(moralValues)
      .values({
        ...value,
        suitableAgeBands: ["3-5", "5-7", "6-8"],
      })
      .onConflictDoNothing();
  }
  console.log(`Seeded ${VALUES.length} moral values`);
  process.exit(0);
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
