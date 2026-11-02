import { describe, it, expect } from "vitest";
import { validateTranslation } from "../../src/output/validator";

describe("validateTranslation — placeholder & brace integrity", () => {
  it("rejects a translation that drops a placeholder (error, not warning)", () => {
    const r = validateTranslation("k", "Hi {name}", "Hola");
    expect(r.valid).toBe(false);
    expect(r.errors.join(" ")).toMatch(/name/);
  });

  it("rejects a translation that adds a placeholder not in the original", () => {
    const r = validateTranslation("k", "Hello", "Hola {x}");
    expect(r.valid).toBe(false);
  });

  it("allows placeholder reordering (same multiset)", () => {
    const r = validateTranslation("k", "{a} and {b}", "{b} y {a}");
    expect(r.valid).toBe(true);
  });

  it("rejects unbalanced braces", () => {
    const r = validateTranslation("k", "Hi {name}", "Hola {name");
    expect(r.valid).toBe(false);
  });

  it("passes a clean translation with matching placeholders", () => {
    const r = validateTranslation("k", "Hi {name}", "Hola {name}");
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it("accepts a correctly translated ICU plural (compares top-level arg, not sub-messages)", () => {
    const r = validateTranslation(
      "k",
      "{count, plural, one {# item} other {# items}}",
      "{count, plural, one {# artículo} other {# artículos}}",
    );
    expect(r.valid).toBe(true);
  });

  it("rejects an ICU plural that drops the top-level argument", () => {
    const r = validateTranslation(
      "k",
      "{count, plural, one {# item} other {# items}}",
      "varios artículos",
    );
    expect(r.valid).toBe(false);
  });

  it("rejects misnested braces even when open/close counts match", () => {
    const r = validateTranslation("k", "hello", "}name{");
    expect(r.valid).toBe(false);
  });
});
