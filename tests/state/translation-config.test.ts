import { describe, it, expect } from "vitest";
import { TransiaConfigSchema } from "../../src/state/schema";

const base = {
  version: 2,
  sourceLocale: "en",
  targetLocales: ["es"],
  provider: { name: "gemini" },
  include: ["**/*.tsx"],
  exclude: [],
  output: { format: "next-intl", path: "locales" },
};

describe("config translation block", () => {
  it("accepts a translation block with glossary, doNotTranslate, formality", () => {
    const parsed = TransiaConfigSchema.parse({
      ...base,
      translation: {
        glossary: { "Sign up": "Regístrate" },
        doNotTranslate: ["Transia", "GitHub"],
        formality: "formal",
      },
    });
    expect(parsed.translation?.glossary?.["Sign up"]).toBe("Regístrate");
    expect(parsed.translation?.doNotTranslate).toContain("Transia");
    expect(parsed.translation?.formality).toBe("formal");
  });

  it("validates a config with no translation block (backward compatible)", () => {
    expect(() => TransiaConfigSchema.parse(base)).not.toThrow();
  });

  it("rejects an invalid formality value", () => {
    expect(() =>
      TransiaConfigSchema.parse({ ...base, translation: { formality: "super-formal" } }),
    ).toThrow();
  });
});
