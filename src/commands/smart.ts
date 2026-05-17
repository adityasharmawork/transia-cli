import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import chalk from "chalk";
import { select, confirm } from "@inquirer/prompts";
import { loadCredentials } from "../state/credentials.js";
import { loadConfig, loadState } from "../state/manager.js";
import { loginCommand } from "./login.js";
import { initCommand } from "./init.js";
import { translateCommand } from "./translate.js";
import { statusCommand } from "./status.js";
import { applyCommand } from "./apply.js";
import { setupCommand } from "./setup.js";
import { widgetCommand } from "./widget.js";
import { createProject } from "../api/client.js";
import { logger } from "../utils/logger.js";
import type { TransiaConfig } from "../state/schema.js";

interface WorkflowState {
  isLoggedIn: boolean;
  hasConfig: boolean;
  hasProjectOnBackend: boolean;
  hasTranslations: boolean;
  translationsCoverage: number;
  hasI18nSetup: boolean;
  hasWidget: boolean;
  config: TransiaConfig | null;
}

function detectWorkflowState(projectRoot: string): WorkflowState {
  // 1. Auth
  const credentials = loadCredentials();
  const isLoggedIn = !!credentials;

  // 2. Config
  const configPath = resolve(projectRoot, "transia.config.json");
  const hasConfig = existsSync(configPath);

  let config: TransiaConfig | null = null;
  let hasProjectOnBackend = false;
  let hasTranslations = false;
  let translationsCoverage = 0;
  let hasI18nSetup = false;
  let hasWidget = false;

  if (hasConfig) {
    try {
      config = loadConfig(projectRoot);
    } catch {
      // Config exists but is invalid
    }
  }

  if (config) {
    // 3. Backend project
    hasProjectOnBackend = !!(config as Record<string, unknown>).projectId;

    // 4. Translations
    const statePath = resolve(projectRoot, ".transia-state.json");
    if (existsSync(statePath)) {
      try {
        const state = loadState(projectRoot);
        const stringCount = Object.keys(state.strings).length;
        hasTranslations = stringCount > 0;

        if (hasTranslations) {
          const totalSlots = stringCount * config.targetLocales.length;
          let filledSlots = 0;
          for (const entry of Object.values(state.strings)) {
            for (const locale of config.targetLocales) {
              if (entry.translations[locale]?.value) filledSlots++;
            }
          }
          translationsCoverage =
            totalSlots > 0
              ? Math.round((filledSlots / totalSlots) * 100)
              : 0;
        }
      } catch {
        // State corrupted, treat as no translations
      }
    }

    // 5. i18n setup
    const pkgPath = resolve(projectRoot, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };
        if (config.output.format === "next-intl") {
          hasI18nSetup = "next-intl" in deps;
        } else {
          hasI18nSetup = "i18next" in deps && "react-i18next" in deps;
        }
      } catch {
        // ignore
      }
    }

    // 6. Widget
    const widgetCandidates = [
      resolve(projectRoot, "src", "components", "TransiaLanguageSwitcher.tsx"),
      resolve(projectRoot, "components", "TransiaLanguageSwitcher.tsx"),
    ];
    hasWidget = widgetCandidates.some((p) => existsSync(p));
  }

  return {
    isLoggedIn,
    hasConfig,
    hasProjectOnBackend,
    hasTranslations,
    translationsCoverage,
    hasI18nSetup,
    hasWidget,
    config,
  };
}

