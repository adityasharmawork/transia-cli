import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadProjectEnv } from "../src/utils/env";

describe("loadProjectEnv", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "transia-env-")); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); delete process.env.TRANSIA_TEST_KEY; });

  it("loads .env.local into process.env (managed-mode key is now visible)", () => {
    writeFileSync(join(dir, ".env.local"), "TRANSIA_TEST_KEY=from_env_local\n");
    const loaded = loadProjectEnv(dir);
    expect(loaded).toContain(".env.local");
    expect(process.env.TRANSIA_TEST_KEY).toBe("from_env_local");
  });
  it("returns an empty list when no env files exist (no throw)", () => {
    expect(loadProjectEnv(dir)).toEqual([]);
  });
});
