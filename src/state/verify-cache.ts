/**
 * Verification cache — records that the server confirmed the current session, so
 * repeated commands within a 72h window don't re-hit `POST /api/auth/verify` and
 * so the CLI keeps working offline for local-capable work.
 *
 * Stored next to the credentials (`~/.transia/verify-cache.json`, mode 0600,
 * `homedir()`-based so tests isolate via `$HOME`). Holds only a timestamp + the
 * email it was verified for — it is a *cache*, never an authority: the real
 * credential still gates every call, and any operation that genuinely needs the
 * network surfaces its own error.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

/** Trust a server confirmation for this long before re-verifying. */
const TTL_MS = 72 * 60 * 60 * 1000;

export interface VerifyCache {
  v: 1;
  /** ISO-8601 timestamp of the last successful `verifyAuth()`. */
  verifiedAt: string;
  /** Email the verification was for — a mismatch forces a re-verify. */
  email: string;
}

function transiaDir(): string {
  const dir = join(homedir(), ".transia");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

function cachePath(): string {
  return join(transiaDir(), "verify-cache.json");
}

/**
 * Pure: is `cache` a fresh hit for `email` as of `now`? Fresh ⇔ the cache exists,
 * was written for the same email, has a parseable timestamp, and is within the TTL.
 */
export function isFresh(
  cache: VerifyCache | null,
  email: string,
  now: Date = new Date(),
): boolean {
  if (!cache || cache.email !== email) return false;
  const verifiedAt = Date.parse(cache.verifiedAt);
  if (Number.isNaN(verifiedAt)) return false;
  return now.getTime() - verifiedAt < TTL_MS;
}

export function readVerifyCache(): VerifyCache | null {
  const path = cachePath();
  if (!existsSync(path)) return null;
  try {
    const data = JSON.parse(readFileSync(path, "utf-8"));
    if (
      data &&
      data.v === 1 &&
      typeof data.verifiedAt === "string" &&
      typeof data.email === "string"
    ) {
      return data as VerifyCache;
    }
    return null;
  } catch {
    return null;
  }
}

/** Record a successful verification. Best-effort — a failed write never blocks. */
export function recordVerification(email: string, now: Date = new Date()): void {
  const payload: VerifyCache = { v: 1, verifiedAt: now.toISOString(), email };
  try {
    writeFileSync(cachePath(), JSON.stringify(payload), { mode: 0o600 });
  } catch {
    // A cache write failure (e.g. read-only HOME) must never block the command.
  }
}

export function isVerificationFresh(email: string, now: Date = new Date()): boolean {
  return isFresh(readVerifyCache(), email, now);
}

/** Drop the cache (e.g. on logout) so the next command re-verifies. Best-effort. */
export function clearVerificationCache(): void {
  const path = cachePath();
  try {
    if (existsSync(path)) unlinkSync(path);
  } catch {
    // Best-effort.
  }
}
