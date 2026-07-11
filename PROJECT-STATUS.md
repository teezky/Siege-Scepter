# Siege & Scepter — Project Status

Updated: 2026-07-11 (session 2 — verified, tested, CI green)

## Decisions made (approved by Tanel)

- **Tech stack:** TypeScript full-stack — React + Vite (web), Node.js + Fastify (server),
  PostgreSQL + Drizzle ORM, Vitest, pnpm workspaces monorepo.
- **First milestone:** foundation + first vertical slice — one city, time-based resource
  production, building construction with queue. (MVP stage 1 of the design doc, section 36.)
- **Code home:** https://github.com/teezky/Siege-Scepter (repo created by Tanel,
  initial commit pushed). Design docs stay in the OneDrive folder.

## What exists (committed and pushed, branch `main`)

- `packages/shared` — typed game config (5 resources, 6 buildings: townHall, warehouse,
  sawmill, quarry, farm, ironMine), pure domain math (exponential costs/times, time-based
  resource calculation with storage caps), API contract types. 20 unit tests, all green.
- `apps/server` — Fastify app: auth domain (argon2 + hashed session tokens + cookie,
  rate-limited), cities domain (first city on registration, lazy idempotent construction
  finalization inside row-locked transactions, chronological offline queue processing),
  structured error contract. 14 integration tests against real Postgres, all green.
- `apps/web` — React SPA: auth form, city screen with live-predicted resource bar
  (client predicts via shared domain functions, server stays authoritative),
  building cards with cost/prereq gating, construction queue with countdowns. Dark
  medieval-ish CSS, mobile-friendly. 10 component tests (Vitest + Testing Library,
  jsdom): button labels incl. the queued-order regression, prereq gating,
  queue-full state, resource bar, queue rendering, AuthForm mode toggle.
- Drizzle migration `0000_sticky_prodigy.sql` generated, reviewed, applied to `siege_dev`.
- `.github/workflows/ci.yml` — GitHub Actions: pnpm install → typecheck → lint →
  full test suite against a Postgres 17 service container. Green on `main`.

## Verified this session (2026-07-11, Tanel's Windows machine)

- `pnpm typecheck`, `pnpm lint`, `pnpm test` — all green (34 tests).
- Full browser smoke test of the golden path: register → first city created →
  resources tick client-side → build quarry → countdown → completion → quarry Lv 1
  producing +90/h stone → logout → login. All working.

## Bugs found & fixed while verifying (the code had never run before)

- Server `.env` was never loaded — added `--env-file=.env` to tsx scripts.
- `new URL(...).pathname` produced broken Windows paths for the Drizzle migrations
  folder — replaced with `fileURLToPath` (migrate.ts + test helpers).
- Session TTL used the injectable game-time clock; fast-forwarding simulated time
  expired real sessions. Session expiry now uses wall-clock `Date.now()`.
- `@fastify/rate-limit` throws the `errorResponseBuilder` return value as the error;
  returning a plain object made 429s surface as 500s. Now returns an Error with
  `statusCode` set.
- Auth rate limit (10/min) made the test suite (14 registrations) flaky —
  `buildApp` now accepts an `authRateLimit` override; production default unchanged.
- Web `fetch` init spread set `headers: undefined` (broken under
  `exactOptionalPropertyTypes`) — conditional spread instead.
- CityScreen button showed "Build" (with next-level cost) for buildings that already
  had a queued order — now uses the queue-aware effective level for the label.
- Missing `@types/node` in `apps/server`; Fastify 5 `setErrorHandler` error param
  needed an explicit `FastifyError | AppError` annotation.

## Documented assumptions (revisit later)

- Town hall produces a small coin income (taxes placeholder) until the population system arrives.
- Coins are not storage-capped in slice 1.
- Population system deferred to the next slice; production comes directly from building levels.

## Local dev environment (Tanel's Windows machine)

- Node v24.18.0 at `C:\Program Files\nodejs` (on system PATH), pnpm 10.28.0 installed
  globally via npm (`%APPDATA%\npm`).
- PostgreSQL 17 native Windows install, service `postgresql-x64-17`. The `postgres`
  superuser password was set during install (Tanel has it; not recorded here — this
  repo is public). Dev role and database per `apps/server/.env.example`; server env
  in `apps/server/.env` (gitignored copy).
- Note: the winget PostgreSQL uninstaller preserves `data/` — a reinstall keeps the
  old superuser password unless `data/` is deleted first.
- `C:\Users\tanel` itself is an unrelated git repo (old "Coinvale" project) — left
  untouched; `siege-scepter` has its own scoped `.git`. Don't run git commands for this
  project from outside the project folder.
- `.claude/launch.json` + `.claude/dev-runner.mjs` (gitignored, machine-specific) let
  Claude Code's browser preview start `pnpm dev`; the runner strips the harness-injected
  `PORT` so Fastify keeps using `.env`'s PORT=3000.

## Next steps

1. Next slice: population system (design doc progression step 3 — deferred earlier;
   production should come from allocated workers, not directly from building levels).
   Alternatives considered: current-slice polish (queue cancellation etc.) or a
   public deploy.
2. Keep "How to Work in This Project.md" section 42 in sync (updated this session).
