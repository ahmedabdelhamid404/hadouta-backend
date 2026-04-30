# Hadouta Backend (حدوتة)

The API backend for Hadouta — Egyptian AI-personalized children's book platform.

> **Heads-up to anyone reading this**: this repo is one of two. The frontend lives at `../hadouta-web`. The shared design doc, sprint plans, ADRs, and session notes live at `../docs/`. **Read `../docs/sprints/sprint-tracker.md` first to understand current state.**

---

## Stack

- **Runtime**: Node.js 20+ (target 22)
- **Framework**: Hono
- **AI**: Vercel AI SDK (Claude Sonnet 4.6 + Haiku 4.5 + fal.ai Nano Banana 2)
- **Database**: Neon Postgres + pgvector via Drizzle ORM
- **Auth**: Better-Auth
- **Workflows**: Trigger.dev v3 with waitpoints
- **Observability**: Helicone (AI), Sentry (errors)
- **Object storage**: Cloudflare R2 (signed URL upload pattern)
- **PDF generation**: Puppeteer

Full architectural decisions: see `../docs/decisions/ADR-*.md`.

---

## Quick start

### Prereqs

- Node.js 20.18+ (`nvm use` if you have nvm)
- pnpm 10+ (`npm install -g pnpm`)
- A Neon Postgres database (free tier is fine for dev)

### Setup

```bash
# 1. Clone and install
git clone <repo-url> hadouta-backend
cd hadouta-backend
pnpm install

# 2. Configure environment
cp .env.example .env
# Edit .env with your Neon DATABASE_URL, Anthropic API key, etc.

# 3. Run database migrations
pnpm db:generate       # generate migration from schema
pnpm db:migrate        # apply to your Neon DB

# 4. Start dev server
pnpm dev
```

The API will run on `http://localhost:3001`. Test with:

```bash
curl http://localhost:3001/health
# → {"status":"ok","service":"hadouta-backend",...}
```

---

## Project structure

```
src/
├── routes/                Hono routes (one file per resource)
│   ├── health.ts
│   └── waitlist.ts
├── services/              Business logic
├── ai/                    AI orchestration: prompts, validators, image gen
├── db/                    Drizzle schema, migrations
│   ├── schema.ts
│   └── migrations/
├── trigger/               Trigger.dev job definitions (Sprint 3+)
├── schemas/               Shared Zod schemas (used in routes + services)
└── server.ts              Hono app entry

content/                   Theme content, prompts, validator rules (git-managed)
├── themes/
│   └── first-day-school/
└── universal-validators/

tests/
├── unit/
├── integration/
└── validator-regression-suite/   100+ ethics test cases (Sprint 3+)

.specify/                  Spec-kit workflows + memory + templates
.claude/                   Project-scope Claude Code config (settings, skills)
```

---

## Development workflow

### Spec-kit driven features
For non-trivial features, use spec-kit slash commands:

```
/speckit-specify    — write feature spec
/speckit-plan       — technical plan
/speckit-tasks      — task breakdown
/speckit-implement  — execute implementation
```

### Code review (mandatory)
Every PR-style change runs through the **Code Reviewer** agent before merge. See `../docs/agents-playbook.md` for which specialist agent owns which task type.

### Constitution
The non-negotiable principles live in `.specify/memory/constitution.md`. Read before significant changes.

---

## Auth

Better-Auth is mounted at **`/api/auth/*`** on the same Hono server. It handles email/password sign-up + sign-in, Google OAuth (when credentials are set), and email verification via Resend.

### Environment variables

Required:
- `BETTER_AUTH_SECRET` — generate via `openssl rand -base64 32`

Optional (auth still works without them):
- `BETTER_AUTH_URL` — defaults to `http://localhost:3001`
- `FRONTEND_URL` — defaults to `http://localhost:3000` (used for CORS + trusted origins)
- `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` — both must be set together to enable Google OAuth
- `RESEND_API_KEY` — when blank, verification/reset emails are logged to stdout instead
- `RESEND_FROM_EMAIL` — defaults to `Hadouta <noreply@mail.hadouta.com>`

In dev (`NODE_ENV !== 'production'`) email verification is **not required** before sign-in so local flows aren't blocked when Resend isn't wired. In production, email verification is enforced.

### Quick smoke test (curl)

Sign up:

```bash
curl -X POST http://localhost:3001/api/auth/sign-up/email \
  -H 'Content-Type: application/json' \
  -d '{"name":"Test","email":"smoketest@example.com","password":"abcd1234"}'
```

Sign in:

```bash
curl -X POST http://localhost:3001/api/auth/sign-in/email \
  -H 'Content-Type: application/json' \
  -d '{"email":"smoketest@example.com","password":"abcd1234"}'
```

Both return JSON with the user object and a session token; sign-up also sets a session cookie.

### Enabling Google OAuth

Create an OAuth 2.0 Client ID in [Google Cloud Console](https://console.cloud.google.com/apis/credentials) with redirect URI `http://localhost:3001/api/auth/callback/google` (and the production equivalent). Set `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` in `.env`. The provider auto-registers on next server boot.

---

## Useful scripts

```bash
pnpm dev              # start dev server with watch
pnpm build            # compile TypeScript to dist/
pnpm typecheck        # type-check without emit
pnpm test             # run Vitest suite
pnpm test:watch       # watch mode
pnpm db:generate      # generate Drizzle migration from schema changes
pnpm db:migrate       # apply pending migrations to DB
pnpm db:studio        # open Drizzle Studio (DB GUI)
pnpm openapi:export   # regenerate openapi.json (consumed by frontend type sync)
```

---

## Multi-session continuity

Every session reads `../docs/sprints/sprint-tracker.md` first. Every session writes a session note in `../docs/session-notes/` at the end. Decisions get documented as ADRs in `../docs/decisions/`. The sprint plans live in `../docs/sprints/`.

If you're starting a new session: **read the tracker, read the latest session note, open the current sprint plan, continue.**

---

## License

Private. Not for redistribution.
