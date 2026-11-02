import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serializeCatalogs } from "../../src/output/formats";
import { readCatalogs } from "../../src/output/reader";

const cat = (obj: Record<string, Record<string, string>>) => new Map(Object.entries(obj));

describe("i18next interpolation", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "transia-i18n-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("serialize converts single-brace {name} to i18next {{name}} in values", () => {
    const files = serializeCatalogs(cat({ en: { greeting: "Hi {name}" } }), dir, "i18next");
    const parsed = JSON.parse(files[0].content);
    expect(parsed.greeting).toBe("Hi {{name}}");
  });

  it("read converts i18next {{name}} back to single-brace {name}", () => {
    mkdirSync(join(dir, "en"), { recursive: true });
    writeFileSync(join(dir, "en", "translation.json"), JSON.stringify({ greeting: "Hi {{name}}" }));
    const catalogs = readCatalogs(dir, "i18next", ["en"]);
    expect(catalogs.get("en")).toEqual({ greeting: "Hi {name}" });
  });

  it("write→read round-trips a message with interpolation to single-brace", () => {
    const files = serializeCatalogs(cat({ en: { msg: "You have {count} items" } }), dir, "i18next");
    mkdirSync(join(dir, "en"), { recursive: true });
    writeFileSync(join(dir, "en", "translation.json"), files[0].content);
    const back = readCatalogs(dir, "i18next", ["en"]);
    expect(back.get("en")).toEqual({ msg: "You have {count} items" });
  });

  it("next-intl values keep single-brace {name} unchanged", () => {
    const files = serializeCatalogs(cat({ en: { greeting: "Hi {name}" } }), dir, "next-intl");
    const parsed = JSON.parse(files[0].content);
    expect(parsed.greeting).toBe("Hi {name}");
  });
});
