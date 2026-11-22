import { describe, it, expect } from "vitest";
import { isExcludedAttribute } from "../../src/parser/attributes";

describe("isExcludedAttribute — structural attributes (E2E finding F2)", () => {
  // lang is set from the active locale (<html lang={locale}>), not translated —
  // extracting it produced <html lang={t("en_...")}> in the E2E.
  it("excludes the lang attribute", () => {
    expect(isExcludedAttribute("lang")).toBe(true);
  });

  it("keeps other structural attributes excluded", () => {
    for (const a of ["dir", "charSet", "href", "className", "id", "role"]) {
      expect(isExcludedAttribute(a)).toBe(true);
    }
  });

  it("still translates user-facing attributes", () => {
    for (const a of ["placeholder", "title", "alt", "aria-label", "label"]) {
      expect(isExcludedAttribute(a)).toBe(false);
    }
  });
});
