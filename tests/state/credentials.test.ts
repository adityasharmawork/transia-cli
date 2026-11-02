import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  saveCredentials,
  loadCredentials,
  encrypt,
  legacyDeriveKey,
} from "../../src/state/credentials";

const CREDS = { authToken: "tok", email: "u@example.com", apiUrl: "https://transia.dev" };

describe("credentials — hostname-free key + legacy migration", () => {
  let home: string;
  let prevHome: string | undefined;

  beforeEach(() => {
    prevHome = process.env.HOME;
    home = mkdtempSync(join(tmpdir(), "transia-creds-"));
    process.env.HOME = home;
  });
  afterEach(() => {
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    rmSync(home, { recursive: true, force: true });
  });

  it("round-trips save → load", () => {
    saveCredentials(CREDS);
    expect(loadCredentials()).toEqual(CREDS);
  });

  it("loads a file encrypted with the legacy (hostname) key and migrates it", () => {
    const dir = join(home, ".transia");
    mkdirSync(dir, { recursive: true });
    const legacyPayload = encrypt(JSON.stringify(CREDS), legacyDeriveKey());
    writeFileSync(join(dir, "credentials.json"), JSON.stringify(legacyPayload));

    // First load decrypts via the legacy fallback and re-saves with the new key…
    expect(loadCredentials()).toEqual(CREDS);
    // …so a second load succeeds too (now stored under the hostname-free key).
    expect(loadCredentials()).toEqual(CREDS);
  });
});
