# Siege & Scepter — Project Status

Updated: 2026-07-12 (session 4 — research shipped; simple army + PvE implemented)

## Decisions made (approved by Tanel)

- **Tech stack:** TypeScript full-stack — React + Vite (web), Node.js + Fastify (server),
  PostgreSQL + Drizzle ORM, Vitest, pnpm workspaces monorepo.
- **First milestone:** foundation + first vertical slice — one city, time-based resource
  production, building construction with queue. (MVP stage 1 of the design doc, section 36.)
- **Code home:** https://github.com/teezky/Siege-Scepter (repo created by Tanel,
  initial commit pushed). Design docs stay in the OneDrive folder.

## What exists (committed and pushed, branch `main`)

- `packages/shared` — typed game config (6 resources; 8 buildings including house and
  academy; population and research constants), pure domain math
  (exponential costs/times, worker-based production, event-driven population+resource
  simulation `advanceCity`, research effects shared by server and client), API contracts. 45 unit
  tests, all green.
- `apps/server` — Fastify app: auth domain (argon2 + hashed session tokens + cookie,
  rate-limited), cities domain (first city on registration, lazy idempotent construction
  finalization inside row-locked transactions, chronological offline queue processing,
  worker allocation and player-global research with authoritative validation),
  structured error contract. 27 integration tests against real Postgres, all green.
- `apps/web` — React SPA: auth form, city screen with live-predicted resource bar
  AND population (client runs the same `advanceCity` simulation, server stays
  authoritative), population panel (housing, free citizens/taxes, next-arrival
  countdown, famine warnings), worker +/− allocation controls on production
  buildings, research panel, building cards with cost/prereq gating, and construction
  queue with countdowns. Dark medieval-ish CSS, mobile-friendly. 18 component tests.
- Drizzle migrations `0000`–`0002` (foundation, population and research), applied to
  `siege_dev`.
- `.github/workflows/ci.yml` — GitHub Actions: pnpm install → typecheck → lint →
  full test suite against a Postgres 17 service container. Green on `main`.

## Research system (slice 3, shipped on `main`)

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

## Simple army + PvE (slice 4, implemented on `codex/pve-army`)

- New `barracks` building (town hall 2 prerequisite) and two recruitable units:
  spearmen (10 power) and archers (16 power), with centralized costs and stats.
- Soldiers reserve citizens from worker allocation and tax income; they remain part
  of total population and therefore already consume food through population upkeep.
- Two sequential one-time local threats: Bandit Camp (60 power) and Raider Outpost
  (140 power), with storage-aware resource rewards.
- Deterministic server-side battle resolution uses the whole available army and
  produces bounded population losses plus a persisted battle report; housing allows
  the city to recover naturally after a defeat.
- City-row locking + unique completion rows make attacks and rewards retry-safe:
  the same encounter cannot grant its reward twice.
- Dedicated military API and UI: army overview, quantity-based recruitment, encounter
  gates, attack actions, completion state and recent battle reports.
- Drizzle migration `0003_motionless_titania.sql`: city units, player PvE completions
  and battle reports; applied to `siege_dev`.

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

## Verified simple army + PvE slice (2026-07-12)

- Shared, server and web TypeScript checks — all green.
- 104 automated tests — all green: 49 shared domain tests, 33 server integration
  tests against PostgreSQL, and 22 web component tests.
- ESLint, production web build and `git diff --check` — green.

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
- Recruitment is instant in the first PvE slice; a persisted training queue is deferred.
- The whole available army fights; partial deployments, formations, commanders,
  equipment, wounded units and travel time are deferred to later military slices.
- All current unit losses reduce population; the later wounded-unit system will
  split losses into fatalities, recovery and temporary unavailability.

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

1. Merge the simple army + PvE slice after review and CI.
2. Next progression slice: second city, followed by the world map.
3. Parallel candidates: queue cancellation, satisfaction, or a public deploy so
   friends can test the complete economy → research → PvE loop.
