# Story few-shot examples

These three example stories carry the cultural-specificity moat per ADR-020.
The AI mimics their voice, register, structure, and cultural anchors.

**For Ahmed's review** — open each `.ts` file and read the `STORY` constant.
The Arabic text is what the AI will be expected to produce. If anything reads
unnaturally for an Egyptian native speaker, flag it and we iterate.

## Coverage matrix

| File | Theme | Moral | Age band | Words/page (avg) |
|---|---|---|---|---|
| `01-friendship-3-5.ts` | الصداقة (Friendship) | اللطف (Kindness) | 3-5 | ~30 |
| `02-school-5-7.ts` | أول يوم مدرسة (First day at school) | الشجاعة (Courage) | 5-7 | ~60 |
| `03-eid-6-8.ts` | العيد (Eid) | الكرم (Generosity) | 6-8 | ~85 |

## Story craft principles applied (sessions 9.6 + 9.7)

Synthesized from:
- Modern children's-literature research ([Sondra Eby](https://sondraeby.com/picture-book-plot-structure/), [Mary Kole Editorial](https://www.marykole.com/picture-book-story-structure), [ArabKidLit](https://arabkidlitnow.com/), [The Markaz Review](https://themarkaz.org/unshackling-language-in-arabic-childrens-literature/))
- Critical review of HekayaAI's storytelling skill prompt (Ahmed shared, session 9.7) — adopted: 3-act structure explicit, Emotional Validation Arc (Mirror→Bridge→Transformation), per-page metadata, parent discussion question, cover description as separate field
- Skipped from HekayaAI: flat sentence caps, "child name on every page", explicit naming of psychological frameworks (we apply via examples, not academic citation), values hierarchy, hard-coded foods list

These examples now follow:

1. **Three-attempt pattern** (try, fail, try, fail, try → succeed). Real story arc, not just emotional state changes:
   - Layla: waves (fail) → offers ball (fail) → gives her favorite toy (success)
   - Yusuf: asks busy older boy (fail) → follows wrong class (fail) → reads class signs himself (success)
   - Maryam: offers money (fail) → offers kahk (fail) → invites to co-create (success)

2. **Character agency** — protagonist solves the problem THEMSELVES. Adults present (ماما, أبلة, الست أم محمد) but never the solution.

3. **Show don't tell** — emotion shown through action, not narrator commentary:
   - Layla "felt something warm in her chest" instead of "Layla learned that kindness is..."
   - Yusuf "felt ten years older" instead of "Yusuf became brave"
   - Maryam "felt her heart grow bigger than her new dress"

4. **Moral arc emerges from CHOICE under pressure** — the protagonist makes a hard decision (give up favorite toy, persist when scared, see beyond charity to dignity). The choice is what teaches.

5. **Real conflict that grates against the protagonist** — Layla loves her toy, that's WHY giving it up matters. Yusuf is timid, that's WHY problem-solving stretches him. Maryam is well-off and naively assumes generosity = giving things, that's WHY learning that real generosity = inclusion is character growth.

6. **Three-act structure explicit per page** (`act: "setup" | "challenge" | "resolution"` field) — adopted from HekayaAI prompt. Roughly 25% setup / 50% challenge / 25% resolution. Helps the illustration AI sense story rhythm; helps reviewers spot structural issues.

7. **Per-page emotional beat** (`emotionalBeat` field, English) — short label like "anticipation mixed with anxiety" or "courageous action solving the problem". Used by:
   - Illustration AI for facial expression + scene mood guidance
   - Validators framework to check emotional progression
   - Admin reviewer to scan emotional arc at a glance

8. **`moralMoment: true` flag** on the single page where the moral is most clearly demonstrated through action (not declared). Used by:
   - Validators to confirm the moral is concretely shown
   - Reviewer to spot-check the most important page first
   - PDF assembly for potential decorative emphasis

9. **Cover description** — separate from page 1 illustration. Cover is iconic + emotional summary; page 1 is the opening scene. Different prompts produce different optimization for each.

