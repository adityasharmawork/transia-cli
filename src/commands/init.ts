import { existsSync, readFileSync, appendFileSync } from "node:fs";
import { resolve, basename } from "node:path";
import chalk from "chalk";
import ora from "ora";
import { select, input, checkbox } from "@inquirer/prompts";
import { saveConfig, loadConfig } from "../state/manager.js";
import { createDefaultConfig } from "../state/schema.js";
import { createProject } from "../api/client.js";
import { logger } from "../utils/logger.js";

interface InitOptions {
  yes?: boolean;
}

const LOCALE_RE = /^[a-z]{2}(-[A-Z]{2})?$/;

function detectFramework(projectRoot: string): string {
  const pkgPath = resolve(projectRoot, "package.json");
  if (!existsSync(pkgPath)) return "React";
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    if (deps.next) return "Next.js";
    if (deps["@remix-run/react"]) return "Remix";
    if (deps.gatsby) return "Gatsby";
  } catch {
    // Ignore parse errors
  }
  return "React";
}

function detectDirs(projectRoot: string): string[] {
  const dirs: string[] = [];
  if (existsSync(resolve(projectRoot, "app"))) dirs.push("app");
  if (existsSync(resolve(projectRoot, "src"))) dirs.push("src");
  if (existsSync(resolve(projectRoot, "pages"))) dirs.push("pages");
  return dirs;
}

async function promptOptions(framework: string) {
  // 1. Output format
  const outputFormat = await select({
    message: "Which i18n format would you like to use?",
    choices: [
      {
        value: "next-intl" as const,
        name: "next-intl (recommended for Next.js)",
      },
      {
        value: "i18next" as const,
        name: "i18next (recommended for React / Vite)",
      },
    ],
    default: framework === "Next.js" ? "next-intl" : "i18next",
  });

  // 2. Target locales
  const localesInput = await input({
    message:
      "Which locales do you want to translate to? (comma-separated, e.g. es,fr,de)",
    default: "es",
    validate: (value) => {
      const locales = value
        .split(",")
        .map((l) => l.trim())
        .filter(Boolean);
      if (locales.length === 0) return "At least one locale is required.";
      for (const loc of locales) {
        if (!LOCALE_RE.test(loc))
          return `Invalid locale: "${loc}". Use format like "es" or "en-US".`;
      }
      return true;
    },
  });
  const targetLocales = localesInput
    .split(",")
    .map((l) => l.trim())
    .filter(Boolean);

  // 3. Provider
  const providerChoice = await select({
    message: "How would you like to handle AI translations?",
    choices: [
      {
        value: "auto",
        name: "Auto-detect from API keys (recommended)",
      },
      { value: "openai", name: "OpenAI (GPT-4o)" },
      { value: "anthropic", name: "Anthropic (Claude)" },
      { value: "gemini", name: "Google Gemini" },
      { value: "grok", name: "Grok (xAI)" },
      {
        value: "managed",
        name: "Managed (Transia cloud — no API key needed)",
      },
      {
        value: "priority",
        name: "Custom priority order (multiple providers)",
      },
    ],
  });

  // 4. Custom priority if selected
  let providerPriority: string[] | undefined;
  let providerName = providerChoice;

  if (providerChoice === "priority") {
    const selected = await checkbox({
      message: "Select providers in priority order (highest priority first):",
      choices: [
        { value: "gemini", name: "Google Gemini (fastest / cheapest)" },
        { value: "grok", name: "Grok (xAI)" },
        { value: "openai", name: "OpenAI" },
        { value: "anthropic", name: "Anthropic Claude" },
      ],
    });
    if (selected.length === 0) {
      logger.warn("No providers selected, falling back to auto-detect.");
    } else {
      providerPriority = selected;
    }
    providerName = "auto";
  }

  return { outputFormat, targetLocales, provider: providerName, providerPriority };
}

