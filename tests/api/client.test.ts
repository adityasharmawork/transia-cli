import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../src/state/credentials", () => ({
  loadCredentials: () => ({
    authToken: "secret-token",
    email: "u@example.com",
    apiUrl: "https://transia.dev",
  }),
}));

import { apiRequest } from "../../src/api/client";

function mockFetch() {
  const fn = vi.fn(async () =>
    new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("apiRequest — origin pinning, redirects, timeout", () => {
  beforeEach(() => {
    delete process.env.TRANSIA_API_URL;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.TRANSIA_API_URL;
    delete process.env.TRANSIA_TOKEN;
  });

  it("uses TRANSIA_TOKEN as the bearer when set (CI auth)", async () => {
    process.env.TRANSIA_TOKEN = "ci-tok";
    const fetchFn = mockFetch();
    await apiRequest("/api/verify", { method: "POST", auth: true });
    const opts = fetchFn.mock.calls[0][1] as RequestInit;
    expect((opts.headers as Record<string, string>)["Authorization"]).toBe("Bearer ci-tok");
  });

  it("ignores a non-localhost TRANSIA_API_URL for an authenticated request", async () => {
    process.env.TRANSIA_API_URL = "https://evil.example";
    const fetchFn = mockFetch();
    await apiRequest("/api/verify", { method: "POST", auth: true });
    const calledUrl = fetchFn.mock.calls[0][0] as string;
    expect(calledUrl.startsWith("https://transia.dev")).toBe(true);
    expect(calledUrl).not.toContain("evil.example");
  });

  it("honors a localhost TRANSIA_API_URL for dev", async () => {
    process.env.TRANSIA_API_URL = "http://localhost:3000";
    const fetchFn = mockFetch();
    await apiRequest("/api/verify", { method: "POST", auth: true });
    const calledUrl = fetchFn.mock.calls[0][0] as string;
    expect(calledUrl.startsWith("http://localhost:3000")).toBe(true);
  });

  it("ignores a hostname that merely contains 'localhost' as a substring (no bypass)", async () => {
    process.env.TRANSIA_API_URL = "https://localhost.evil.com";
    const fetchFn = mockFetch();
    await apiRequest("/api/verify", { method: "POST", auth: true });
    const calledUrl = fetchFn.mock.calls[0][0] as string;
    expect(calledUrl.startsWith("https://transia.dev")).toBe(true);
    expect(calledUrl).not.toContain("evil.com");
  });

  it("ignores 'localhost' appearing only in the path (no bypass)", async () => {
    process.env.TRANSIA_API_URL = "https://evil.com/localhost";
    const fetchFn = mockFetch();
    await apiRequest("/api/verify", { method: "POST", auth: true });
    const calledUrl = fetchFn.mock.calls[0][0] as string;
    expect(calledUrl.startsWith("https://transia.dev")).toBe(true);
    expect(calledUrl).not.toContain("evil.com");
  });

  it("refuses redirects and sets a timeout signal on fetch", async () => {
    const fetchFn = mockFetch();
    await apiRequest("/api/verify", { method: "POST", auth: true });
    const opts = fetchFn.mock.calls[0][1] as RequestInit;
    expect(opts.redirect).toBe("error");
    expect(opts.signal).toBeInstanceOf(AbortSignal);
  });
});
