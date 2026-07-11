import { createHash, randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import { eq } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import { players, sessions } from '../../db/schema.js';
import type { Clock } from '../../lib/clock.js';
import { AppError } from '../../lib/errors.js';
import { foundFirstCity } from '../cities/service.js';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface AuthResult {
  playerId: string;
  username: string;
  sessionToken: string;
  sessionExpiresAt: Date;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function registerPlayer(
  db: Database,
  clock: Clock,
  username: string,
  password: string
): Promise<AuthResult> {
  // Session TTL tracks real wall-clock time, not the injectable game-time
  // clock: fast-forwarding simulated time in tests must not expire sessions.
  const passwordHash = await argon2.hash(password);
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  return db.transaction(async (tx) => {
    const existing = await tx.select({ id: players.id }).from(players).where(eq(players.username, username));
    if (existing.length > 0) {
      throw new AppError('CONFLICT', 'Username is already taken');
    }
    const [player] = await tx
      .insert(players)
      .values({ username, passwordHash })
      .returning({ id: players.id });
    if (!player) throw new AppError('INTERNAL', 'Failed to create player');

    await foundFirstCity(tx, player.id, `${username}'s Settlement`, clock.now());

    await tx.insert(sessions).values({
      tokenHash: hashToken(token),
      playerId: player.id,
      expiresAt
    });

    return { playerId: player.id, username, sessionToken: token, sessionExpiresAt: expiresAt };
  });
}

export async function loginPlayer(
  db: Database,
  username: string,
  password: string
): Promise<AuthResult> {
  const [player] = await db.select().from(players).where(eq(players.username, username));
  // Verify against a dummy hash when the user does not exist to keep timing uniform.
  const hashToVerify =
    player?.passwordHash ??
    '$argon2id$v=19$m=65536,t=3,p=4$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  let valid = false;
  try {
    valid = await argon2.verify(hashToVerify, password);
  } catch {
    valid = false;
  }
  if (!player || !valid) {
    throw new AppError('UNAUTHENTICATED', 'Invalid username or password');
  }

  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.insert(sessions).values({
    tokenHash: hashToken(token),
    playerId: player.id,
    expiresAt
  });

  return { playerId: player.id, username: player.username, sessionToken: token, sessionExpiresAt: expiresAt };
}

export async function logoutSession(db: Database, token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
}

export interface SessionPlayer {
  playerId: string;
  username: string;
}

export async function resolveSession(
  db: Database,
  token: string
): Promise<SessionPlayer | null> {
  const [row] = await db
    .select({
      playerId: sessions.playerId,
      expiresAt: sessions.expiresAt,
      username: players.username
    })
    .from(sessions)
    .innerJoin(players, eq(players.id, sessions.playerId))
    .where(eq(sessions.tokenHash, hashToken(token)));

  if (!row) return null;
  if (row.expiresAt.getTime() <= Date.now()) {
    await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
    return null;
  }
  return { playerId: row.playerId, username: row.username };
}
