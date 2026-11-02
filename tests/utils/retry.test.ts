import { describe, it, expect, vi } from "vitest";
import { withRetry, DEFAULT_TIMEOUT_MS } from "../../src/utils/retry";

const parseOk = async () => ({ ok: true });

describe("withRetry hardening", () => {
  it("defaults the request timeout to 120s (not so tight it aborts slow-but-fine batches)", () => {
    expect(DEFAULT_TIMEOUT_MS).toBe(120000);
  });

  it("does not retry a 4xx client error (fn called once, then throws)", async () => {
    const fn = vi.fn(async () => new Response("bad request", { status: 400 }));
    await expect(withRetry(fn, parseOk, { maxRetries: 3, baseDelayMs: 0 })).rejects.toThrow();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries a 429 then succeeds", async () => {
    let n = 0;
    const fn = vi.fn(async () => {
      n++;
      return n === 1
        ? new Response("", { status: 429, headers: { "retry-after": "0" } })
        : new Response("", { status: 200 });
    });
    const result = await withRetry(fn, parseOk, { maxRetries: 2, baseDelayMs: 0 });
    expect(result).toEqual({ ok: true });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("caps a huge Retry-After so it does not stall", async () => {
    let n = 0;
    const fn = vi.fn(async () => {
      n++;
      return n === 1
        ? new Response("", { status: 429, headers: { "retry-after": "100000" } })
        : new Response("", { status: 200 });
    });
    // maxDelayMs tiny → the 100000s Retry-After must be clamped, so this resolves fast.
    const result = await withRetry(fn, parseOk, { maxRetries: 2, baseDelayMs: 0, maxDelayMs: 20 });
    expect(result).toEqual({ ok: true });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("aborts a hung request after timeoutMs and retries", async () => {
    const fn = vi.fn(
      (signal: AbortSignal) =>
        new Promise<Response>((_, reject) => {
          signal.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );
    await expect(
      withRetry(fn, parseOk, { maxRetries: 1, baseDelayMs: 0, timeoutMs: 10 }),
    ).rejects.toThrow();
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
