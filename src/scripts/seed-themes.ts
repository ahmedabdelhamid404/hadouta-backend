// Seed 8 themes per Phase 3 design spec — religion-neutral pan-Egyptian.
// Each theme tagged with overlapping age bands per Phase 3 Decision 3.
// Schema uses both legacy (slug, titleAr, titleEn) and new (descriptionAr,
// descriptionEn, suitableAgeBands, illustrationKey, active) columns.

import "dotenv/config";
import { db } from "../db";
import { themes } from "../db/schema";

const THEMES = [
  {
    slug: "first-day-of-school",
    titleAr: "أول يوم في المدرسة",
    titleEn: "First Day at School",
    descriptionAr: "الطفل يواجه مغامرة بداية المدرسة لأول مرة",
    descriptionEn: "The child faces the adventure of starting school for the first time",
    suitableAgeBands: ["5-7", "6-8"],
    illustrationKey: "school",
    status: "active",
  },
  {
    slug: "friendship",
    titleAr: "الصداقة",
    titleEn: "Friendship",
    descriptionAr: "بناء صداقات حقيقية والاهتمام بالآخرين",
    descriptionEn: "Building meaningful friendships and caring for others",
    suitableAgeBands: ["3-5", "5-7", "6-8"],
    illustrationKey: "friendship",
    status: "active",
  },
  {
    slug: "eid",
    titleAr: "العيد",
    titleEn: "Eid Celebration",
    descriptionAr: "احتفال العيد مع العائلة، الهدايا، والفرح",
    descriptionEn: "Celebrating Eid with family, gifts, and joy",
    suitableAgeBands: ["3-5", "5-7", "6-8"],
    illustrationKey: "eid",
    status: "active",
  },
  {
    slug: "ramadan",
    titleAr: "رمضان",
    titleEn: "Ramadan",
    descriptionAr: "تجربة جمال وروحانية رمضان",
    descriptionEn: "Experiencing the beauty and spirituality of Ramadan",
    suitableAgeBands: ["5-7", "6-8"],
    illustrationKey: "ramadan",
    status: "active",
  },
  {
    slug: "christmas",
    titleAr: "الكريسماس",
    titleEn: "Christmas",
    descriptionAr: "احتفال الكريسماس بطريقة مصرية أصيلة",
    descriptionEn: "Celebrating Christmas in an authentically Egyptian way",
    suitableAgeBands: ["3-5", "5-7", "6-8"],
    illustrationKey: "christmas",
    status: "active",
  },
  {
    slug: "sham-el-nessim",
    titleAr: "شم النسيم",
    titleEn: "Sham El-Nessim",
    descriptionAr: "احتفال شم النسيم — ربيع مصر",
    descriptionEn: "Celebrating Sham El-Nessim — the Egyptian spring",
    suitableAgeBands: ["5-7", "6-8"],
    illustrationKey: "shamel",
    status: "active",
  },
  {
    slug: "birthday",
    titleAr: "عيد ميلاد",
    titleEn: "Birthday",
    descriptionAr: "يوم خاص لطفلك",
    descriptionEn: "A special day for your child",
    suitableAgeBands: ["3-5", "5-7", "6-8"],
    illustrationKey: "birthday",
    status: "active",
  },
  {
    slug: "big-adventure",
    titleAr: "مغامرة كبيرة",
    titleEn: "The Big Adventure",
    descriptionAr: "مغامرة مثيرة تعلم الشجاعة والمثابرة",
    descriptionEn: "An exciting quest that teaches courage and perseverance",
    suitableAgeBands: ["5-7", "6-8"],
    illustrationKey: "adventure",
    status: "active",
  },
];

async function seed() {
  for (const theme of THEMES) {
    await db
      .insert(themes)
      .values({
        ...theme,
        supportedStyles: ["watercolor"],
        active: true,
      })
      .onConflictDoNothing();
  }
  console.log(`Seeded ${THEMES.length} themes`);
  process.exit(0);
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
