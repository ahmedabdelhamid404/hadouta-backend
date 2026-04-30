# Universal Validators

Theme-agnostic validators that run on EVERY generated story regardless of theme. These are the "constitutional layer" — the inviolable safety rules of the platform.

Each file is a system prompt + few-shot examples for one Haiku 4.5 sub-validator that runs in parallel during the AI pipeline.

## Files (to be authored in Sprint 3)

- `religious-safety.md` — flag content that conflicts with Islamic values (alcohol, pork, music if traditionally avoided, gendered prohibitions, etc.)
- `cultural-safety.md` — flag content that violates Egyptian cultural norms (disrespect to elders, gender roles handled inappropriately, etc.)
- `age-appropriate.md` — flag content with violence, scary themes, inappropriate adult themes for 3-5yr
- `moral-correctness.md` — flag content that praises lying / cheating / bullying without consequence
- `language-safety.md` — flag slurs, profanity, inappropriate dialect mixing
- `educational-soundness.md` — flag factual errors about Islam, Egypt, geography

## Why "universal"

When we add Theme #2 (Eid Al-Adha), Theme #3 (Birthday), etc. — these validators apply UNCHANGED. Adding a theme touches only theme-specific validators in `content/themes/<theme>/validator-rules.json`. The universal layer is stable foundation.

## Regression test suite

These validators are tested against `tests/validator-regression-suite/` — a corpus of 100+ hand-crafted test cases. Any prompt change must pass all cases before deploy.

## Status

📋 To be authored in Sprint 3 (AI pipeline foundation). See ADR-012.
