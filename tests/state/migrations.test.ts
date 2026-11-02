import { describe, it, expect } from "vitest";
import { migrateState } from "../../src/state/migrations";
import { TransiaError, ExitCode } from "../../src/utils/errors";

const v1State = () => ({
  version: 1,
  lastRun: "2026-11-02T00:00:00.000Z",
  strings: {
    h1: {
      original: "Hello",
      context: null,
      sources: ["app/page.tsx:3"],
      translations: {
        es: { value: "Hola", translatedAt: "2026-11-02T00:00:00.000Z", provider: "gemini" },
      },
    },
  },
});

describe("migrateState v1 -> v2", () => {
  it("migrates a v1 state to v2 and preserves provider provenance", () => {
    const migrated = migrateState(v1State());
    expect(migrated.version).toBe(2);
    expect(migrated.strings.h1.translations.es?.provider).toBe("gemini");
    expect(migrated.strings.h1.translations.es?.value).toBe("Hola");
  });

  it("is idempotent: a v2 state migrates to the same v2 state", () => {
    const once = migrateState(v1State());
    const twice = migrateState(once as unknown as Record<string, unknown>);
    expect(twice).toEqual(once);
  });

  it("throws when the state version is newer than this CLI supports", () => {
    const future = { ...v1State(), version: 3 };
    let caught: unknown;
    try {
      migrateState(future);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(TransiaError);
    expect((caught as TransiaError).code).toBe(ExitCode.STATE_ERROR);
  });
});
