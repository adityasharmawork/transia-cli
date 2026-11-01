import { existsSync, unlinkSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import chalk from "chalk";
import { loadConfig } from "../state/manager.js";
import { logger } from "../utils/logger.js";
import { isInsideProject } from "../utils/paths.js";
import { TransiaError, ExitCode } from "../utils/errors.js";

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
    let outputPath: string | null = null;
    try {
      outputPath = loadConfig(projectRoot).output.path;
    } catch {
      // Config might not exist — nothing to delete.
    }
    if (outputPath !== null) {
      // Safety: never delete the project root itself or anything outside it,
      // even if output.path is misconfigured as "." or "../something".
      if (!isInsideProject(projectRoot, outputPath)) {
        throw new TransiaError(
          ExitCode.CONFIG_ERROR,
          `Refusing to delete output path "${outputPath}": it must be a directory inside the project, not the project root (".") or a path outside it.`,
        );
      }
      const outputDir = resolve(projectRoot, outputPath);
      if (existsSync(outputDir)) {
        rmSync(outputDir, { recursive: true });
        logger.info(`Deleted output directory: ${outputPath}/`);
      }
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
