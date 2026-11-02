import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readCatalogs } from "../../src/output/reader";
import { TransiaError, ExitCode } from "../../src/utils/errors";

describe("readCatalogs", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "transia-reader-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("reads next-intl flat json into a key→value map", () => {
    writeFileSync(
      join(dir, "en.json"),
      JSON.stringify({ "greeting.hello": "Hello" }),
    );
    const catalogs = readCatalogs(dir, "next-intl", ["en"]);
    expect(catalogs.get("en")).toEqual({ "greeting.hello": "Hello" });
  });

  it("flattens i18next nested json back to dot keys", () => {
    mkdirSync(join(dir, "en"), { recursive: true });
    writeFileSync(
      join(dir, "en", "translation.json"),
      JSON.stringify({ greeting: { hello: "Hola" } }),
    );
    const catalogs = readCatalogs(dir, "i18next", ["en"]);
    expect(catalogs.get("en")).toEqual({ "greeting.hello": "Hola" });
  });

  it("yields an empty map for a missing locale file instead of throwing", () => {
    const catalogs = readCatalogs(dir, "next-intl", ["fr"]);
    expect(catalogs.get("fr")).toEqual({});
  });

  it("throws TransiaError STATE_ERROR naming the path on malformed json", () => {
    const bad = join(dir, "es.json");
    writeFileSync(bad, "{ not valid json");
    let caught: unknown;
    try {
      readCatalogs(dir, "next-intl", ["es"]);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(TransiaError);
    expect((caught as TransiaError).code).toBe(ExitCode.STATE_ERROR);
    expect((caught as TransiaError).message).toContain(bad);
  });
});
