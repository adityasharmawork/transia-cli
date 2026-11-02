import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyCommand } from "../../src/commands/apply";
import { recordCandidates } from "../../src/parser/candidates";

describe("applyCommand end-to-end (real files, config, state, backup, undo)", () => {
  let root: string;
  const component = `export function Page() {\n  return <p>Hello world</p>;\n}\n`;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "transia-apply-e2e-"));

    writeFileSync(
      join(root, "transia.config.json"),
      JSON.stringify({
        version: 2,
        sourceLocale: "en",
        targetLocales: ["es"],
        provider: { name: "gemini" },
        include: ["**/*.tsx"],
        exclude: [],
        output: { format: "next-intl", path: "locales" },
      }),
    );

    // Derive the hash the recorder produces for "Hello world" so state matches.
    const hash = recordCandidates(component, "page.tsx").find(
      (c) => c.sanitized === "Hello world",
    )!.hash;

    writeFileSync(
      join(root, ".transia-state.json"),
      JSON.stringify({
        version: 2,
        lastRun: "2026-11-02T00:00:00.000Z",
        strings: {
          [hash]: {
            original: "Hello world",
            context: null,
            sources: ["page.tsx:2"],
            translations: {
              es: { value: "Hola mundo", translatedAt: "2026-11-02T00:00:00.000Z", provider: "test" },
            },
          },
        },
      }),
    );

    writeFileSync(join(root, "page.tsx"), component);
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("wraps the translated string, backs up the original, and undoes cleanly", async () => {
    await applyCommand(root, { typecheck: false });

    const after = readFileSync(join(root, "page.tsx"), "utf-8");
    expect(after).toContain("useTranslations");
    expect(after).toMatch(/\{t\("[^"]+"\)\}/);
    expect(after).not.toContain("<p>Hello world</p>");
    expect(existsSync(join(root, ".transia-backup"))).toBe(true);

    await applyCommand(root, { undo: true });
    expect(readFileSync(join(root, "page.tsx"), "utf-8")).toBe(component);
  });
});
