import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("../../src/state/credentials", () => ({ loadCredentials: vi.fn() }));
vi.mock("../../src/api/client", () => ({ verifyAuth: vi.fn() }));

import { requireAuth } from "../../src/api/auth-guard";
import { loadCredentials } from "../../src/state/credentials";
import { verifyAuth } from "../../src/api/client";
import { recordVerification, isVerificationFresh } from "../../src/state/verify-cache";
import { TransiaError, ExitCode } from "../../src/utils/errors";

const mockLoad = vi.mocked(loadCredentials);
const mockVerify = vi.mocked(verifyAuth);

const CREDS = { authToken: "tok", email: "u@example.com", apiUrl: "https://transia.dev" };

describe("requireAuth — offline-grace modes", () => {
  let home: string;
  let prevHome: string | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.TRANSIA_TOKEN;
    prevHome = process.env.HOME;
    home = mkdtempSync(join(tmpdir(), "transia-authguard-"));
    process.env.HOME = home; // isolate the verify cache
  });
  afterEach(() => {
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    rmSync(home, { recursive: true, force: true });
  });

  it("local mode: does NOT hit the network when a credential exists", async () => {
    mockLoad.mockReturnValue(CREDS);
    await expect(requireAuth("local")).resolves.toBeUndefined();
    expect(mockVerify).not.toHaveBeenCalled();
  });

  it("local mode: still requires a login (no credential → throws)", async () => {
    mockLoad.mockReturnValue(null);
    await expect(requireAuth("local")).rejects.toThrow(/not logged in/i);
    expect(mockVerify).not.toHaveBeenCalled();
  });

  it("network mode: a fresh cache skips the network verify", async () => {
    mockLoad.mockReturnValue(CREDS);
    recordVerification(CREDS.email); // fresh marker in the isolated HOME
    await expect(requireAuth("network")).resolves.toBeUndefined();
    expect(mockVerify).not.toHaveBeenCalled();
  });

  it("network mode: a cache miss verifies and records the success", async () => {
    mockLoad.mockReturnValue(CREDS);
    mockVerify.mockResolvedValue({ valid: true, email: CREDS.email });
    expect(isVerificationFresh(CREDS.email)).toBe(false); // nothing cached yet
    await expect(requireAuth("network")).resolves.toBeUndefined();
    expect(mockVerify).toHaveBeenCalledTimes(1);
    expect(isVerificationFresh(CREDS.email)).toBe(true); // recorded
  });

  it("network mode: transport failure (NETWORK_ERROR, no HTTP status) + credential → proceeds offline", async () => {
    // apiRequest's fetch-threw/timeout catch throws NETWORK_ERROR with NO status.
    mockLoad.mockReturnValue(CREDS);
    mockVerify.mockRejectedValue(new TransiaError(ExitCode.NETWORK_ERROR, "offline"));
    await expect(requireAuth("network")).resolves.toBeUndefined();
    expect(mockVerify).toHaveBeenCalledTimes(1);
    expect(isVerificationFresh(CREDS.email)).toBe(false); // a failed verify is NOT cached
  });

  it("network mode: a non-TransiaError rejection + local credential → proceeds offline", async () => {
    mockLoad.mockReturnValue(CREDS);
    mockVerify.mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(requireAuth("network")).resolves.toBeUndefined();
  });

  it("network mode: server-side 5xx (reachable but erroring) + credential → proceeds offline", async () => {
    mockLoad.mockReturnValue(CREDS);
    mockVerify.mockRejectedValue(
      new TransiaError(ExitCode.NETWORK_ERROR, "API error (503)", { status: 503 }),
    );
    await expect(requireAuth("network")).resolves.toBeUndefined();
  });

  it("network mode: reachable 4xx rejection (403, e.g. deactivated) → throws, NOT graced", async () => {
    // The sharp case: a reachable server giving a definitive "no" must fail, not
    // be papered over as "offline" (which would let a deactivated BYOK user keep going).
    mockLoad.mockReturnValue(CREDS);
    mockVerify.mockRejectedValue(
      new TransiaError(ExitCode.NETWORK_ERROR, "API error (403): forbidden", { status: 403 }),
    );
    await expect(requireAuth("network")).rejects.toThrow(/403|forbidden/i);
    expect(isVerificationFresh(CREDS.email)).toBe(false);
  });

  it("network mode: AUTH_ERROR from verifyAuth (401) → throws, NOT graced", async () => {
    mockLoad.mockReturnValue(CREDS);
    mockVerify.mockRejectedValue(
      new TransiaError(ExitCode.AUTH_ERROR, "Authentication failed.", { status: 401 }),
    );
    await expect(requireAuth("network")).rejects.toThrow(/authentication failed/i);
    expect(isVerificationFresh(CREDS.email)).toBe(false);
  });

  it("network mode: a CI/env token bypasses the stored-credential cache", async () => {
    // Finding 3: TRANSIA_TOKEN may be a different account than the stored credential,
    // so a fresh marker for the stored email must NOT let the env token skip verify.
    mockLoad.mockReturnValue(CREDS);
    recordVerification(CREDS.email); // stored creds look fresh
    process.env.TRANSIA_TOKEN = "ci-tok";
    mockVerify.mockResolvedValue({ valid: true, email: "ci@example.com" });
    await expect(requireAuth("network")).resolves.toBeUndefined();
    expect(mockVerify).toHaveBeenCalledTimes(1); // cache skipped → verified anyway
  });

  it("network mode: reachable server says invalid → throws (session expired), not graced", async () => {
    mockLoad.mockReturnValue(CREDS);
    mockVerify.mockResolvedValue({ valid: false, email: CREDS.email });
    await expect(requireAuth("network")).rejects.toThrow(/session expired/i);
    expect(isVerificationFresh(CREDS.email)).toBe(false);
  });

  it("CI token (no stored credential) + NETWORK_ERROR → fails loudly (no grace)", async () => {
    mockLoad.mockReturnValue(null);
    process.env.TRANSIA_TOKEN = "ci-tok";
    mockVerify.mockRejectedValue(new TransiaError(ExitCode.NETWORK_ERROR, "offline"));
    await expect(requireAuth("network")).rejects.toThrow(/offline|could not verify/i);
  });

  it("defaults to network mode", async () => {
    mockLoad.mockReturnValue(CREDS);
    mockVerify.mockResolvedValue({ valid: true, email: CREDS.email });
    await expect(requireAuth()).resolves.toBeUndefined();
    expect(mockVerify).toHaveBeenCalledTimes(1);
  });
});
