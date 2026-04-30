# Validator Regression Test Suite

Hand-crafted test cases that every validator prompt change must pass before deployment.

## Structure

Each test case is a folder:

```
case-NNN-<short-slug>/
├── input.json        story output to validate
├── expected.json     which validators should pass / fail and why
└── notes.md          (optional) why this case exists, real-world origin
```

## Test categories

- **Religious safety failures** (e.g. alcohol on dinner table, music in mosque scene)
- **Cultural safety failures** (e.g. kid sasses elder, mom in inappropriate clothing)
- **Age-appropriate failures** (e.g. story mentions death without proper framing, scary villain)
- **Moral failures** (e.g. lying praised, theft as comedy)
- **Language failures** (e.g. profanity, slurs, wrong-register dialect)
- **Educational failures** (e.g. wrong facts about Egypt, Islam, geography)
- **Format failures** (e.g. wrong page count, missing required fields)
- **Theme adherence failures** (e.g. FDS story without school setting)
- **Approved cases** (~50% of suite — clean stories that should pass)

## Running

```bash
pnpm test tests/validator-regression-suite/
```

CI runs this on every PR. Failure blocks merge.

## Growing the suite

Every real customer rejection becomes a new test case. Active-learning data → regression suite → safer validators.

## Status

📋 To be populated in Sprint 3 (target: 100+ cases by Sprint 5 closed beta).
