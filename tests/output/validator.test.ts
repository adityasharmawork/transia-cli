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
});
