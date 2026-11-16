import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  isFresh,
  recordVerification,
  isVerificationFresh,
  clearVerificationCache,
  readVerifyCache,
  type VerifyCache,
} from "../../src/state/verify-cache";

const TTL_MS = 72 * 60 * 60 * 1000;
const EMAIL = "u@example.com";

describe("verify-cache — pure isFresh", () => {
  const base: VerifyCache = { v: 1, verifiedAt: "2026-01-01T00:00:00.000Z", email: EMAIL };
  const at = (cache: VerifyCache, offsetMs: number) =>
    new Date(Date.parse(cache.verifiedAt) + offsetMs);

  it("is fresh just under the 72h window", () => {
    expect(isFresh(base, EMAIL, at(base, TTL_MS - 1000))).toBe(true);
  });

  it("is stale at/after the 72h window", () => {
    expect(isFresh(base, EMAIL, at(base, TTL_MS))).toBe(false);
    expect(isFresh(base, EMAIL, at(base, TTL_MS + 60_000))).toBe(false);
  });

  it("is a miss when the email differs (account switch)", () => {
    expect(isFresh(base, "other@example.com", at(base, 0))).toBe(false);
  });

  it("is a miss for a null or malformed cache", () => {
    expect(isFresh(null, EMAIL, new Date())).toBe(false);
    expect(isFresh({ v: 1, verifiedAt: "not-a-date", email: EMAIL }, EMAIL, new Date())).toBe(false);
  });

  it("treats a FUTURE timestamp as stale (tampered file / clock moved back)", () => {
    expect(isFresh(base, EMAIL, at(base, -1000))).toBe(false); // now is before verifiedAt
    expect(isFresh(base, EMAIL, at(base, -TTL_MS * 10))).toBe(false);
  });
});

describe("verify-cache — fs round-trip (isolated $HOME)", () => {
  let home: string;
  let prevHome: string | undefined;

  beforeEach(() => {
    prevHome = process.env.HOME;
    home = mkdtempSync(join(tmpdir(), "transia-verify-"));
    process.env.HOME = home;
  });
  afterEach(() => {
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    rmSync(home, { recursive: true, force: true });
  });

  it("records a verification and reads it back as fresh", () => {
    expect(isVerificationFresh(EMAIL)).toBe(false); // nothing written yet
    recordVerification(EMAIL);
    expect(isVerificationFresh(EMAIL)).toBe(true);
    const cache = readVerifyCache();
    expect(cache?.email).toBe(EMAIL);
    expect(cache?.v).toBe(1);
    expect(Number.isNaN(Date.parse(cache!.verifiedAt))).toBe(false);
  });

  it("clearVerificationCache removes the marker", () => {
    recordVerification(EMAIL);
    expect(isVerificationFresh(EMAIL)).toBe(true);
    clearVerificationCache();
    expect(isVerificationFresh(EMAIL)).toBe(false);
    expect(readVerifyCache()).toBeNull();
  });

  it("clearVerificationCache is a no-op when nothing was written", () => {
    expect(() => clearVerificationCache()).not.toThrow();
  });

  it("a recorded verification goes stale once the clock passes 72h", () => {
    recordVerification(EMAIL, new Date("2026-01-01T00:00:00.000Z"));
    expect(isVerificationFresh(EMAIL, new Date("2026-01-03T23:59:00.000Z"))).toBe(true); // < 72h
    expect(isVerificationFresh(EMAIL, new Date("2026-01-04T01:00:00.000Z"))).toBe(false); // > 72h
  });
});