10. **Parent discussion question** at the story end — open-ended question for the parent to ask the child after reading. Increases re-read value, deepens parent-child bond, makes the book a conversation rather than a passive consume. Adopted from HekayaAI; brilliant UX touch.

## Diacritization (التشكيل) policy

Selective diacritics applied to help parents read aloud confidently. Density scales by age band:

| Age band | Density target | Reasoning |
|---|---|---|
| 3-5 | ~15% of words | New parents-of-toddlers + early-readers need most help; some parents read MSA infrequently |
| 5-7 | ~8% of words | Balance — disambiguate without textbook feel |
| 6-8 | ~3% of words | Only genuinely ambiguous words; trust the experienced parent reader |

**Always diacritize:**
- Character names in narration (لَيْلَى, نُور, يُوسُف, مَرْيَم, سُعاد)
- Words with shadda where missing it changes meaning (لَوَّحَت, بَصَّت, طَلَّعَت, رَحَّبَت)
- Egyptian-dialect verbs that could be confused with MSA (مِشِيت, هَزِّت, جَابَت, افْتَكَر)
- Homographs at risk of misreading

**Don't diacritize:**
- Common particles (في، على، من، إلى)
- The definite article (ال)
- Pronouns (هو، هي، إحنا، إنت)
- Words with one obvious reading
- Every word — turns text into a textbook (إعجام كامل) which kills narrative flow

**Why this matters:** Hadouta books are read aloud by Egyptian parents to children. Egyptian Arabic has phonetic patterns that don't always match MSA — diacritization eliminates the mid-read pause where a parent has to figure out which reading is intended. For the 3-5 band especially, where the parent might be the first read-aloud experience the child has, smooth flow matters.

The system prompt will instruct the AI to apply this same policy when generating new stories.

This range gives the AI examples of:
- Three different age-band registers (vocab simplicity, sentence length)
- Three different theme types (universal social, school transition, religious-specific)
- Three different morals (interpersonal kindness, internal courage, external generosity)
- Mixed Arabic register: MSA-leaning narration + Egyptian Arabic dialogue (per Q2 lock)
- The brand brief's three-worlds image set (Cairo apartment / Cairo school / Cairo Eid)
- Religion-neutral chrome with theme-driven specificity (Eid story sees Coptic family
  also celebrating, friendship/school stories are religion-neutral)

## Voice-register notes for review

- **Narration**: simplified MSA (فصحى مبسطة). Past-tense narrative verbs (كانت، فتحت،
  جرت). Avoids over-formal MSA constructs (no إذ، حيث، ما إن... حتى).
- **Dialogue**: pure Egyptian Arabic (مصرية). Uses بتاع/بتاعت، إزاي، عشان، فين.
  Avoids both Gulf vocabulary and Standard Arabic dialogue (which would sound
  stilted to Egyptian ears).
- **Personalization**: child name appears 3-5 times across the 8 pages — never
  monotonous, sometimes via dialogue ("يا ليلى") sometimes via narration.
- **Moral**: emerges from character action (Layla approaching the lonely child;
  Yusuf overcoming his fear; Maryam choosing to share). NEVER stated didactically
  ("and the moral is...").
- **Setting**: modern Cairo middle-class life (apartment building, neighborhood
  park, public school, family Eid gathering). NO pyramids, NO sphinx, NO Gulf
  aesthetic, NO Western imports.

## What we do with these examples

Each example is fed into the system prompt as a few-shot instance that the
AI sees BEFORE generating the actual customer's story. The AI generalizes
voice + structure + cultural register from these examples, then applies the
pattern to the customer's specific (theme, moral, child name, age band, etc.).

Per ADR-020, these examples are the closest thing we have to "Egyptian
writers seeded our templates" — the difference is that I (Claude, in prompt
engineering) wrote them rather than commissioning human writers. They
evolve based on rejection feedback from the manual review queue.
