import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("../../src/state/credentials", () => ({
  loadCredentials: () => null, // no stored login
}));
vi.mock("../../src/api/client", () => ({
  verifyAuth: vi.fn(async () => ({ valid: true, email: "ci@example.com" })),
}));

import { requireAuth } from "../../src/api/auth-guard";

describe("requireAuth with TRANSIA_TOKEN", () => {
  afterEach(() => {
    delete process.env.TRANSIA_TOKEN;
  });

  it("succeeds with TRANSIA_TOKEN set even without stored credentials", async () => {
    process.env.TRANSIA_TOKEN = "ci-tok";
    await expect(requireAuth()).resolves.toBeUndefined();
  });

  it("throws 'not logged in' when there are no credentials and no TRANSIA_TOKEN", async () => {
    delete process.env.TRANSIA_TOKEN;
    await expect(requireAuth()).rejects.toThrow(/not logged in/i);
  });
});
