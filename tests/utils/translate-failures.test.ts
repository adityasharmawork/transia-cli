import { describe, it, expect } from "vitest";
import { summarizeBatchFailures } from "../../src/utils/translate-failures";

describe("summarizeBatchFailures", () => {
  it("returns empty string for no failures", () => {
    expect(summarizeBatchFailures([])).toBe("");
  });

  it("dedupes identical messages", () => {
    const out = summarizeBatchFailures(["401 Unauthorized", "401 Unauthorized", "401 Unauthorized"]);
    expect(out).toBe("- 401 Unauthorized");
  });

  it("caps distinct reasons and reports the remainder", () => {
    const out = summarizeBatchFailures(["a", "b", "c", "d", "e"], 3);
    expect(out).toContain("- a");
    expect(out).toContain("- c");
    expect(out).not.toContain("- d");
    expect(out).toContain("(+2 more)");
  });

  it("collapses whitespace and truncates long messages", () => {
    const long = "x".repeat(300);
    const out = summarizeBatchFailures([`  too   long:\n${long}`], 3, 40);
    expect(out.length).toBeLessThan(60);
    expect(out).toContain("…");
    expect(out).not.toContain("\n  ");
  });
});
