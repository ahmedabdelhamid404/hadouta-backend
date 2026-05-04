// Static curated Egyptian cultural glossary. Each entry has:
//   - ar: Arabic term
//   - latin: Latin transliteration (lookup key)
//   - description: full English description for the illustration prompt
//   - notExamples: explicit negative examples (what it is NOT) — Flux honors negatives strongly
//   - triggerKeywords: keywords that trigger inclusion when found in story/wizard inputs
//
// The Bible generator scans storyJson + wizard inputs for trigger keywords
// and includes matching entries in bibleJson.culturalNotes so per-page
// illustration prompts reference them concretely.
//
// This file is the cultural-specificity moat (per ADR-002) made concrete.
//
// Per docs/design/specs/2026-05-03-illustration-pipeline-redesign-spec.md §5.3.

export interface GlossaryEntry {
  ar: string;
  latin: string;
  description: string;
  notExamples: string[];
  triggerKeywords: string[];
}

export const CULTURAL_GLOSSARY: readonly GlossaryEntry[] = [
  {
    ar: "كحك",
    latin: "kahk",
    description:
      "Round Egyptian Eid biscuits dusted with powdered sugar; pale yellow color; sometimes filled with dates or nuts; served on round metal trays at family gatherings during Eid el-Fitr",
    notExamples: ["NOT chocolate chip cookies", "NOT macarons", "NOT Western shortbread"],
    triggerKeywords: ["eid", "kahk", "biscuit", "celebration food"],
  },
  {
    ar: "مكرونة بشاميل",
    latin: "makarona bashamel",
    description:
      "Egyptian baked layered pasta with white béchamel sauce; looks like lasagna's Egyptian cousin; served from a square casserole dish; pale beige top with golden-brown crust; hot family dinner staple",
    notExamples: [
      "NOT spaghetti with meatballs",
      "NOT carbonara",
      "NOT plain pasta",
      "NOT Italian-style red-sauce lasagna",
    ],
    triggerKeywords: ["pasta", "makarona", "family dinner", "casserole"],
  },
  {
    ar: "كشري",
    latin: "koshari",
    description:
      "Egyptian street food: stacked layers of rice + brown lentils + small pasta + chickpeas, topped with crispy fried onions and red tomato-vinegar sauce, served in a takeaway bowl or street-stall plate",
    notExamples: ["NOT plain rice", "NOT biryani", "NOT Indian dal"],
    triggerKeywords: ["street food", "koshari", "lunch"],
  },
  {
    ar: "فطير",
    latin: "fateer",
    description:
      "Egyptian layered flaky pastry; can be sweet (with honey, powdered sugar) or savory (with cheese, ground meat); served sliced into wedges from a round pan; thin gold-brown layered look",
    notExamples: ["NOT pizza", "NOT croissant", "NOT pancake"],
    triggerKeywords: ["fateer", "pastry", "bakery"],
  },
  {
    ar: "ملوخية",
    latin: "molokhia",
    description:
      "Egyptian green soup made from finely chopped jute leaves cooked in chicken or rabbit broth; deep emerald green; served in a deep bowl with rice and torn flat bread on the side",
    notExamples: ["NOT spinach soup", "NOT pesto sauce"],
    triggerKeywords: ["molokhia", "soup", "green dish"],
  },
  {
    ar: "فول",
    latin: "ful",
    description:
      "Egyptian fava beans dish; mashed brown beans with olive oil, lemon, and cumin; served in a small ceramic bowl with flat bread; typical breakfast staple",
    notExamples: ["NOT hummus", "NOT refried beans", "NOT bean salad"],
    triggerKeywords: ["breakfast", "ful", "fava beans"],
  },
  {
    ar: "عيش بلدي",
    latin: "aish baladi",
    description:
      "Egyptian flat round bread with hollow pocket; warm beige color with dusting of flour; sold from street stalls in stacks; ~15cm diameter",
    notExamples: [
      "NOT pita exactly (Egyptian version is darker, denser)",
      "NOT naan",
      "NOT tortilla",
    ],
    triggerKeywords: ["bread", "aish", "baladi"],
  },
  {
    ar: "شاي",
    latin: "shay",
    description:
      "Egyptian tea brewed dark and strong in a small clear glass (NOT a teacup with handle); often served on a small tray; sometimes with fresh mint sprigs",
    notExamples: ["NOT English teacup with handle", "NOT bubble tea", "NOT iced tea"],
    triggerKeywords: ["tea", "shay", "drink", "morning"],
  },
  {
    ar: "جلابية",
    latin: "galabeya",
    description:
      "Egyptian long traditional gown reaching the ankles; loose-fitting; typically worn by adult men or older women; cotton or linen; muted colors (cream, navy, brown, gray)",
    notExamples: ["NOT Saudi thobe (different cut)", "NOT abaya"],
    triggerKeywords: ["traditional clothing", "galabeya", "grandfather", "village"],
  },
  {
    ar: "جامع",
    latin: "gama",
    description:
      "Local Egyptian neighborhood mosque; sand-colored stone; one or two slender minarets; modest size; warm colored at sunset; often visible at end of a Cairo street",
    notExamples: [
      "NOT massive Saudi-style mosque",
      "NOT Iranian-style mosque with blue tiles",
    ],
    triggerKeywords: ["mosque", "gama", "prayer", "neighborhood"],
  },
  {
    ar: "شارع القاهرة",
    latin: "shari cairo",
    description:
      "Cairo street: narrow, lined with 4–6 story apartment buildings with balconies, satellite dishes, hanging laundry, occasional palm tree, taxi or microbus parked at the curb",
    notExamples: [
      "NOT suburban American street with houses + lawns",
      "NOT Gulf-style boulevards with skyscrapers",
    ],
    triggerKeywords: ["street", "neighborhood", "outside", "balcony", "apartment"],
  },
  {
    ar: "شقة قاهرية",
    latin: "shaqqa cairo",
    description:
      "Typical Cairo apartment interior: terracotta tile floors, cream walls, ceiling fan, framed family photos, balcony doors with thin curtains, simple sofa with patterned throw pillows",
    notExamples: ["NOT American suburban house", "NOT Gulf-style luxury villa"],
    triggerKeywords: ["home", "apartment", "living room", "indoor"],
  },
  {
    ar: "فانوس رمضان",
    latin: "fanous ramadan",
    description:
      "Ramadan lantern: small handheld colorful lantern made of tin and stained glass; warm interior candle glow; geometric patterns; held by children walking around at dusk",
    notExamples: ["NOT Halloween jack-o-lantern", "NOT Western Christmas lantern"],
    triggerKeywords: ["ramadan", "fanous", "lantern", "ramadan night"],
  },
  {
    ar: "سكر ملون",
    latin: "sukkar malawan",
    description:
      "Egyptian rock-candy: hard colored sugar pieces (red, yellow, green) sold in small paper cones at sweet shops; traditional during Mawlid",
    notExamples: ["NOT generic Western candy", "NOT lollipops"],
    triggerKeywords: ["mawlid", "candy", "sweet shop", "festival"],
  },
  {
    ar: "حفلة عيد ميلاد",
    latin: "birthday party cairo",
    description:
      "Egyptian children's birthday party: family living room, balloons taped to wall, large round homemade cake (often cream-frosted with fruit on top), kids in colorful clothes; relatives bring small wrapped gifts",
    notExamples: [
      "NOT American kids' birthday party with rented venue",
      "NOT pinata setup",
      "NOT bouncy castle at the park",
    ],
    triggerKeywords: ["birthday", "party", "celebration", "cake"],
  },
];

/**
 * Finds glossary entries whose triggerKeywords appear (substring, case-insensitive)
 * in any of the input strings. Deduplicates the result.
 */
export function findRelevantGlossaryEntries(inputs: string[]): GlossaryEntry[] {
  const haystack = inputs.join(" ").toLowerCase();
  const matches = new Map<string, GlossaryEntry>();
  for (const entry of CULTURAL_GLOSSARY) {
    for (const keyword of entry.triggerKeywords) {
      if (haystack.includes(keyword.toLowerCase())) {
        matches.set(entry.latin, entry);
        break;
      }
    }
  }
  return Array.from(matches.values());
}
