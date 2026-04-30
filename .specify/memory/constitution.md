# Hadouta Backend Constitution

The inviolable principles that govern code, architecture, and operations in this repository. Read before every significant change. Spec-kit `/speckit.plan` and `/speckit.tasks` MUST verify compliance before proceeding.

## Core Principles

### I. TypeScript Strict (NON-NEGOTIABLE)
TypeScript runs in strict mode. No `any` types except in third-party shims at integration boundaries. All function signatures explicit. All exported APIs typed. `tsc --noEmit` passes in CI on every PR.

### II. Schema-First (Zod is law)
Every external surface — HTTP request/response, LLM output, queue payload, database row — has a Zod schema. Schemas live in `src/schemas/` and are the single source of truth. The schema generates: OpenAPI docs (`@hono/zod-openapi`), runtime validation (Hono middleware), TypeScript types (inferred), and frontend type sync (via OpenAPI export). One definition, four uses.

### III. Layered Validators (Cultural Safety is NON-NEGOTIABLE)
AI-generated content passes through Universal validators (theme-agnostic, applies to ALL stories) BEFORE theme-specific validators. Universal validators cover religious safety, cultural safety, age-appropriateness, moral correctness, language safety, educational soundness. New validator prompt versions MUST pass the regression test suite (`tests/validator-regression-suite/`) before deploy.

### IV. Active Learning Loop
Every rejection captures structured category + free-text feedback. Rejection embeddings stored in pgvector. Validator prompts updated periodically with real rejection few-shot examples. The validator gets smarter with use; it does not stay static.

### V. Cost Discipline
Anthropic prompt caching enabled on all repeated system prompts. AI provider calls instrumented via Helicone. Per-book cost tracked + alerted if exceeds 60 EGP. AI cost is tracked as a first-class metric, not an afterthought.

### VI. Egyptian Cultural Fit
All content (themes, prompts, validator examples, story templates) must pass an Egyptian cultural appropriateness review before merge. MSA narration + Egyptian dialogue mix is the language standard. RTL Arabic is the default for any user-facing copy.

### VII. Privacy First
Photos are encrypted at rest in Cloudflare R2. Auto-deletion 30 days after order completion. Parental consent at upload (no exceptions). PII never logged to console or analytics.

## Technology Stack (Fixed for v1)

- **Runtime**: Node.js 22+ (or Bun if migration is justified later)
- **Framework**: Hono
- **AI orchestration**: Vercel AI SDK
- **AI providers**: Anthropic (Sonnet 4.6 + Haiku 4.5), fal.ai (Nano Banana 2 / Pro)
- **Database**: Neon Postgres + pgvector
- **ORM**: Drizzle
- **Auth**: Better-Auth
- **Workflows**: Trigger.dev v3
- **Object storage**: Cloudflare R2
- **PDF generation**: Puppeteer
- **Observability**: Helicone (AI), Sentry (errors)
- **Email**: Resend
- **WhatsApp**: Twilio
- **Payment**: Paymob
- **Testing**: Vitest

Substitutions allowed only via documented ADR.

## Development Workflow

### Code Review (Mandatory)
Every PR-style change reviewed by Code Reviewer agent before merge. No exceptions. Manager (Claude) does final read-through after specialist + reviewer pass.

### Spec-Kit Workflow
Non-trivial features go through: `/speckit.specify` → `/speckit.plan` → `/speckit.tasks` → `/speckit.implement`. Skipping the spec phase is allowed only for true bug fixes (one-line corrections, dependency bumps, doc edits).

### Testing
- Unit tests for validators, schemas, utility functions
- Integration tests for HTTP routes via Hono's test client
- Validator regression suite runs in CI; new validator prompts must pass all 100+ cases
- Vitest is the only test runner (no Jest)

### Branch & Commit
- `main` is always deployable
- Feature branches: `sprint-NN/feature-name` or `feature/<short-desc>`
- Commit messages: imperative, present tense, scope prefix (e.g., "auth: add Better-Auth Google OAuth")
- No force-push to main, ever

## Governance

This constitution supersedes any conflicting practice. Amendments require:
1. New ADR documenting the change + rationale
2. Update to this file
3. Notification in current sprint's session notes

For runtime guidance during a feature build, agents reference:
- This constitution
- The current sprint plan
- Relevant ADRs in `../docs/decisions/`

**Version**: 1.0.0 | **Ratified**: 2026-04-30 | **Last Amended**: 2026-04-30
