import { describe, it, expect } from "vitest";
import { isTranslatableString } from "../../src/parser/filters";

describe("isTranslatableString — email addresses (E2E finding F6)", () => {
  // A bare email (e.g. an example placeholder like you@company.com) is data, not
  // prose — translating it corrupts it (es turned it into tu@empresa.com).
  it("skips a bare email address", () => {
    expect(isTranslatableString("you@company.com")).toBe(false);
    expect(isTranslatableString("name.surname@example.co.uk")).toBe(false);
  });

  it("still translates prose that merely CONTAINS an email", () => {
    expect(isTranslatableString("Email us at support@acme.com for help")).toBe(true);
  });

  it("still translates ordinary prose", () => {
    expect(isTranslatableString("Create your account")).toBe(true);
    expect(isTranslatableString("Already have an account?")).toBe(true);
  });
});
