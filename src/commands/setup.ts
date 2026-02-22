import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import ora from "ora";
import chalk from "chalk";
import { loadConfig } from "../state/manager.js";
import { logger } from "../utils/logger.js";
import { TransiaError, ExitCode } from "../utils/errors.js";

interface SetupOptions {
  verbose?: boolean;
}

/**
 * Detect project framework from package.json dependencies.
 */
function detectFramework(projectRoot: string): "nextjs" | "react" {
  const pkgPath = resolve(projectRoot, "package.json");
  if (!existsSync(pkgPath)) {
    return "react";
  }
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    if (deps.next) return "nextjs";
  } catch {
    // ignore
  }
  return "react";
}

/**
 * Detect package manager from lock files.
 */
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

/**
 * Check if a package is already installed.
 */
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

// --- Next.js + next-intl setup ---

function setupNextIntl(
  projectRoot: string,
  config: import("../state/schema.js").TransiaConfig,
  pm: "pnpm" | "yarn" | "npm",
  options: SetupOptions,
): { installed: string[]; created: string[] } {
  const installed: string[] = [];
  const created: string[] = [];
  const allLocales = [config.sourceLocale, ...config.targetLocales];

  // 1. Install next-intl if not present
  if (!isInstalled(projectRoot, "next-intl")) {
    const spinner = ora("Installing next-intl...").start();
    try {
      runInstall(pm, ["next-intl"], projectRoot, !!options.verbose);
      spinner.succeed("Installed next-intl");
      installed.push("next-intl");
    } catch (error) {
      spinner.fail("Failed to install next-intl");
      throw new TransiaError(
        ExitCode.GENERAL_ERROR,
        `Failed to install next-intl: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  } else {
    logger.info("next-intl already installed, skipping.");
  }

  // 2. Create i18n/request.ts config
  const i18nDir = resolve(projectRoot, "i18n");
  const i18nRequestPath = resolve(i18nDir, "request.ts");
  if (!existsSync(i18nRequestPath)) {
    mkdirSync(i18nDir, { recursive: true });
    writeFileSync(
      i18nRequestPath,
      generateNextIntlRequestConfig(config.sourceLocale, allLocales),
      "utf-8",
    );
    created.push("i18n/request.ts");
  }

  // 3. Create i18n/routing.ts
  const i18nRoutingPath = resolve(i18nDir, "routing.ts");
  if (!existsSync(i18nRoutingPath)) {
    writeFileSync(
      i18nRoutingPath,
      generateNextIntlRoutingConfig(config.sourceLocale, allLocales),
      "utf-8",
    );
    created.push("i18n/routing.ts");
  }

  // 4. Create middleware.ts
  const middlewarePath = resolve(projectRoot, "middleware.ts");
  if (!existsSync(middlewarePath)) {
    writeFileSync(
      middlewarePath,
      generateNextIntlMiddleware(),
      "utf-8",
    );
    created.push("middleware.ts");
  }

  // 5. Create messages directory with source locale JSON if not exists
  const messagesDir = resolve(projectRoot, config.output.path);
  mkdirSync(messagesDir, { recursive: true });
  const sourceLocalePath = resolve(messagesDir, `${config.sourceLocale}.json`);
  if (!existsSync(sourceLocalePath)) {
    writeFileSync(sourceLocalePath, "{}\n", "utf-8");
    created.push(`${config.output.path}/${config.sourceLocale}.json`);
  }

  // 6. Update next.config.ts to include next-intl plugin
  const nextConfigPath = findNextConfig(projectRoot);
  if (nextConfigPath) {
    const nextConfig = readFileSync(nextConfigPath, "utf-8");
    if (!nextConfig.includes("next-intl")) {
      const updatedConfig = wrapNextConfig(nextConfig);
      writeFileSync(nextConfigPath, updatedConfig, "utf-8");
      created.push(nextConfigPath.replace(projectRoot + "/", ""));
    }
  }

  return { installed, created };
}

function generateNextIntlRequestConfig(
  defaultLocale: string,
  locales: string[],
): string {
  return `import { getRequestConfig } from "next-intl/server";
import { routing } from "./routing";

export default getRequestConfig(async ({ requestLocale }) => {
  let locale = await requestLocale;

  if (!locale || !routing.locales.includes(locale as any)) {
    locale = routing.defaultLocale;
  }

  return {
    locale,
    messages: (await import(\`../${locales.length > 0 ? "locales" : "messages"}/\${locale}.json\`)).default,
  };
});
`;
}

function generateNextIntlRoutingConfig(
  defaultLocale: string,
  locales: string[],
): string {
  const localesList = locales.map((l) => `"${l}"`).join(", ");
  return `import { defineRouting } from "next-intl/routing";
import { createNavigation } from "next-intl/navigation";

export const routing = defineRouting({
  locales: [${localesList}],
  defaultLocale: "${defaultLocale}",
});

export const { Link, redirect, usePathname, useRouter, getPathname } =
  createNavigation(routing);
`;
}

function generateNextIntlMiddleware(): string {
  return `import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

export default createMiddleware(routing);

export const config = {
  matcher: ["/((?!api|_next|_vercel|.*\\\\..*).*)"],
};
`;
}

function findNextConfig(projectRoot: string): string | null {
  const candidates = [
    "next.config.ts",
    "next.config.mjs",
    "next.config.js",
  ];
  for (const name of candidates) {
    const full = resolve(projectRoot, name);
    if (existsSync(full)) return full;
  }
  return null;
}

function wrapNextConfig(source: string): string {
  // Add createNextIntlPlugin import at the top
  const importLine =
    'import createNextIntlPlugin from "next-intl/plugin";\n';

  // Add the plugin wrapper before the export
  const pluginLine = "const withNextIntl = createNextIntlPlugin();\n\n";

  // Replace "export default nextConfig" with "export default withNextIntl(nextConfig)"
  let result = source;

  // Add import at the very top (after any other imports)
  if (result.includes("import ")) {
    // Find the last import line
    const lines = result.split("\n");
    let lastImportIndex = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith("import ")) {
        lastImportIndex = i;
      }
    }
    if (lastImportIndex >= 0) {
      lines.splice(lastImportIndex + 1, 0, importLine.trimEnd());
      result = lines.join("\n");
    }
  } else {
    result = importLine + result;
  }

  // Add the plugin variable before the config declaration
  if (result.includes("const nextConfig")) {
    result = result.replace(
      "const nextConfig",
      pluginLine + "const nextConfig",
    );
  }

  // Wrap the export
  result = result.replace(
    /export default nextConfig;?/,
    "export default withNextIntl(nextConfig);",
  );

  return result;
}

// --- React + i18next setup ---

function setupI18next(
  projectRoot: string,
  config: import("../state/schema.js").TransiaConfig,
  pm: "pnpm" | "yarn" | "npm",
  options: SetupOptions,
): { installed: string[]; created: string[] } {
  const installed: string[] = [];
  const created: string[] = [];
  const allLocales = [config.sourceLocale, ...config.targetLocales];

  // 1. Install i18next and react-i18next
  const packagesToInstall: string[] = [];
  if (!isInstalled(projectRoot, "i18next")) {
    packagesToInstall.push("i18next");
  }
  if (!isInstalled(projectRoot, "react-i18next")) {
    packagesToInstall.push("react-i18next");
  }
  if (!isInstalled(projectRoot, "i18next-browser-languagedetector")) {
    packagesToInstall.push("i18next-browser-languagedetector");
  }

  if (packagesToInstall.length > 0) {
    const spinner = ora(
      `Installing ${packagesToInstall.join(", ")}...`,
    ).start();
    try {
      runInstall(pm, packagesToInstall, projectRoot, !!options.verbose);
      spinner.succeed(`Installed ${packagesToInstall.join(", ")}`);
      installed.push(...packagesToInstall);
    } catch (error) {
      spinner.fail("Failed to install i18next packages");
      throw new TransiaError(
        ExitCode.GENERAL_ERROR,
        `Failed to install i18next: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  } else {
    logger.info("i18next packages already installed, skipping.");
  }

  // 2. Create i18n.ts config file
  const srcDir = resolve(projectRoot, "src");
  const i18nConfigPath = existsSync(srcDir)
    ? resolve(srcDir, "i18n.ts")
    : resolve(projectRoot, "i18n.ts");
  if (!existsSync(i18nConfigPath)) {
    writeFileSync(
      i18nConfigPath,
      generateI18nextConfig(config.sourceLocale, allLocales, config.output.path),
      "utf-8",
    );
    const relativePath = i18nConfigPath.replace(projectRoot + "/", "");
    created.push(relativePath);
  }

  // 3. Create locale directories with empty translation.json
  for (const locale of allLocales) {
    const localeDir = resolve(projectRoot, config.output.path, locale);
    const translationFile = resolve(localeDir, "translation.json");
    mkdirSync(localeDir, { recursive: true });
    if (!existsSync(translationFile)) {
      writeFileSync(translationFile, "{}\n", "utf-8");
      created.push(`${config.output.path}/${locale}/translation.json`);
    }
  }

  // 4. Inject i18n import into main entry file
  const entryFile = findReactEntry(projectRoot);
  if (entryFile) {
    const entrySource = readFileSync(entryFile, "utf-8");
    if (!entrySource.includes("./i18n") && !entrySource.includes("i18n.ts")) {
      // Add import at the top of the file, before other imports
      const i18nImport = 'import "./i18n";\n';
      const updatedEntry = i18nImport + entrySource;
      writeFileSync(entryFile, updatedEntry, "utf-8");
      const relativePath = entryFile.replace(projectRoot + "/", "");
      created.push(`${relativePath} (modified)`);
    }
  }

  return { installed, created };
}

function generateI18nextConfig(
  defaultLocale: string,
  locales: string[],
  outputPath: string,
): string {
  const imports: string[] = [];
  const resources: string[] = [];

  for (const locale of locales) {
    const varName = locale.replace("-", "_");
    imports.push(
      `import ${varName} from "../${outputPath}/${locale}/translation.json";`,
    );
    resources.push(`    "${locale}": { translation: ${varName} },`);
  }

  return `import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";
${imports.join("\n")}

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
${resources.join("\n")}
    },
    fallbackLng: "${defaultLocale}",
    interpolation: {
      escapeValue: false,
    },
  });

export default i18n;
`;
}

function findReactEntry(projectRoot: string): string | null {
  const candidates = [
    "src/main.tsx",
    "src/main.jsx",
    "src/index.tsx",
    "src/index.jsx",
    "src/main.ts",
    "src/index.ts",
  ];
  for (const name of candidates) {
    const full = resolve(projectRoot, name);
    if (existsSync(full)) return full;
  }
  return null;
}

// --- Main command ---

export async function setupCommand(
  projectRoot: string,
  options: SetupOptions,
): Promise<void> {
  if (options.verbose) {
    logger.setLevel("debug");
  }

  const config = loadConfig(projectRoot);
  const framework = detectFramework(projectRoot);
  const pm = detectPackageManager(projectRoot);

  console.log("");
  console.log(
    `  ${chalk.dim("Detected:")} ${framework === "nextjs" ? "Next.js" : "React"} project using ${pm}`,
  );
  console.log(
    `  ${chalk.dim("Format:")}   ${config.output.format}`,
  );
  console.log(
    `  ${chalk.dim("Locales:")}  ${[config.sourceLocale, ...config.targetLocales].join(", ")}`,
  );
  console.log("");

  // Validate format matches framework
  if (framework === "nextjs" && config.output.format !== "next-intl") {
    logger.warn(
      `Next.js detected but output format is "${config.output.format}". Consider using "next-intl" format.`,
    );
  }
  if (framework === "react" && config.output.format !== "i18next") {
    logger.warn(
      `React detected but output format is "${config.output.format}". Consider using "i18next" format.`,
    );
  }

  let result: { installed: string[]; created: string[] };

  if (config.output.format === "next-intl") {
    result = setupNextIntl(projectRoot, config, pm, options);
  } else {
    result = setupI18next(projectRoot, config, pm, options);
  }

  // Summary
  console.log(chalk.green.bold("  i18n setup complete!"));
  console.log("");

  if (result.installed.length > 0) {
    console.log(`  ${chalk.dim("Installed:")} ${result.installed.join(", ")}`);
  }

  if (result.created.length > 0) {
    console.log(`  ${chalk.dim("Created/Modified:")}`);
    for (const file of result.created) {
      console.log(`    ${chalk.cyan(file)}`);
    }
  }

  console.log("");
  console.log(chalk.bold("  Next steps:"));
  console.log("");

  if (config.output.format === "next-intl") {
    console.log(
      `  ${chalk.cyan("1.")} Move your pages into ${chalk.yellow("app/[locale]/")} directory for locale routing`,
    );
    console.log(
      `  ${chalk.cyan("2.")} Wrap your layout content with ${chalk.yellow("<NextIntlClientProvider>")}`,
    );
    console.log(
      `  ${chalk.cyan("3.")} Run ${chalk.green("transia translate")} to generate translation files`,
    );
    console.log(
      `  ${chalk.cyan("4.")} Run ${chalk.green("transia apply")} to replace hardcoded strings with t() calls`,
    );
    console.log(
      `  ${chalk.cyan("5.")} Run ${chalk.green("transia widget")} to add the language switcher`,
    );
  } else {
    console.log(
      `  ${chalk.cyan("1.")} Run ${chalk.green("transia translate")} to generate translation files`,
    );
    console.log(
      `  ${chalk.cyan("2.")} Run ${chalk.green("transia apply")} to replace hardcoded strings with t() calls`,
    );
    console.log(
      `  ${chalk.cyan("3.")} Run ${chalk.green("transia widget")} to add the language switcher`,
    );
  }

  console.log("");
}
