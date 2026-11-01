import { describe, it, expect } from "vitest";
import { shouldPromptInteractively } from "../src/utils/tty";

describe("shouldPromptInteractively", () => {
  it("is interactive only on a real TTY without --yes", () => {
    expect(shouldPromptInteractively(false, true)).toBe(true);
    expect(shouldPromptInteractively(undefined, true)).toBe(true);
  });
  it("is NON-interactive when stdin is piped (isTTY undefined) — the CI-crash fix", () => {
    expect(shouldPromptInteractively(false, undefined)).toBe(false);
    expect(shouldPromptInteractively(undefined, undefined)).toBe(false);
  });
  it("is NON-interactive when stdin is a non-TTY (false)", () => {
    expect(shouldPromptInteractively(false, false)).toBe(false);
  });
  it("--yes always forces non-interactive", () => {
    expect(shouldPromptInteractively(true, true)).toBe(false);
  });
});
