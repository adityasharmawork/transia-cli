import { execSync } from "node:child_process";
import { platform } from "node:os";
import ora from "ora";
import chalk from "chalk";
import { saveCredentials, loadCredentials } from "../state/credentials.js";
import { initCliSession, pollCliSession } from "../api/client.js";
import { TransiaError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";

function openBrowser(url: string): void {
  const os = platform();
  try {
    if (os === "darwin") {
      execSync(`open "${url}"`);
    } else if (os === "win32") {
      execSync(`start "${url}"`);
    } else {
      execSync(`xdg-open "${url}"`);
    }
  } catch {
    // If automatic open fails, user will use the manual link
  }
}

export async function loginCommand(): Promise<void> {
  // Check if already logged in
  const existing = loadCredentials();
  if (existing) {
    logger.info(
      `Already logged in as ${chalk.bold(existing.email)}. Run ${chalk.cyan("transia logout")} first to switch accounts.`,
    );
    return;
  }

  const apiUrl =
    process.env.TRANSIA_API_URL ?? "https://transia.dev";

  // Create a CLI auth session
  const spinner = ora("Initializing login...").start();

  let sessionToken: string;
  try {
    const result = await initCliSession();
    sessionToken = result.sessionToken;
  } catch (error) {
    spinner.fail("Failed to initialize login session");
    throw error;
  }

  spinner.stop();

  const authUrl = `${apiUrl}/auth/cli?session=${sessionToken}`;

  console.log("");
  console.log(
    `  Open this URL in your browser to log in:\n\n  ${chalk.cyan.underline(authUrl)}`,
  );
  console.log("");

  openBrowser(authUrl);

  const pollSpinner = ora("Waiting for browser confirmation...").start();

  // Poll for confirmation (max 5 minutes)
  const maxAttempts = 60;
  const pollInterval = 5000; // 5 seconds

  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((resolve) => setTimeout(resolve, pollInterval));

    try {
      const result = await pollCliSession(sessionToken);

      if (result.status === "confirmed" && result.authToken && result.email) {
        saveCredentials({
          authToken: result.authToken,
          email: result.email,
          apiUrl,
        });

        pollSpinner.succeed(
          `Logged in as ${chalk.bold(result.email)}`,
        );
        console.log("");
        return;
      }

      if (result.status === "expired") {
        pollSpinner.fail("Login session expired. Please try again.");
        return;
      }
    } catch (error) {
      // H7: Stop polling on non-network TransiaErrors
      if (error instanceof TransiaError) {
        pollSpinner.fail(`Login failed: ${error.message}`);
        return;
      }
      // Network error during polling — keep trying
    }
  }

  pollSpinner.fail(
    "Login timed out. Please try again with `transia login`.",
  );
}
