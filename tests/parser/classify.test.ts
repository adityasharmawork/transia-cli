import { describe, it, expect } from "vitest";
import { isLikelyUserFacing } from "../../src/parser/classify";
import type { Candidate } from "../../src/parser/candidates";

const mk = (over: Partial<Candidate>): Candidate => ({
  start: 0,
  end: 0,
  role: "jsx-text",
  insideComparison: false,
  sanitized: "Some copy",
  hash: "h",
  componentPath: "0",
  context: null,
  line: 1,
  ...over,
});

describe("isLikelyUserFacing", () => {
  it("rejects a string used in a comparison", () => {
    expect(isLikelyUserFacing(mk({ insideComparison: true }), [])).toBe(false);
  });

  it("rejects a string inside a styling helper (cn/clsx)", () => {
    expect(isLikelyUserFacing(mk({ insideCall: "cn" }), [])).toBe(false);
    expect(isLikelyUserFacing(mk({ insideCall: "clsx" }), [])).toBe(false);
  });

  it("rejects a string consumed by a predicate call (includes/startsWith/...)", () => {
    expect(isLikelyUserFacing(mk({ insideCall: "includes" }), [])).toBe(false);
    expect(isLikelyUserFacing(mk({ insideCall: "startsWith" }), [])).toBe(false);
    expect(isLikelyUserFacing(mk({ insideCall: "indexOf" }), [])).toBe(false);
  });

  it("rejects a string already inside a t() call (idempotency)", () => {
    expect(isLikelyUserFacing(mk({ insideCall: "t" }), [])).toBe(false);
  });

  it("rejects a deny-listed attribute value", () => {
    expect(isLikelyUserFacing(mk({ role: "jsx-attr", attribute: "className" }), [])).toBe(false);
    expect(isLikelyUserFacing(mk({ role: "jsx-attr", attribute: "href" }), [])).toBe(false);
  });

  it("accepts plain JSX text and copy-bearing attributes", () => {
    expect(isLikelyUserFacing(mk({ role: "jsx-text", sanitized: "Welcome back" }), [])).toBe(true);
    expect(isLikelyUserFacing(mk({ role: "jsx-attr", attribute: "alt" }), [])).toBe(true);
    expect(isLikelyUserFacing(mk({ role: "jsx-attr", attribute: "placeholder" }), [])).toBe(true);
  });

  it("accepts a custom (non-deny-listed) attribute under the max-coverage deny-list", () => {
    expect(isLikelyUserFacing(mk({ role: "jsx-attr", attribute: "tooltip" }), [])).toBe(true);
  });

  it("honors a user-supplied excludeAttributes entry", () => {
    expect(isLikelyUserFacing(mk({ role: "jsx-attr", attribute: "tooltip" }), ["tooltip"])).toBe(false);
  });
});
