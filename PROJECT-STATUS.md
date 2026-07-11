# Siege & Scepter — Project Status

Updated: 2026-07-11 (session 1)

## Decisions made (approved by Tanel)

- **Tech stack:** TypeScript full-stack — React + Vite (web), Node.js + Fastify (server),
  PostgreSQL + Drizzle ORM, Vitest, pnpm workspaces monorepo.
- **First milestone:** foundation + first vertical slice — one city, time-based resource
  production, building construction with queue. (MVP stage 1 of the design doc, section 36.)
- **Code home:** GitHub repo (not yet created — needs user auth via `gh` device flow).
  Design docs stay in the OneDrive folder.

## What exists (all committed to local git, branch `main`)

- `packages/shared` — typed game config (5 resources, 6 buildings: townHall, warehouse,
  sawmill, quarry, farm, ironMine), pure domain math (exponential costs/times, time-based
  resource calculation with storage caps), API contract types. Unit tests written.
- `apps/server` — Fastify app: auth domain (argon2 + hashed session tokens + cookie,
  rate-limited), cities domain (first city on registration, lazy idempotent construction
  finalization inside row-locked transactions, chronological offline queue processing),
  structured error contract. Integration tests written (require Postgres).
- `apps/web` — React SPA: auth form, city screen with live-predicted resource bar
  (client predicts via shared domain functions, server stays authoritative),
  building cards with cost/prereq gating, construction queue with countdowns. Dark
  medieval-ish CSS, mobile-friendly.
- Drizzle schema written; **migrations NOT yet generated** (needs `drizzle-kit` install).

## Documented assumptions (revisit later)

- Town hall produces a small coin income (taxes placeholder) until the population system arrives.
- Coins are not storage-capped in slice 1.
- Population system deferred to the next slice; production comes directly from building levels.

## Blocked on

- `pnpm install` fails: session network egress blocks `registry.npmjs.org`
  (403 host_not_allowed). Tanel changed the session network setting, but it appears to
  apply only to NEW sessions. Nothing has been installed or verified yet:
  no typecheck, no lint, no tests have run.

## Next steps (in order)

1. In a session with registry access: `pnpm install` at repo root.
2. `pnpm --filter @siege/server db:generate` to generate Drizzle migrations, then review them.
3. Start Postgres (see below), create `siege_dev` DB, run `pnpm db:migrate`.
4. `pnpm typecheck && pnpm lint && pnpm test` — fix whatever surfaces (code is unverified).
5. Smoke test: `pnpm dev` (server :3000, web :5173, Vite proxies /api).
6. Create GitHub repo (user auth needed), push.
7. Update "How to Work in This Project.md" section 42 (stack + commands) — KEEP IN SYNC.

## Local Postgres in the cloud container (root container)

```bash
mkdir -p /var/lib/postgresql/data && chown postgres:postgres /var/lib/postgresql/data
su postgres -c "/usr/lib/postgresql/16/bin/initdb -D /var/lib/postgresql/data -U postgres --auth=trust"
su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D /var/lib/postgresql/data -l /var/lib/postgresql/pg.log -o '-p 5432' start"
psql -h localhost -U postgres -c "CREATE ROLE siege LOGIN PASSWORD 'siege' SUPERUSER;"
psql -h localhost -U postgres -c "CREATE DATABASE siege_dev OWNER siege;"
```

Server env: copy `apps/server/.env.example` to `apps/server/.env`
(`DATABASE_URL=postgres://siege:siege@localhost:5432/siege_dev`).
Tests use `postgres://siege:siege@localhost:5432/postgres` as admin URL and
create/drop `siege_test` themselves.
