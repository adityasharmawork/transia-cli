import { describe, it, expect } from "vitest";
import { buildTranslationPrompt } from "../../src/ai/prompts";

const base = {
  sourceLocale: "en",
  targetLocale: "es",
  strings: [{ key: "k1", original: "Sign up now" }],
};

describe("buildTranslationPrompt — glossary, do-not-translate, formality", () => {
  it("includes glossary terms and their required translations", () => {
    const { system } = buildTranslationPrompt({
      ...base,
      glossary: { "Sign up": "Regístrate" },
    });
    expect(system).toContain("Sign up");
    expect(system).toContain("Regístrate");
    expect(system).toMatch(/consisten|glossary|exact/i);
  });

  it("lists do-not-translate terms to keep verbatim", () => {
    const { system } = buildTranslationPrompt({ ...base, doNotTranslate: ["Transia", "GitHub"] });
    expect(system).toContain("Transia");
    expect(system).toContain("GitHub");
    expect(system).toMatch(/do not translate|unchanged|verbatim/i);
  });

  it("adds a formal-register instruction when formality=formal, none when omitted", () => {
    expect(buildTranslationPrompt({ ...base, formality: "formal" }).system).toMatch(
      /formal register/i,
    );
    expect(buildTranslationPrompt(base).system).not.toMatch(/formal register/i);
  });

  it("still returns a JSON-only instruction and includes the strings to translate", () => {
    const { system, user } = buildTranslationPrompt(base);
    expect(system).toMatch(/JSON/);
    expect(user).toContain("Sign up now");
  });
});
