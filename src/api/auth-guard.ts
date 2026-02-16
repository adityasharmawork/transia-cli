import chalk from "chalk";
import { loadCredentials } from "../state/credentials.js";
import { verifyAuth } from "./client.js";
import { TransiaError, ExitCode } from "../utils/errors.js";
import { logger } from "../utils/logger.js";

export async function requireAuth(): Promise<void> {
  const credentials = loadCredentials();

  if (!credentials) {
    throw new TransiaError(
      ExitCode.AUTH_ERROR,
      `Not logged in. Run ${chalk.cyan("transia login")} to authenticate.`,
    );
  }

  try {
    const result = await verifyAuth();
    if (!result.valid) {
      throw new TransiaError(
        ExitCode.AUTH_ERROR,
        `Session expired. Run ${chalk.cyan("transia login")} to re-authenticate.`,
      );
    }
    logger.debug(`Authenticated as ${result.email}`);
  } catch (error) {
    if (error instanceof TransiaError) throw error;
    throw new TransiaError(
      ExitCode.NETWORK_ERROR,
      `Could not verify authentication. Check your internet connection or run ${chalk.cyan("transia login")}.`,
    );
  }
}
