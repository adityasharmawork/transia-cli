import { existsSync, unlinkSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import chalk from "chalk";
import { loadConfig } from "../state/manager.js";
import { logger } from "../utils/logger.js";

interface ResetOptions {
  confirm?: boolean;
  output?: boolean;
}

export async function resetCommand(
  projectRoot: string,
  options: ResetOptions,
): Promise<void> {
  if (!options.confirm) {
    console.log("");
    console.log(
      chalk.yellow(
        "  This will delete the translation state file (.transia-state.json).",
      ),
    );
    if (options.output) {
      console.log(
        chalk.yellow(
          "  It will also delete all generated translation files.",
        ),
      );
    }
    console.log("");
    console.log(
      `  Run with ${chalk.cyan("--confirm")} to proceed.`,
    );
    console.log("");
    return;
  }

  // Delete state files
  const statePath = resolve(projectRoot, ".transia-state.json");
  const backupPath = resolve(projectRoot, ".transia-state.json.bak");

  if (existsSync(statePath)) {
    unlinkSync(statePath);
    logger.info("Deleted .transia-state.json");
  }

  if (existsSync(backupPath)) {
    unlinkSync(backupPath);
    logger.info("Deleted .transia-state.json.bak");
  }

  // Optionally delete output files
  if (options.output) {
    try {
      const config = loadConfig(projectRoot);
      const outputDir = resolve(projectRoot, config.output.path);
      if (existsSync(outputDir)) {
        rmSync(outputDir, { recursive: true });
        logger.info(`Deleted output directory: ${config.output.path}/`);
      }
    } catch {
      // Config might not exist
    }
  }

  console.log("");
  console.log(chalk.green("  Translation state has been reset."));
  console.log(
    chalk.dim(
      '  Run "transia translate" to re-translate from scratch.',
    ),
  );
  console.log("");
}
