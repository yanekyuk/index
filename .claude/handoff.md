---
trigger: "Write getting started / setup guide for onboarding new developers"
type: docs
branch: docs/getting-started
created: 2026-03-26
version-bump: none
---

## Related Files
- `package.json` (root)
- `protocol/package.json`
- `frontend/package.json`
- `protocol/.env.example`
- `frontend/.env.example`
- `protocol/drizzle.config.ts`
- `protocol/src/main.ts`
- `QUICKSTART.md` (existing, check if current)
- `README.md` (existing, check if current)
- `HOWITWORKS.md` (existing, check if current)
- `scripts/worktree-setup.sh`
- `scripts/worktree-list.sh`
- `scripts/worktree-dev.sh`
- `scripts/hooks/pre-commit`

## Relevant Docs
- `QUICKSTART.md` — existing quickstart guide (verify accuracy)
- `README.md` — existing project README
- `HOWITWORKS.md` — existing how-it-works doc
- `CLAUDE.md` — comprehensive project reference

## Scope
Write a getting started guide (`docs/getting-started.md`) for onboarding new developers:

1. **Prerequisites** — Bun runtime, PostgreSQL with pgvector, Redis, required accounts (OpenRouter API key)
2. **Clone and install** — git clone, bun install, workspace structure
3. **Environment setup** — copy .env.example files, required vs optional env vars, database URL, API keys
4. **Database setup** — create PostgreSQL database, enable pgvector extension, run migrations (bun run db:migrate), seed data (bun run db:seed)
5. **Running the app** — bun run dev (protocol on 3001, frontend with Vite proxy), what to expect
6. **Common dev commands** — testing, linting, db:studio, queue monitoring (Bull Board)
7. **Git workflow** — worktree conventions, conventional commits, conventional branches, PR process
8. **Troubleshooting** — common issues (invalid_origin auth error, pgvector extension missing, Redis connection)

Check existing QUICKSTART.md, README.md, and HOWITWORKS.md for accuracy. The new doc should be standalone and comprehensive, superseding or consolidating existing guides.
