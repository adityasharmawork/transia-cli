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

describe("locale canonicalization", () => {
  it("canonicalizes a target locale's case (EN -> en)", () => {
    const parsed = TransiaConfigSchema.parse({ ...base, targetLocales: ["EN"] });
    // Canonical form prevents a second output dir that only differs by case —
    // which collides with the first on a case-insensitive filesystem (macOS).
    expect(parsed.targetLocales).toEqual(["en"]);
  });

  it("canonicalizes region/script subtags (es-mx -> es-MX, zh-hans -> zh-Hans)", () => {
    const parsed = TransiaConfigSchema.parse({
      ...base,
      targetLocales: ["es-mx", "zh-hans"],
    });
    expect(parsed.targetLocales).toEqual(["es-MX", "zh-Hans"]);
  });

  it("rejects tags that canonicalize to the same locale (en + EN)", () => {
    expect(() =>
      TransiaConfigSchema.parse({ ...base, targetLocales: ["en", "EN"] }),
    ).toThrow(/duplicate/i);
  });

  it("keeps genuinely distinct locales (en, en-US)", () => {
    const parsed = TransiaConfigSchema.parse({
      ...base,
      targetLocales: ["en", "en-US"],
    });
    expect(parsed.targetLocales).toEqual(["en", "en-US"]);
  });

  it("canonicalizes the source locale too (EN -> en)", () => {
    const parsed = TransiaConfigSchema.parse({ ...base, sourceLocale: "EN" });
    expect(parsed.sourceLocale).toBe("en");
  });
});
