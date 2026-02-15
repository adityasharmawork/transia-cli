import { Command } from "commander";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { initCommand } from "./commands/init.js";
import { translateCommand } from "./commands/translate.js";
import { statusCommand } from "./commands/status.js";
import { resetCommand } from "./commands/reset.js";
import { TransiaError } from "./utils/errors.js";
import { logger } from "./utils/logger.js";

// Redact secrets from uncaught exceptions
process.on("uncaughtException", (error) => {
  logger.error(`Unexpected error: ${error.message}`);
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  logger.error(
    `Unhandled rejection: ${reason instanceof Error ? reason.message : String(reason)}`,
  );
  process.exit(1);
});

const program = new Command();

// Load version from package.json
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
let version = "0.1.0";
try {
  const pkg = JSON.parse(
    readFileSync(resolve(__dirname, "..", "package.json"), "utf-8"),
  );
  version = pkg.version;
} catch {
  // Use default version
}

program
  .name("transia")
  .description(
    "Enterprise-grade BYOK AI translation CLI for React/Next.js applications",
  )
  .version(version);

program
  .command("init")
  .description("Initialize Transia in your project")
  .action(async () => {
    try {
      await initCommand(process.cwd());
    } catch (error) {
      handleError(error);
    }
  });

program
  .command("translate")
  .description("Extract and translate strings from your source files")
  .option(
    "-t, --target <locales>",
    "Target locales (comma-separated, e.g. es,fr,de)",
  )
  .option(
    "-p, --provider <name>",
    "AI provider (openai, anthropic, gemini, grok)",
  )
  .option("-f, --force", "Re-translate all strings, ignoring cache")
  .option("-d, --dry-run", "Show what would be translated without calling AI")
  .option("-v, --verbose", "Enable debug logging")
  .action(async (options) => {
    try {
      await translateCommand(process.cwd(), options);
    } catch (error) {
      handleError(error);
    }
  });

program
  .command("status")
  .description("Show translation coverage for all target locales")
  .action(async () => {
    try {
      await statusCommand(process.cwd());
    } catch (error) {
      handleError(error);
    }
  });

program
  .command("reset")
  .description("Delete translation state and optionally output files")
  .option("--confirm", "Confirm the reset operation")
  .option("--output", "Also delete generated translation files")
  .action(async (options) => {
    try {
      await resetCommand(process.cwd(), options);
    } catch (error) {
      handleError(error);
    }
  });

function handleError(error: unknown): void {
  if (error instanceof TransiaError) {
    logger.error(error.message);
    process.exit(error.code);
  }
  logger.error(
    `Unexpected error: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
}

program.parse();
