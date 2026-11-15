import { describe, it, expect } from "vitest";
import { buildPromptForRequest } from "../../src/ai/provider";

describe("buildPromptForRequest forwards translation controls", () => {
  it("passes glossary, do-not-translate, and formality from the request into the prompt", () => {
    const { system } = buildPromptForRequest({
      strings: [{ key: "k", original: "Sign up now", context: null }],
      sourceLocale: "en",
      targetLocale: "es",
      glossary: { "Sign up": "Regístrate" },
      doNotTranslate: ["Transia"],
      formality: "formal",
    });
    expect(system).toContain("Regístrate");
    expect(system).toContain("Transia");
    expect(system).toMatch(/formal register/i);
  });

  it("works with no translation controls (backward compatible)", () => {
    const { system, user } = buildPromptForRequest({
      strings: [{ key: "k", original: "Hello", context: null }],
      sourceLocale: "en",
      targetLocale: "es",
    });
    expect(system).toMatch(/JSON/);
    expect(user).toContain("Hello");
  });
});
