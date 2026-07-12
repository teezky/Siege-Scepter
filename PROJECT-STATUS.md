# Siege & Scepter — Project Status

Updated: 2026-07-12 (session 3 — population shipped; research implemented and verified)

## Decisions made (approved by Tanel)

- **Tech stack:** TypeScript full-stack — React + Vite (web), Node.js + Fastify (server),
  PostgreSQL + Drizzle ORM, Vitest, pnpm workspaces monorepo.
- **First milestone:** foundation + first vertical slice — one city, time-based resource
  production, building construction with queue. (MVP stage 1 of the design doc, section 36.)
- **Code home:** https://github.com/teezky/Siege-Scepter (repo created by Tanel,
  initial commit pushed). Design docs stay in the OneDrive folder.

## What exists (committed and pushed, branch `main`)

- `packages/shared` — typed game config (5 resources; 7 buildings: townHall, warehouse,
  house, sawmill, quarry, farm, ironMine; population constants), pure domain math
  (exponential costs/times, worker-based production, event-driven population+resource
  simulation `advanceCity` shared by server and client), API contract types. 34 unit
  tests, all green.
- `apps/server` — Fastify app: auth domain (argon2 + hashed session tokens + cookie,
  rate-limited), cities domain (first city on registration, lazy idempotent construction
  finalization inside row-locked transactions, chronological offline queue processing,
  `PUT /api/cities/:id/workers` worker allocation with slot/population validation),
  structured error contract. 22 integration tests against real Postgres, all green.
- `apps/web` — React SPA: auth form, city screen with live-predicted resource bar
  AND population (client runs the same `advanceCity` simulation, server stays
  authoritative), population panel (housing, free citizens/taxes, next-arrival
  countdown, famine warnings), worker +/− allocation controls on production
  buildings, building cards with cost/prereq gating, construction queue with
  countdowns. Dark medieval-ish CSS, mobile-friendly. 15 component tests.
- Drizzle migrations `0000_sticky_prodigy.sql` + `0001_cold_unus.sql` (population
  columns, workers, drops stored rate_per_hour — rates are derived now), applied
  to `siege_dev`.
- `.github/workflows/ci.yml` — GitHub Actions: pnpm install → typecheck → lint →
  full test suite against a Postgres 17 service container. Green on `main`.

## Research system (slice 3, implemented and verified this session)

- 6th resource `knowledge`: produced by scientists (workers) in the new
  `academy` building (prereq: town hall 2; 4 slots/level, 6 knowledge/h each),
  never tradable, not storage-capped.
- Simple research tree (design doc 16 + MVP 36): 3 branches × 2 techs, linear
  prerequisites, instant purchase with knowledge — pacing comes from how fast
  scientists accumulate it. Every tech changes play, not just a number:
  cropRotation (farm +2 slots/level) → bookkeeping (tax +1/free citizen);
  stoneTools (sawmill/quarry +5/worker) → constructionCranes (+2 queue slots);
  sanitation (arrival 15→10 min) → urbanPlanning (house +6 housing/level).
- Effects fold into one `TechEffects` struct (`techEffects(researched)`),
  threaded as an optional param through slots/rates/housing/advanceCity —
  server settles, views and client prediction all stay in agreement.
- `player_research` table (techs are player-global); knowledge lives in the
  player's single city for now — documented assumption: becomes a player-level
  pool when multiple cities arrive.
- Drizzle migration `0002_furry_joystick.sql` creates `player_research` and
  backfills the knowledge resource row for existing cities; applied to `siege_dev`.
- `POST /api/research { techId }`; CityView gained `researchedTechs`.
- Web: Research panel (branch-labelled tech cards, prereq/cost gating),
  knowledge in the resource bar, effects-aware prediction and worker slots.

## Population system (slice 2, shipped this session)

- Growth is event-based: one citizen arrives every 15 min while there is free
  housing AND food in storage. Between events all rates are constant, so the
  original "amount at ref time + rate" model still holds piecewise.
- Production now comes from workers: production buildings have 6 slots/level,
  output = workers × per-worker rate (sawmill 20 wood, quarry 15 stone,
  farm 18 food, ironMine 10 iron per worker/h).
- Every citizen eats 2 food/h; unassigned (free) citizens pay 4 coins/h tax
  (replaces the old town-hall coin placeholder).
- Housing: base 10 + town hall 20/level + house 14/level (new `house` building).
- Famine: food clamps at 0, arrivals pause and retry every 15 min, nobody dies
  (design doc 11.2). No production penalty yet — documented assumption.
- `advanceCity` in `packages/shared/src/domain/population.ts` is the single
  simulation used by server settles, server views AND client prediction.

## Verified this session (2026-07-11, Tanel's Windows machine)

- `pnpm typecheck`, `pnpm lint`, `pnpm test` — all green (34 tests).
- Full browser smoke test of the golden path: register → first city created →
  resources tick client-side → build quarry → countdown → completion → quarry Lv 1
  producing +90/h stone → logout → login. All working.

## Verified research slice (2026-07-12)

- Shared, server and web TypeScript checks — all green.
- 90 automated tests — all green: 45 shared domain tests, 27 server integration
  tests against PostgreSQL, and 18 web component tests.
- ESLint and the production web build — green.
- `git diff --check` — clean.

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

- Coins are not storage-capped (since slice 1).
- Famine pauses growth but carries no production/satisfaction penalty yet.
- Only one `house` building per city (city_buildings PK is city+building);
  multiple house plots arrive with the visual city map.
- Satisfaction (design doc 11.3) not modeled yet.

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

1. Next slice candidates (design doc progression, section 6): PvE encounter +
   simple army (step 6), current-slice polish (queue cancellation, satisfaction),
   or a public deploy so friends can test.
2. Keep "How to Work in This Project.md" section 42 in sync.
