import chalk from "chalk";
import { deleteCredentials } from "../state/credentials.js";
import { clearVerificationCache } from "../state/verify-cache.js";
import { logger } from "../utils/logger.js";

export async function logoutCommand(): Promise<void> {
  const deleted = deleteCredentials();
  // Drop the 72h verification cache too, so a re-login always re-verifies.
  clearVerificationCache();

  if (deleted) {
    logger.info(chalk.green("Logged out successfully."));
  } else {
    logger.info("Not currently logged in.");
  }
}
