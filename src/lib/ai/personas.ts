// Persona library — 6 starter personas for the no-photo wizard flow.
// User picks a persona that roughly matches their child; the persona
// description seeds the Bible's mainChild appearance block (gpt-4o then
// refines based on actual age + name).
//
// Per docs/design/specs/2026-05-03-illustration-pipeline-redesign-spec.md §5.2.

export interface Persona {
  id: string;
  label: string;
  /** "girl" | "boy" — appears in Bible.characterBible.mainChild.gender */
  gender: "boy" | "girl";
  ageBand: "3-5" | "5-7" | "6-8";
  appearance: {
    hair: string;
    skin: string;
    eyes: string;
    distinguishing: string;
  };
  outfit: string;
}

export const PERSONAS: readonly Persona[] = [
  {
    id: "curly-girl-young",
    label: "بنت بشعر مجعد، 3-5 سنوات",
    gender: "girl",
    ageBand: "3-5",
    appearance: {
      hair: "dark curly hair shoulder-length pulled into two pigtails with colorful ribbons",
      skin: "warm medium-olive skin",
      eyes: "large round dark-brown eyes with thick lashes",
      distinguishing: "small dimple on left cheek, slight gap between front teeth",
    },
    outfit:
      "yellow cotton sundress with small white daisy print, white short-sleeved cardigan, brown leather sandals",
  },
  {
    id: "straight-girl-young",
    label: "بنت بشعر طويل ناعم، 3-5 سنوات",
    gender: "girl",
    ageBand: "3-5",
    appearance: {
      hair: "long straight dark-brown hair past the shoulders, simple front fringe",
      skin: "warm fair-olive skin",
      eyes: "almond-shaped honey-brown eyes",
      distinguishing: "rosy cheeks, freckles across the bridge of the nose",
    },
    outfit:
      "soft pink cotton dress with elastic waist, white tights, white canvas sneakers with pink laces",
  },
  {
    id: "hijab-girl-older",
    label: "بنت محجبة، 6-8 سنوات",
    gender: "girl",
    ageBand: "6-8",
    appearance: {
      hair: "wearing a soft cream-colored hijab covering hair completely, small modest visible front",
      skin: "warm medium-olive skin",
      eyes: "large dark-brown eyes with confident expression",
      distinguishing: "wears small silver heart-shaped earrings",
    },
    outfit:
      "long-sleeved sage-green tunic dress over loose cream pants, white sneakers, cream hijab",
  },
  {
    id: "glasses-boy-mid",
    label: "ولد بنظارة، 5-7 سنوات",
    gender: "boy",
    ageBand: "5-7",
    appearance: {
      hair: "short dark wavy hair, side-parted, slightly tousled",
      skin: "warm medium-olive skin",
      eyes: "round dark-brown eyes behind thin round metal-framed glasses",
      distinguishing: "small mole on right cheekbone, gap between front teeth",
    },
    outfit:
      "white short-sleeved t-shirt with simple navy stripe across the chest, dark blue cotton shorts, white sneakers",
  },
  {
    id: "short-hair-boy-young",
    label: "ولد بشعر قصير، 3-5 سنوات",
    gender: "boy",
    ageBand: "3-5",
    appearance: {
      hair: "very short dark-brown hair, slight tuft at front",
      skin: "warm medium-olive skin",
      eyes: "wide-set large dark-brown eyes with curious expression",
      distinguishing: "small dimple on left cheek when smiling",
    },
    outfit:
      "red short-sleeved t-shirt with white star on the chest, beige cotton shorts, white canvas sneakers",
  },
  {
    id: "curly-boy-older",
    label: "ولد بشعر مجعد، 6-8 سنوات",
    gender: "boy",
    ageBand: "6-8",
    appearance: {
      hair: "thick dark-brown curly hair, slightly grown out and tousled",
      skin: "warm tan-olive skin",
      eyes: "large dark-brown eyes with mischievous expression",
      distinguishing: "small scar above right eyebrow from a childhood fall, dimple on right cheek",
    },
    outfit:
      "olive-green button-down short-sleeved shirt over a white t-shirt, dark cotton shorts, brown sandals",
  },
];

export function getPersonaById(id: string): Persona | undefined {
  return PERSONAS.find((p) => p.id === id);
}
