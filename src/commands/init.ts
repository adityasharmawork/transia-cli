import { existsSync, readFileSync, appendFileSync } from "node:fs";
import { resolve } from "node:path";
import chalk from "chalk";
import { saveConfig, loadConfig } from "../state/manager.js";
import { createDefaultConfig } from "../state/schema.js";
import { logger } from "../utils/logger.js";

export async function initCommand(projectRoot: string): Promise<void> {
  const configPath = resolve(projectRoot, "transia.config.json");

  if (existsSync(configPath)) {
    logger.info(
      chalk.yellow(
        "transia.config.json already exists. Skipping initialization.",
      ),
    );
    return;
  }

  // Auto-detect project structure
  const detectedDirs: string[] = [];

  if (existsSync(resolve(projectRoot, "app"))) {
    detectedDirs.push("app");
  }
  if (existsSync(resolve(projectRoot, "src"))) {
    detectedDirs.push("src");
  }
  if (existsSync(resolve(projectRoot, "pages"))) {
    detectedDirs.push("pages");
  }

  // Detect framework
  let framework = "React";
  const pkgPath = resolve(projectRoot, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
      const deps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
      };
      if (deps.next) framework = "Next.js";
      else if (deps["@remix-run/react"]) framework = "Remix";
      else if (deps.gatsby) framework = "Gatsby";
    } catch {
      // Ignore parse errors
    }
  }

  const config = createDefaultConfig(detectedDirs);
  saveConfig(projectRoot, config);

  // Add .transia-state.json to .gitignore if it exists
  const gitignorePath = resolve(projectRoot, ".gitignore");
  if (existsSync(gitignorePath)) {
    const gitignore = readFileSync(gitignorePath, "utf-8");
    const entries: string[] = [];
    if (!gitignore.includes(".transia-state.json")) {
      entries.push(".transia-state.json");
    }
    if (!gitignore.includes(".transia-state.json.bak")) {
      entries.push(".transia-state.json.bak");
    }
    if (entries.length > 0) {
      appendFileSync(
        gitignorePath,
        "\n# Transia\n" + entries.join("\n") + "\n",
      );
      logger.debug("Added Transia entries to .gitignore");
    }
  }

  // Print success and instructions
  console.log("");
  console.log(chalk.green.bold("  Transia initialized successfully!"));
  console.log("");
  console.log(`  ${chalk.dim("Detected:")} ${framework} project`);
  if (detectedDirs.length > 0) {
    console.log(
      `  ${chalk.dim("Scanning:")} ${detectedDirs.join(", ")} directories`,
    );
  }
  console.log("");
  console.log(chalk.bold("  Next steps:"));
  console.log("");
  console.log(
    `  ${chalk.cyan("1.")} Add your API key to your ${chalk.yellow(".env")} or ${chalk.yellow(".env.local")} file:`,
  );
  console.log("");
  console.log(
    chalk.dim("     # For OpenAI (default provider)"),
  );
  console.log(`     OPENAI_API_KEY=your-key-here`);
  console.log("");
  console.log(
    chalk.dim("     # Or for other providers:"),
  );
  console.log(`     ANTHROPIC_API_KEY=your-key-here`);
  console.log(`     GEMINI_API_KEY=your-key-here`);
  console.log(`     XAI_API_KEY=your-key-here          ${chalk.dim("# Grok")}`);
  console.log("");
  console.log(
    chalk.dim("     Using a custom variable name? Set \"apiKeyEnv\" in transia.config.json"),
  );
  console.log("");
  console.log(
    `  ${chalk.cyan("2.")} Edit ${chalk.yellow("transia.config.json")} to configure target locales, provider, and output format.`,
  );
  console.log(
    `     Add or remove locales anytime — no need to re-run init.`,
  );
  console.log("");
  console.log(
    `  ${chalk.cyan("3.")} Run your first translation:`,
  );
  console.log("");
  console.log(
    `     ${chalk.green("npx transia translate")}`,
  );
  console.log("");
}