export async function smartCommand(
  projectRoot: string,
  depth = 0,
): Promise<void> {
  if (depth > 5) return;

  const state = detectWorkflowState(projectRoot);

  console.log("");
  console.log(chalk.bold("  Welcome to Transia!"));
  console.log(chalk.dim("  Smart mode — detecting project state..."));
  console.log("");

  // State 1: Not logged in
  if (!state.isLoggedIn) {
    console.log(
      chalk.yellow("  You're not logged in yet. Let's get you set up!"),
    );
    console.log("");
    const proceed = await confirm({
      message: "Would you like to log in to Transia?",
      default: true,
    });
    if (!proceed) return;
    await loginCommand();
    return smartCommand(projectRoot, depth + 1);
  }

  // State 2: Logged in but no config
  if (!state.hasConfig) {
    console.log(
      chalk.green("  Logged in ") +
        chalk.dim("— no project initialized yet."),
    );
    console.log("");
    const proceed = await confirm({
      message: "Would you like to initialize Transia in this project?",
      default: true,
    });
    if (!proceed) return;
    await initCommand(projectRoot);
    return;
  }

  // State 3: Config exists but no backend project
  if (!state.hasProjectOnBackend && state.isLoggedIn) {
    logger.debug("Project not registered on backend, attempting...");
    // Silent attempt — don't block the flow
  }

  // State 4: No translations yet
  if (!state.hasTranslations) {
    console.log(
      chalk.green("  Project initialized ") +
        chalk.dim("— no translations yet."),
    );
    console.log("");
    const proceed = await confirm({
      message: "Would you like to run your first translation?",
      default: true,
    });
    if (!proceed) return;
    await translateCommand(projectRoot, {});

    // After translation, auto-proceed to setup + widget
    return smartCommand(projectRoot, depth + 1);
  }

  // State 5: Translations exist but incomplete
  if (state.translationsCoverage < 100) {
    console.log(
      chalk.yellow(
        `  Translations are ${state.translationsCoverage}% complete.`,
      ),
    );
    console.log("");
    const proceed = await confirm({
      message: "Would you like to translate the missing strings?",
      default: true,
    });
    if (proceed) {
      await translateCommand(projectRoot, {});
      return smartCommand(projectRoot, depth + 1);
    }
  }

  // State 6: No i18n setup yet
  if (!state.hasI18nSetup && state.hasTranslations) {
    console.log(
      chalk.dim(
        `  Translations ready — i18n library not configured yet.`,
      ),
    );
    console.log("");
    const proceed = await confirm({
      message: `Set up ${state.config?.output.format ?? "i18n"} in your project?`,
      default: true,
    });
    if (proceed) {
      await setupCommand(projectRoot, {});
      return smartCommand(projectRoot, depth + 1);
    }
  }

  // State 7: No widget yet
  if (!state.hasWidget && state.hasTranslations) {
    console.log(
      chalk.dim(
        "  Add the Transia language switcher widget to your app?",
      ),
    );
    console.log("");
    const proceed = await confirm({
      message:
        "Add the floating language switcher widget? (appears at bottom-right)",
      default: true,
    });
    if (proceed) {
      await widgetCommand(projectRoot, {});
      return;
    }
  }

  // State 8: Everything is set up!
  console.log(chalk.green.bold("  Your project is fully set up!"));
  console.log("");

  if (state.config) {
    console.log(
      `  ${chalk.dim("Source locale:")}   ${state.config.sourceLocale}`,
    );
    console.log(
      `  ${chalk.dim("Target locales:")}  ${state.config.targetLocales.join(", ")}`,
    );
    console.log(
      `  ${chalk.dim("Coverage:")}        ${state.translationsCoverage}%`,
    );
    console.log(
      `  ${chalk.dim("Provider:")}        ${state.config.provider.name}`,
    );
    console.log(
      `  ${chalk.dim("i18n library:")}    ${state.hasI18nSetup ? state.config.output.format : "not configured"}`,
    );
    console.log(
      `  ${chalk.dim("Widget:")}          ${state.hasWidget ? "installed" : "not added"}`,
    );
    console.log("");
  }

  const action = await select({
    message: "What would you like to do?",
    choices: [
      { value: "status", name: "View translation status" },
      { value: "translate", name: "Re-translate (force all strings)" },
      { value: "apply", name: "Apply t() calls to source files" },
      { value: "setup", name: "Set up / reconfigure i18n library" },
      { value: "widget", name: "Add / regenerate language switcher widget" },
      { value: "exit", name: "Exit" },
    ],
  });

  switch (action) {
    case "status":
      await statusCommand(projectRoot);
      break;
    case "translate":
      await translateCommand(projectRoot, { force: true });
      break;
    case "apply":
      await applyCommand(projectRoot, {});
      break;
    case "setup":
      await setupCommand(projectRoot, {});
      break;
    case "widget":
      await widgetCommand(projectRoot, {});
      break;
    case "exit":
      break;
  }
}
