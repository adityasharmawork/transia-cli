import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { resolve, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import ora from "ora";
import chalk from "chalk";
import { loadConfig } from "../state/manager.js";
import { logger } from "../utils/logger.js";
import { TransiaError, ExitCode } from "../utils/errors.js";

interface WidgetOptions {
  verbose?: boolean;
}

function detectFramework(projectRoot: string): "nextjs" | "react" {
  const pkgPath = resolve(projectRoot, "package.json");
  if (!existsSync(pkgPath)) return "react";
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    if (deps.next) return "nextjs";
  } catch {
    // ignore
  }
  return "react";
}

function detectPackageManager(
  projectRoot: string,
): "pnpm" | "yarn" | "npm" {
  if (existsSync(resolve(projectRoot, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(resolve(projectRoot, "yarn.lock"))) return "yarn";
  return "npm";
}

function runInstall(
  pm: "pnpm" | "yarn" | "npm",
  packages: string[],
  projectRoot: string,
  verbose: boolean,
): void {
  const cmd = pm;
  const args =
    pm === "yarn"
      ? ["add", ...packages]
      : pm === "pnpm"
        ? ["add", ...packages]
        : ["install", ...packages];
  execFileSync(cmd, args, {
    cwd: projectRoot,
    stdio: verbose ? "inherit" : "pipe",
  });
}

function isInstalled(
  projectRoot: string,
  packageName: string,
): boolean {
  const pkgPath = resolve(projectRoot, "package.json");
  if (!existsSync(pkgPath)) return false;
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    return packageName in deps;
  } catch {
    return false;
  }
}

const LOCALE_REGEX = /^[a-z]{2}(-[A-Z]{2})?$/;

function validateLocales(locales: string[]): void {
  for (const locale of locales) {
    if (!LOCALE_REGEX.test(locale)) {
      throw new TransiaError(
        ExitCode.CONFIG_ERROR,
        `Invalid locale "${locale}". Expected format: "en" or "en-US".`,
      );
    }
  }
}

/**
 * Generate the TransiaLanguageSwitcher wrapper for Next.js (next-intl).
 */
function generateNextIntlWidget(
  locales: string[],
  publicKey?: string,
): string {
  validateLocales(locales);
  const localesList = locales.map((l) => `"${l}"`).join(", ");
  const projectIdProp = publicKey
    ? ` projectId="${publicKey}"`
    : "";
  return `"use client";

import { TransiaWidget } from "transia-widget";
import { createNextIntlProps } from "transia-widget/next-intl";
import { useLocale } from "next-intl";
import { useRouter, usePathname } from "@/i18n/routing";

export function TransiaLanguageSwitcher() {
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();

  const widgetProps = createNextIntlProps({
    locales: [${localesList}],
    currentLocale: locale,
    onLocaleChange: (newLocale) => {
      router.replace(pathname, { locale: newLocale });
    },
  });

  return <TransiaWidget {...widgetProps}${projectIdProp} showBranding />;
}
`;
}

/**
 * Generate the TransiaLanguageSwitcher wrapper for React (i18next).
 */
function generateI18nextWidget(
  locales: string[],
  publicKey?: string,
): string {
  validateLocales(locales);
  const localesList = locales.map((l) => `"${l}"`).join(", ");
  const projectIdProp = publicKey
    ? ` projectId="${publicKey}"`
    : "";
  return `import { TransiaWidget } from "transia-widget";
import { createI18nextProps } from "transia-widget/i18next";
import { useTranslation } from "react-i18next";

export function TransiaLanguageSwitcher() {
  const { i18n } = useTranslation();

  const widgetProps = createI18nextProps({
    locales: [${localesList}],
    currentLanguage: i18n.language,
    changeLanguage: (lng) => i18n.changeLanguage(lng),
  });

  return <TransiaWidget {...widgetProps}${projectIdProp} showBranding />;
}
`;
}

/**
 * Find the layout file for Next.js projects.
 */
function findNextLayout(projectRoot: string): string | null {
  const candidates = [
    "app/[locale]/layout.tsx",
    "app/[locale]/layout.jsx",
    "app/layout.tsx",
    "app/layout.jsx",
  ];
  for (const name of candidates) {
    const full = resolve(projectRoot, name);
    if (existsSync(full)) return full;
  }
  return null;
}

/**
 * Find the root App component for React projects.
 */
function findReactApp(projectRoot: string): string | null {
  const candidates = [
    "src/App.tsx",
    "src/App.jsx",
    "src/app.tsx",
    "src/app.jsx",
  ];
  for (const name of candidates) {
    const full = resolve(projectRoot, name);
    if (existsSync(full)) return full;
  }
  return null;
}

/**
 * Inject the widget component import and usage into a layout/app file.
 */
function injectWidgetIntoFile(filePath: string): boolean {
  const source = readFileSync(filePath, "utf-8");

  // Check if already injected
  if (source.includes("TransiaLanguageSwitcher")) {
    logger.info("TransiaLanguageSwitcher already present in layout, skipping.");
    return false;
  }

  // Determine relative import path for the widget component
  const fileDir = dirname(filePath);
  let importPath: string;

  // Check for components directory at various levels
  if (filePath.includes("/app/[locale]/")) {
    importPath = "@/components/TransiaLanguageSwitcher";
  } else if (filePath.includes("/app/")) {
    importPath = "@/components/TransiaLanguageSwitcher";
  } else if (filePath.includes("/src/")) {
    importPath = "./components/TransiaLanguageSwitcher";
  } else {
    importPath = "./components/TransiaLanguageSwitcher";
  }

  let modified = source;

  // Add import statement after the last import
  const lines = modified.split("\n");
  let lastImportIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    if (
      lines[i].startsWith("import ") ||
      lines[i].startsWith("import{")
    ) {
      lastImportIndex = i;
    }
  }

  const importLine = `import { TransiaLanguageSwitcher } from "${importPath}";`;

  if (lastImportIndex >= 0) {
    lines.splice(lastImportIndex + 1, 0, importLine);
  } else {
    lines.unshift(importLine);
  }

  modified = lines.join("\n");

  // Inject the component before the closing </body>, </div>, or </main> tag
  // Strategy: find the last closing tag of the main wrapper and inject before it
  const injectionPatterns = [
    // Before </body> (Next.js layout)
    { find: /(\s*)<\/body>/, replace: `$1  <TransiaLanguageSwitcher />\n$1</body>` },
    // Before the closing </div> of the main wrapper (common pattern)
    { find: /(\s*)<\/div>\s*<\/ThemeProvider>/,
      replace: `$1  <TransiaLanguageSwitcher />\n$1</div>\n$1</ThemeProvider>` },
  ];

  let injected = false;
  for (const pattern of injectionPatterns) {
    if (pattern.find.test(modified)) {
      modified = modified.replace(pattern.find, pattern.replace);
      injected = true;
      break;
    }
  }

  // Fallback: inject before the last return statement's closing parenthesis
  if (!injected) {
    // Find the return statement with JSX and inject before its last closing tag
    const returnMatch = modified.match(/return\s*\(\s*\n?([\s\S]*)\);?\s*\}?\s*$/);
    if (returnMatch) {
      // Simple approach: add component before the last two closing lines
      const lastCloseParen = modified.lastIndexOf(");");
      if (lastCloseParen !== -1) {
        // Find the line before the closing paren
        const beforeClose = modified.lastIndexOf("\n", lastCloseParen);
        if (beforeClose !== -1) {
          const indent = modified.slice(beforeClose + 1, lastCloseParen).match(/^(\s*)/)?.[1] ?? "      ";
          modified =
            modified.slice(0, beforeClose) +
            "\n" +
            indent + "  <TransiaLanguageSwitcher />" +
            modified.slice(beforeClose);
          injected = true;
        }
      }
    }
  }

  if (!injected) {
    logger.warn(
      "Could not auto-inject <TransiaLanguageSwitcher /> into layout. Please add it manually.",
    );
    return false;
  }

  writeFileSync(filePath, modified, "utf-8");
  return true;
}

