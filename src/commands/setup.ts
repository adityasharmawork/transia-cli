import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { resolve, relative } from "node:path";
import { execFileSync } from "node:child_process";
import ora from "ora";
import chalk from "chalk";
import { loadConfig } from "../state/manager.js";
import { logger } from "../utils/logger.js";
import { TransiaError, ExitCode } from "../utils/errors.js";
import {
  cookieRequestConfig,
  localesModule,
  wrapLayoutForNextIntl,
  addNextIntlPlugin,
} from "../setup/next-cookie.js";
import { safeWriteFile } from "../transform/safe-write.js";

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
): { installed: string[]; created: string[]; skipped: string[] } {
  const installed: string[] = [];
  const created: string[] = [];
  const skipped: string[] = [];
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

  // 2. Cookie-mode i18n config: a request config that reads the locale from a
  //    cookie, and a locales module. No routing.ts, no middleware.ts — the old
  //    prefix middleware 404'd every route because pages were never moved under
  //    app/[locale]/. Cookie mode keeps pages exactly where they are.
  const i18nDir = resolve(projectRoot, "i18n");
  mkdirSync(i18nDir, { recursive: true });
  const requestPath = resolve(i18nDir, "request.ts");
  if (!existsSync(requestPath)) {
    writeFileSync(
      requestPath,
      cookieRequestConfig(config.sourceLocale, allLocales, config.output.path),
      "utf-8",
    );
    created.push("i18n/request.ts");
  }
  const localesPath = resolve(i18nDir, "locales.ts");
  if (!existsSync(localesPath)) {
    writeFileSync(localesPath, localesModule(config.sourceLocale, allLocales), "utf-8");
    created.push("i18n/locales.ts");
  }

  // 3. Messages directory with source locale JSON.
  const messagesDir = resolve(projectRoot, config.output.path);
  mkdirSync(messagesDir, { recursive: true });
  const sourceLocalePath = resolve(messagesDir, `${config.sourceLocale}.json`);
  if (!existsSync(sourceLocalePath)) {
    writeFileSync(sourceLocalePath, "{}\n", "utf-8");
    created.push(`${config.output.path}/${config.sourceLocale}.json`);
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupDir = resolve(projectRoot, ".transia-backup", timestamp);
  const rel = (p: string) => relative(projectRoot, p);

  // 4. Wrap the root layout with NextIntlClientProvider (safe: backup + re-parse;
  //    skip with instructions if the layout isn't the standard shape).
  const layoutPath = findRootLayout(projectRoot);
  if (layoutPath) {
    const result = wrapLayoutForNextIntl(readFileSync(layoutPath, "utf-8"));
    if (result.wrapped) {
      const outcome = safeWriteFile(layoutPath, result.output, {
        backupPath: resolve(backupDir, rel(layoutPath)),
      });
      if (outcome === "written") {
        created.push(`${rel(layoutPath)} (wrapped with NextIntlClientProvider)`);
      } else {
        skipped.push(`${rel(layoutPath)} — transform did not re-parse; wrap it manually.`);
      }
    } else {
      skipped.push(
        `${rel(layoutPath)} — ${result.reason}. Wrap the <body> children in <NextIntlClientProvider messages={messages}> (with a server-side getLocale/getMessages) yourself.`,
      );
    }
  } else {
    skipped.push("Root layout not found — add NextIntlClientProvider to app/layout.tsx manually.");
  }

  // 5. Add the next-intl plugin to next.config (safe).
  const nextConfigPath = findNextConfig(projectRoot);
  if (nextConfigPath) {
    const current = readFileSync(nextConfigPath, "utf-8");
    const r = addNextIntlPlugin(current);
    if (r.changed) {
      const outcome = safeWriteFile(nextConfigPath, r.output, {
        backupPath: resolve(backupDir, rel(nextConfigPath)),
      });
      if (outcome === "written") {
        created.push(`${rel(nextConfigPath)} (next-intl plugin added)`);
      } else {
        skipped.push(`${rel(nextConfigPath)} — plugin edit did not re-parse; add it manually.`);
      }
    } else if (!current.includes("next-intl/plugin")) {
      skipped.push(
        `${rel(nextConfigPath)} — wrap your config export in createNextIntlPlugin("./i18n/request.ts") manually.`,
      );
    }
  } else {
    skipped.push("next.config not found — add the next-intl plugin manually.");
  }

  return { installed, created, skipped };
}

function findRootLayout(projectRoot: string): string | null {
  const candidates = [
    "src/app/layout.tsx",
    "src/app/layout.jsx",
    "app/layout.tsx",
    "app/layout.jsx",
  ];
  for (const name of candidates) {
    const full = resolve(projectRoot, name);
    if (existsSync(full)) return full;
  }
  return null;
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

// --- React + i18next setup ---

function setupI18next(
  projectRoot: string,
  config: import("../state/schema.js").TransiaConfig,
  pm: "pnpm" | "yarn" | "npm",
  options: SetupOptions,
): { installed: string[]; created: string[]; skipped: string[] } {
  const installed: string[] = [];
  const created: string[] = [];
  const skipped: string[] = [];
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

  return { installed, created, skipped };
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

  let result: { installed: string[]; created: string[]; skipped: string[] };

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

  if (result.skipped.length > 0) {
    console.log("");
    console.log(`  ${chalk.yellow("Needs a manual step:")}`);
    for (const note of result.skipped) {
      console.log(`    ${chalk.yellow("•")} ${note}`);
    }
  }

  console.log("");
  console.log(chalk.bold("  Next steps:"));
  console.log("");

  if (config.output.format === "next-intl") {
    console.log(
      `  ${chalk.cyan("1.")} Run ${chalk.green("transia translate")} to generate translation files`,
    );
    console.log(
      `  ${chalk.cyan("2.")} Run ${chalk.green("transia apply")} to replace hardcoded strings with t() calls`,
    );
    console.log(
      `  ${chalk.cyan("3.")} Run ${chalk.green("transia widget")} to add the language switcher (it sets the ${chalk.yellow("NEXT_LOCALE")} cookie)`,
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
