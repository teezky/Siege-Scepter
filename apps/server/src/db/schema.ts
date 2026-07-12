import {
  bigint,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid
} from 'drizzle-orm/pg-core';

/**
 * Database schema — the relational source of game truth.
 * All timestamps are stored in UTC (timestamptz).
 */

export const players = pgTable(
  'players',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    username: text('username').notNull(),
    passwordHash: text('password_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [uniqueIndex('players_username_unique').on(table.username)]
);

export const sessions = pgTable(
  'sessions',
  {
    /** SHA-256 hash of the session token; the raw token never touches the database. */
    tokenHash: text('token_hash').primaryKey(),
    playerId: uuid('player_id')
      .notNull()
      .references(() => players.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [index('sessions_player_idx').on(table.playerId)]
);

export const cities = pgTable(
  'cities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    playerId: uuid('player_id')
      .notNull()
      .references(() => players.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** Citizens at refTime of the city's resource rows. */
    population: integer('population').notNull().default(0),
    /** Next citizen arrival; null while housing is full. */
    nextArrivalAt: timestamp('next_arrival_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [index('cities_player_idx').on(table.playerId)]
);

export const cityResources = pgTable(
  'city_resources',
  {
    cityId: uuid('city_id')
      .notNull()
      .references(() => cities.id, { onDelete: 'cascade' }),
    resource: text('resource').notNull(),
    /** Integer amount at refTime. All of a city's rows share one refTime. */
    amountAtRef: bigint('amount_at_ref', { mode: 'number' }).notNull(),
    refTime: timestamp('ref_time', { withTimezone: true }).notNull()
  },
  (table) => [primaryKey({ columns: [table.cityId, table.resource] })]
);

export const cityBuildings = pgTable(
  'city_buildings',
  {
    cityId: uuid('city_id')
      .notNull()
      .references(() => cities.id, { onDelete: 'cascade' }),
    buildingId: text('building_id').notNull(),
    level: integer('level').notNull(),
    /** Workers assigned to this building (0 for non-production buildings). */
    workers: integer('workers').notNull().default(0)
  },
  (table) => [primaryKey({ columns: [table.cityId, table.buildingId] })]
);

export const constructionStatus = pgEnum('construction_status', [
  'QUEUED',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED'
]);

export const constructionOrders = pgTable(
  'construction_orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    cityId: uuid('city_id')
      .notNull()
      .references(() => cities.id, { onDelete: 'cascade' }),
    buildingId: text('building_id').notNull(),
    targetLevel: integer('target_level').notNull(),
    status: constructionStatus('status').notNull(),
    queuePosition: integer('queue_position').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completesAt: timestamp('completes_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [index('construction_city_status_idx').on(table.cityId, table.status)]
);
