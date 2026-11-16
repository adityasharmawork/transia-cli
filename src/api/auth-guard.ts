import chalk from "chalk";
import { loadCredentials } from "../state/credentials.js";
import { verifyAuth } from "./client.js";
import { isVerificationFresh, recordVerification } from "../state/verify-cache.js";
import { TransiaError, ExitCode } from "../utils/errors.js";
import { logger } from "../utils/logger.js";

/**
 * - `"network"` (default): verify the session with the server, but trust a
 *   recent confirmation (72h cache) first, and degrade gracefully when the
 *   server is unreachable. For commands that may actually use the network
 *   (init / translate / setup).
 * - `"local"`: only require that a login exists locally — no network. For
 *   commands that touch nothing but local files (status / reset / apply / widget),
 *   so they keep working offline.
 */
export type AuthMode = "local" | "network";

export async function requireAuth(mode: AuthMode = "network"): Promise<void> {
  const credentials = loadCredentials();

  // Mandatory-login stays: a stored credential (or a CI token) must exist.
  if (!credentials && !process.env.TRANSIA_TOKEN) {
    throw new TransiaError(
      ExitCode.AUTH_ERROR,
      `Not logged in. Run ${chalk.cyan("transia login")} (or set TRANSIA_TOKEN for CI) to authenticate.`,
    );
  }

  // Local-only commands never need the network — the login check above is enough.
  if (mode === "local") {
    logger.debug("Local-only command — skipping network verification.");
    return;
  }

  // Trust a recent server confirmation before re-verifying (keyed by email).
  // Skip the cache entirely when a CI/env token is in use: `verifyAuth` sends
  // that token, which may belong to a different account than the stored
  // credential, so it must not read or write that credential's freshness marker.
  const usingEnvToken = !!process.env.TRANSIA_TOKEN;
  const email = credentials?.email;
  if (email && !usingEnvToken && isVerificationFresh(email)) {
    logger.debug("Session verified recently — skipping network check.");
    return;
  }

  try {
    const result = await verifyAuth();
    if (!result.valid) {
      throw new TransiaError(
        ExitCode.AUTH_ERROR,
        `Session expired. Run ${chalk.cyan("transia login")} to re-authenticate.`,
      );
    }
    if (email && !usingEnvToken) recordVerification(email);
    logger.debug(`Authenticated as ${result.email}`);
  } catch (error) {
    // A reachable server's DEFINITIVE rejection must fail — never papered over as
    // "offline". That is an expired/invalid session (AUTH_ERROR, incl. 401) or any
    // other client rejection (4xx, e.g. 403 for a deactivated account). apiRequest
    // carries the HTTP status in `details.status`; a transport failure / timeout
    // has no status, and a server-side 5xx is not a session rejection.
    const status =
      error instanceof TransiaError && typeof error.details?.status === "number"
        ? error.details.status
        : undefined;
    const definitiveReject =
      (error instanceof TransiaError && error.code === ExitCode.AUTH_ERROR) ||
      (status !== undefined && status >= 400 && status < 500);
    if (definitiveReject) throw error;

    // Otherwise we couldn't get a definitive answer — the server was unreachable
    // (fetch threw / timed out → no status) or errored server-side (5xx). With a
    // local credential, proceed offline; anything that truly needs the network
    // surfaces its own error at the actual call.
    if (credentials) {
      logger.warn(
        "Could not reach Transia to verify your session; proceeding offline.",
      );
      return;
    }
    // CI token with no stored credential and no usable answer — fail loudly.
    if (error instanceof TransiaError) throw error;
    throw new TransiaError(
      ExitCode.NETWORK_ERROR,
      `Could not verify authentication. Check your internet connection or run ${chalk.cyan("transia login")}.`,
    );
  }
}
