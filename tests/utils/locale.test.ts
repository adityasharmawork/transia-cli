import { describe, it, expect } from "vitest";
import { isValidLocale } from "../../src/utils/locale";

describe("isValidLocale", () => {
  it("accepts valid BCP-47 tags including script and UN-region subtags", () => {
    for (const tag of ["en", "es", "en-US", "pt-BR", "zh-Hans", "es-419", "zh-Hant-TW"]) {
      expect(isValidLocale(tag)).toBe(true);
    }
  });

  it("rejects empty, malformed, or whitespace-padded tags", () => {
    for (const tag of ["", "   ", "a/b", "en ", " en", "en_US!!"]) {
      expect(isValidLocale(tag)).toBe(false);
    }
  });
});
