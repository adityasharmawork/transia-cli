import { describe, it, expect } from "vitest";
import { DEFAULT_MODEL } from "../../src/ai/gemini";

describe("Gemini default model (E2E finding F1)", () => {
  // gemini-2.0-flash 404s on current free-tier keys (Google moved to 2.5/3.x).
  // Default to a floating alias so the default never goes stale again.
  it("uses a floating -latest alias, not a pinned version", () => {
    expect(DEFAULT_MODEL).toMatch(/-latest$/);
  });

  it("is not the stale gemini-2.0-flash", () => {
    expect(DEFAULT_MODEL).not.toBe("gemini-2.0-flash");
  });
});
