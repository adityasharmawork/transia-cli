import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { writeMergedCatalogs } from "../../src/output/formats";
import { generateKey } from "../../src/utils/crypto";
import type { TransiaConfig, TransiaState } from "../../src/state/schema";

const HASH = "deadbeefcafe";
const ORIGINAL = "Hello";
const KEY = generateKey(ORIGINAL, HASH);

function makeConfig(): TransiaConfig {
  return {
    version: 2,
    sourceLocale: "en",
    targetLocales: ["es"],
    provider: { name: "gemini" },
    include: ["**/*.tsx"],
    exclude: [],
    output: { format: "next-intl", path: "locales" },
  };
}

function makeState(): TransiaState {
  return {
    version: 2,
    lastRun: "2026-11-02T00:00:00.000Z",
    strings: {
      [HASH]: {
        original: ORIGINAL,
        context: null,
        sources: ["app/page.tsx:3"],
        translations: {
          es: { value: "Hola (auto)", translatedAt: "2026-11-02T00:00:00.000Z", provider: "gemini" },
        },
      },
    },
  };
}

describe("writeMergedCatalogs", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "transia-writemerge-"));
    mkdirSync(join(root, "locales"), { recursive: true });
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const readEs = () =>
    JSON.parse(readFileSync(resolve(root, "locales", "es.json"), "utf-8"));

  it("preserves a hand-edited value instead of regenerating it (force off)", () => {
    writeFileSync(
      resolve(root, "locales", "es.json"),
      JSON.stringify({ [KEY]: "Hola (MANUAL)" }),
    );
    writeMergedCatalogs(root, makeState(), makeConfig(), ["es"], { force: false, prune: false });
    expect(readEs()[KEY]).toBe("Hola (MANUAL)");
  });

  it("overwrites with the generated value when force is set", () => {
    writeFileSync(
      resolve(root, "locales", "es.json"),
      JSON.stringify({ [KEY]: "Hola (MANUAL)" }),
    );
    writeMergedCatalogs(root, makeState(), makeConfig(), ["es"], { force: true, prune: false });
    expect(readEs()[KEY]).toBe("Hola (auto)");
  });

  it("keeps an orphan key (present on disk, absent from state) unless prune", () => {
    writeFileSync(
      resolve(root, "locales", "es.json"),
      JSON.stringify({ [KEY]: "Hola (MANUAL)", "old.orphan": "viejo" }),
    );
    writeMergedCatalogs(root, makeState(), makeConfig(), ["es"], { force: false, prune: false });
    expect(readEs()["old.orphan"]).toBe("viejo");
  });
});