export async function initCommand(
  projectRoot: string,
  options: InitOptions = {},
): Promise<void> {
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
  const detectedDirs = detectDirs(projectRoot);
  const framework = detectFramework(projectRoot);

  console.log("");
  console.log(`  ${chalk.dim("Detected:")} ${framework} project`);
  if (detectedDirs.length > 0) {
    console.log(
      `  ${chalk.dim("Scanning:")} ${detectedDirs.join(", ")} directories`,
    );
  }
  console.log("");

  // Interactive prompts (skip in non-interactive mode)
  const isInteractive = options.yes !== true && process.stdin.isTTY !== false;

  let userChoices: {
    outputFormat: "next-intl" | "i18next";
    targetLocales: string[];
    provider: string;
    providerPriority?: string[];
  };

  if (isInteractive) {
    userChoices = await promptOptions(framework);
  } else {
    userChoices = {
      outputFormat: framework === "Next.js" ? "next-intl" : "i18next",
      targetLocales: ["es"],
      provider: "auto",
    };
  }

  const config = createDefaultConfig({
    detectedDirs,
    provider: userChoices.provider,
    providerPriority: userChoices.providerPriority,
    targetLocales: userChoices.targetLocales,
    outputFormat: userChoices.outputFormat,
  });
  saveConfig(projectRoot, config);

  // Register project on backend dashboard
  const projectName = isInteractive
    ? await input({
        message: "Project name (shown on Transia dashboard):",
        default: basename(projectRoot),
        validate: (v) =>
          v.trim().length > 0 ? true : "Project name is required.",
      })
    : basename(projectRoot);

  const regSpinner = ora("Registering project on Transia dashboard...").start();
  try {
    const result = await createProject({
      name: projectName,
      sourceLocale: config.sourceLocale,
      targetLocales: config.targetLocales,
      outputFormat: config.output.format,
    });

    // Save projectId and publicKey into config (safe to commit)
    config.projectId = result.project._id;
    config.publicKey = result.project.publicKey;
    saveConfig(projectRoot, config);

    // Save API key to .env.local (not committed to git)
    const envLocalPath = resolve(projectRoot, ".env.local");
    const envContent = existsSync(envLocalPath)
      ? readFileSync(envLocalPath, "utf-8")
      : "";
    if (!envContent.includes("TRANSIA_PROJECT_API_KEY")) {
      appendFileSync(
        envLocalPath,
        `\n# Transia project API key (for managed provider)\nTRANSIA_PROJECT_API_KEY=${result.project.apiKey}\n`,
        { mode: 0o600 },
      );
    }

    regSpinner.succeed("Project registered on dashboard");
  } catch (error) {
    regSpinner.warn(
      "Could not register project on dashboard (you can retry later with the smart command)",
    );
    logger.debug(
      `Project registration failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

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
  console.log(
    `  ${chalk.dim("Provider:")}  ${userChoices.provider}${userChoices.providerPriority ? ` (priority: ${userChoices.providerPriority.join(" → ")})` : ""}`,
  );
  console.log(
    `  ${chalk.dim("Locales:")}   ${userChoices.targetLocales.join(", ")}`,
  );
  console.log(
    `  ${chalk.dim("Format:")}    ${userChoices.outputFormat}`,
  );
  console.log("");

  if (userChoices.provider !== "managed") {
    console.log(chalk.bold("  Next steps:"));
    console.log("");
    console.log(
      `  ${chalk.cyan("1.")} Add your AI provider's API key to ${chalk.yellow(".env")} or ${chalk.yellow(".env.local")}:`,
    );
    console.log("");
    console.log(
      `     GEMINI_API_KEY=your-key         ${chalk.dim("# Google Gemini")}`,
    );
    console.log(
      `     XAI_API_KEY=your-key            ${chalk.dim("# Grok")}`,
    );
    console.log(
      `     OPENAI_API_KEY=your-key         ${chalk.dim("# OpenAI")}`,
    );
    console.log(
      `     ANTHROPIC_API_KEY=your-key      ${chalk.dim("# Anthropic Claude")}`,
    );
    console.log("");
  }

  console.log(
    `  ${chalk.cyan(userChoices.provider === "managed" ? "1." : "2.")} Run your first translation:`,
  );
  console.log("");
  console.log(`     ${chalk.green("npx transia translate")}`);
  console.log("");
}
