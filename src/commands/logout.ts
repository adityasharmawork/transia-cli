import chalk from "chalk";
import { deleteCredentials } from "../state/credentials.js";
import { logger } from "../utils/logger.js";

export async function logoutCommand(): Promise<void> {
  const deleted = deleteCredentials();

  if (deleted) {
    logger.info(chalk.green("Logged out successfully."));
  } else {
    logger.info("Not currently logged in.");
  }
}