export async function widgetCommand(
  projectRoot: string,
  options: WidgetOptions,
): Promise<void> {
  if (options.verbose) {
    logger.setLevel("debug");
  }

  const config = loadConfig(projectRoot);
  const framework = detectFramework(projectRoot);
  const pm = detectPackageManager(projectRoot);
  const allLocales = [config.sourceLocale, ...config.targetLocales];
  const created: string[] = [];

  console.log("");
  console.log(
    `  ${chalk.dim("Detected:")} ${framework === "nextjs" ? "Next.js" : "React"} project`,
  );
  console.log(
    `  ${chalk.dim("Locales:")}  ${allLocales.join(", ")}`,
  );
  console.log("");

  // 1. Install transia-widget
  if (!isInstalled(projectRoot, "transia-widget")) {
    const spinner = ora("Installing transia-widget...").start();
    try {
      runInstall(pm, ["transia-widget"], projectRoot, !!options.verbose);
      spinner.succeed("Installed transia-widget");
    } catch (error) {
      spinner.fail("Failed to install transia-widget");
      throw new TransiaError(
        ExitCode.GENERAL_ERROR,
        `Failed to install transia-widget: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  } else {
    logger.info("transia-widget already installed, skipping.");
  }

  // 2. Generate the wrapper component
  const componentsDir = existsSync(resolve(projectRoot, "src", "components"))
    ? resolve(projectRoot, "src", "components")
    : existsSync(resolve(projectRoot, "components"))
      ? resolve(projectRoot, "components")
      : existsSync(resolve(projectRoot, "src"))
        ? resolve(projectRoot, "src", "components")
        : resolve(projectRoot, "components");

  mkdirSync(componentsDir, { recursive: true });

  const widgetPath = resolve(componentsDir, "TransiaLanguageSwitcher.tsx");
  if (!existsSync(widgetPath)) {
    const publicKey = (config as Record<string, unknown>).publicKey as
      | string
      | undefined;
    const widgetContent =
      config.output.format === "next-intl"
        ? generateNextIntlWidget(allLocales, publicKey)
        : generateI18nextWidget(allLocales, publicKey);

    writeFileSync(widgetPath, widgetContent, "utf-8");
    created.push(widgetPath.replace(projectRoot + "/", ""));
  } else {
    logger.info("TransiaLanguageSwitcher.tsx already exists, skipping.");
  }

  // 3. Inject widget into layout/app file
  const spinner = ora("Injecting widget into layout...").start();

  let layoutFile: string | null;
  if (framework === "nextjs") {
    layoutFile = findNextLayout(projectRoot);
  } else {
    layoutFile = findReactApp(projectRoot);
  }

  let injected = false;
  if (layoutFile) {
    injected = injectWidgetIntoFile(layoutFile);
    if (injected) {
      spinner.succeed(
        `Injected <TransiaLanguageSwitcher /> into ${layoutFile.replace(projectRoot + "/", "")}`,
      );
      created.push(`${layoutFile.replace(projectRoot + "/", "")} (modified)`);
    } else {
      spinner.info("Widget already present or manual injection needed.");
    }
  } else {
    spinner.warn(
      "Could not find layout file. Please add <TransiaLanguageSwitcher /> manually.",
    );
  }

  // Summary
  console.log("");
  console.log(chalk.green.bold("  Language switcher widget added!"));
  console.log("");

  if (created.length > 0) {
    console.log(`  ${chalk.dim("Created/Modified:")}`);
    for (const file of created) {
      console.log(`    ${chalk.cyan(file)}`);
    }
    console.log("");
  }

  console.log(
    `  The floating language switcher will appear in the ${chalk.bold("bottom-right")} corner.`,
  );
  console.log(
    `  Customize it by editing ${chalk.yellow(widgetPath.replace(projectRoot + "/", ""))}.`,
  );
  console.log("");

  if (!injected && layoutFile) {
    console.log(chalk.yellow.bold("  Manual step required:"));
    console.log("");
    console.log(
      `  Add ${chalk.cyan("<TransiaLanguageSwitcher />")} to your layout:`,
    );
    console.log("");
    console.log(
      chalk.dim(
        `    import { TransiaLanguageSwitcher } from "${framework === "nextjs" ? "@/components" : "./components"}/TransiaLanguageSwitcher";`,
      ),
    );
    console.log("");
    console.log(chalk.dim("    // Inside your layout/App return:"));
    console.log(chalk.dim("    <TransiaLanguageSwitcher />"));
    console.log("");
  }
}
