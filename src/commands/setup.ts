import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  copyFileSync,
  unlinkSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { resolve, relative, dirname } from "node:path";
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
import {
  routingModule,
  navigationModule,
  prefixRequestConfig,
  middlewareSource,
  localeLayoutTemplate,
  nextMajorFromPackage,
  middlewareFilename,
  computeMovePlan,
  transformLayoutForPrefix,
  metadataHelperModule,
  sitemapModule,
} from "../setup/next-prefix.js";
import { safeWriteFile } from "../transform/safe-write.js";

interface SetupOptions {
  verbose?: boolean;
  /** Next.js: use SEO URL-prefix routing instead of cookie mode. */
  seo?: boolean;
  /** With seo: automatically move routes under app/[locale] (guarded). */
  move?: boolean;
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

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupDir = resolve(projectRoot, ".transia-backup", timestamp);
  const rel = (p: string) => relative(projectRoot, p);
  const backupAndRemove = (p: string): void => {
    const dest = resolve(backupDir, rel(p));
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(p, dest);
    unlinkSync(p);
  };

  // 2. Cookie-mode i18n config: a request config that reads the locale from a
  //    cookie, and a locales module. No routing.ts, no middleware.ts — the old
  //    prefix middleware 404'd every route because pages were never moved under
  //    app/[locale]/. Cookie mode keeps pages exactly where they are.
  const i18nDir = resolve(projectRoot, "i18n");
  mkdirSync(i18nDir, { recursive: true });
  const requestPath = resolve(i18nDir, "request.ts");
  const requestSrc = cookieRequestConfig(config.sourceLocale, allLocales, config.output.path);
  const existingRequest = existsSync(requestPath) ? readFileSync(requestPath, "utf-8") : null;
  if (existingRequest === null) {
    writeFileSync(requestPath, requestSrc, "utf-8");
    created.push("i18n/request.ts");
  } else if (
    existingRequest.includes("requestLocale") ||
    existingRequest.includes("./routing")
  ) {
    // Migrate an old prefix-mode request config to cookie mode (backup first).
    const outcome = safeWriteFile(requestPath, requestSrc, {
      backupPath: resolve(backupDir, rel(requestPath)),
    });
    if (outcome === "written") created.push("i18n/request.ts (migrated prefix → cookie mode)");
  }
  const localesPath = resolve(i18nDir, "locales.ts");
  if (!existsSync(localesPath)) {
    writeFileSync(localesPath, localesModule(config.sourceLocale, allLocales), "utf-8");
    created.push("i18n/locales.ts");
  }

  // 2b. Remove a stale next-intl prefix middleware (it 404s in cookie mode).
  for (const mw of [
    resolve(projectRoot, "middleware.ts"),
    resolve(projectRoot, "src", "middleware.ts"),
  ]) {
    if (!existsSync(mw)) continue;
    const mwSrc = readFileSync(mw, "utf-8");
    if (mwSrc.includes("next-intl/middleware") || mwSrc.includes("createMiddleware")) {
      backupAndRemove(mw);
      created.push(`${rel(mw)} (removed — cookie mode needs no middleware; backed up)`);
    } else {
      skipped.push(
        `${rel(mw)} exists — if it adds next-intl prefix routing, remove it (cookie mode needs no middleware).`,
      );
    }
  }

  // 3. Messages directory with source locale JSON.
  const messagesDir = resolve(projectRoot, config.output.path);
  mkdirSync(messagesDir, { recursive: true });
  const sourceLocalePath = resolve(messagesDir, `${config.sourceLocale}.json`);
  if (!existsSync(sourceLocalePath)) {
    writeFileSync(sourceLocalePath, "{}\n", "utf-8");
    created.push(`${config.output.path}/${config.sourceLocale}.json`);
  }

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

// --- Next.js + next-intl SEO prefix-mode setup ---

function git(projectRoot: string, args: string[]): string {
  return execFileSync("git", args, { cwd: projectRoot, encoding: "utf-8" });
}

function isCleanGitTree(projectRoot: string): boolean {
  try {
    return git(projectRoot, ["status", "--porcelain"]).trim() === "";
  } catch {
    return false; // not a git repo (or git missing) — we need git for rollback
  }
}

function hasPathAlias(projectRoot: string): boolean {
  for (const name of ["tsconfig.json", "jsconfig.json"]) {
    const p = resolve(projectRoot, name);
    if (!existsSync(p)) continue;
    try {
      const json = JSON.parse(readFileSync(p, "utf-8"));
      const paths = json?.compilerOptions?.paths;
      if (paths && Object.keys(paths).some((k) => k.startsWith("@/"))) return true;
    } catch {
      // ignore malformed tsconfig
    }
  }
  return false;
}

/**
 * Default runBuild: run the project's Next.js build. Returns true on success.
 * Injected in tests (a real `next build` can't run against a fixture).
 */
function runNextBuild(projectRoot: string, pm: "pnpm" | "yarn" | "npm", verbose: boolean): boolean {
  const args = pm === "npm" ? ["run", "build"] : ["build"];
  try {
    execFileSync(pm, args, { cwd: projectRoot, stdio: verbose ? "inherit" : "pipe" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Guarded automated move of routes under app/[locale]/ (opt-in `--move`).
 * Requires a clean git tree, executes the move plan, transforms the moved root
 * layout, verifies with `next build`, and rolls everything back via git if the
 * build fails. Relative-import breakage (projects without a `@/*` alias) is
 * caught by the build-verify + rollback rather than rewritten.
 */
function runGuardedMove(
  projectRoot: string,
  appDirRel: string,
  layoutRoutingImport: string,
  scaffoldArtifacts: string[],
  runBuild: (projectRoot: string) => boolean,
): { created: string[]; skipped: string[] } {
  const created: string[] = [];
  const skipped: string[] = [];

  const appAbs = resolve(projectRoot, appDirRel);
  const entries = readdirSync(appAbs, { withFileTypes: true }).map((d) => ({
    name: d.name,
    isDir: d.isDirectory(),
  }));
  const plan = computeMovePlan(entries, appDirRel);
  if (plan.move.length === 0) {
    skipped.push(`${appDirRel} has nothing to move under [locale].`);
    return { created, skipped };
  }

  if (!hasPathAlias(projectRoot)) {
    skipped.push(
      "No `@/*` path alias detected — relative imports may break when files move. If `next build` fails, the move is rolled back automatically; then use the guided (non---move) steps.",
    );
  }
  // `git mv` relocates whole directories, so git-ignored files inside a moved
  // route folder (e.g. a local scratch file) are physically moved and cannot be
  // restored from git on rollback. Warn rather than silently risk them.
  skipped.push(
    "Note: --move uses `git mv`, which relocates git-ignored files inside moved route folders too (they can't be restored from git on rollback).",
  );

  const localeDir = resolve(appAbs, "[locale]");

  const rollback = (): void => {
    try {
      git(projectRoot, ["reset", "--hard", "HEAD"]);
    } catch {
      /* best effort */
    }
    // Remove untracked scaffold artifacts and the (now re-emptied) [locale] dir.
    // rmSync of the [locale] dir clears any untracked file left there (e.g. a
    // freshly written template); we avoid `git clean` with a "[locale]" pathspec
    // because the brackets are a glob character class, not a literal.
    for (const p of scaffoldArtifacts) {
      try {
        rmSync(p, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
    rmSync(localeDir, { recursive: true, force: true });
  };

  try {
    mkdirSync(localeDir, { recursive: true });
    for (const m of plan.moves) {
      git(projectRoot, ["mv", m.from, m.to]);
    }

    // Transform the moved root layout into a [locale] layout.
    const movedLayout = ["layout.tsx", "layout.jsx"]
      .map((n) => resolve(localeDir, n))
      .find((p) => existsSync(p));
    if (movedLayout) {
      const result = transformLayoutForPrefix(readFileSync(movedLayout, "utf-8"), layoutRoutingImport);
      if (result.wrapped) {
        writeFileSync(movedLayout, result.output, "utf-8");
        created.push(`${appDirRel}/[locale]/${movedLayout.endsWith(".jsx") ? "layout.jsx" : "layout.tsx"} (moved + adapted for next-intl)`);
      } else {
        skipped.push(
          `${appDirRel}/[locale]/layout — ${result.reason}. Adapt it for next-intl (read locale from params, set <html lang>, wrap with NextIntlClientProvider).`,
        );
      }
    } else {
      // No root layout existed; drop in the template so [locale] has one.
      const layoutPath = resolve(localeDir, "layout.tsx");
      writeFileSync(layoutPath, localeLayoutTemplate(layoutRoutingImport), "utf-8");
      created.push(`${appDirRel}/[locale]/layout.tsx`);
    }

    if (!runBuild(projectRoot)) {
      rollback();
      throw new TransiaError(
        ExitCode.GENERAL_ERROR,
        "`next build` failed after the move — rolled everything back. Use `transia setup --seo` (without --move) and follow the guided checklist.",
      );
    }

    created.push(`${appDirRel}/[locale]/ (routes moved: ${plan.move.join(", ")})`);
    return { created, skipped };
  } catch (error) {
    if (error instanceof TransiaError) throw error;
    rollback();
    throw new TransiaError(
      ExitCode.GENERAL_ERROR,
      `The move failed and was rolled back: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * next-intl SEO prefix-mode setup: scaffold routing/navigation/request +
 * middleware(proxy) + an app/[locale] layout, add the next-intl plugin, and
 * either print a guided move checklist (default) or perform the guarded
 * automated move (`--move`). The default path never moves routes or clobbers
 * existing files.
 */
export function setupNextIntlPrefix(
  projectRoot: string,
  config: import("../state/schema.js").TransiaConfig,
  pm: "pnpm" | "yarn" | "npm",
  options: SetupOptions,
  runBuild?: (projectRoot: string) => boolean,
): { installed: string[]; created: string[]; skipped: string[] } {
  const installed: string[] = [];
  const created: string[] = [];
  const skipped: string[] = [];
  const allLocales = [config.sourceLocale, ...config.targetLocales];

  // --move preconditions, checked BEFORE any writes so the clean-tree gate is
  // meaningful and rollback (`git reset --hard`) can't uninstall dependencies.
  if (options.move) {
    if (!isInstalled(projectRoot, "next-intl")) {
      throw new TransiaError(
        ExitCode.CONFIG_ERROR,
        "--move needs next-intl already installed. Run `transia setup --seo` first (installs + scaffolds), then re-run with --move.",
      );
    }
    if (!isCleanGitTree(projectRoot)) {
      throw new TransiaError(
        ExitCode.GENERAL_ERROR,
        "--move needs a clean git tree (so it can roll back). Commit or stash your changes and re-run.",
      );
    }
  }

  // 1. Install next-intl if needed.
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

  // Next major -> middleware.ts vs proxy.ts; app under src/?
  let nextMajor: number | null = null;
  try {
    nextMajor = nextMajorFromPackage(
      JSON.parse(readFileSync(resolve(projectRoot, "package.json"), "utf-8")),
    );
  } catch {
    nextMajor = null;
  }
  const mwFile = middlewareFilename(nextMajor);
  const srcApp = existsSync(resolve(projectRoot, "src", "app"));
  const appDirRel = srcApp ? "src/app" : "app";
  const layoutRoutingImport = srcApp ? "../../../i18n/routing" : "../../i18n/routing";
  // i18n always lives at <root>/i18n. Next discovers middleware/proxy next to the
  // app: at <root> for a root app, under src/ for a src/app project. The routing
  // import is relative to the middleware's location: `./i18n/routing` from root,
  // `../i18n/routing` from src/ (src/<mw> -> ../i18n = <root>/i18n).
  const mwDir = srcApp ? resolve(projectRoot, "src") : projectRoot;
  const mwRoutingImport = srcApp ? "../i18n/routing" : "./i18n/routing";

  const artifacts: string[] = [];
  const writeNew = (absPath: string, contents: string, label: string): void => {
    if (existsSync(absPath)) return;
    mkdirSync(dirname(absPath), { recursive: true });
    writeFileSync(absPath, contents, "utf-8");
    created.push(label);
    artifacts.push(absPath);
  };

  // 2. i18n modules at <root>/i18n.
  const i18nDir = resolve(projectRoot, "i18n");
  writeNew(
    resolve(i18nDir, "routing.ts"),
    routingModule(config.sourceLocale, allLocales, "as-needed"),
    "i18n/routing.ts",
  );
  writeNew(resolve(i18nDir, "navigation.ts"), navigationModule(), "i18n/navigation.ts");
  const requestPath = resolve(i18nDir, "request.ts");
  if (!existsSync(requestPath)) {
    writeNew(requestPath, prefixRequestConfig(config.output.path), "i18n/request.ts");
  } else {
    skipped.push("i18n/request.ts exists — ensure it reads `requestLocale` (prefix mode), not a cookie.");
  }

  // 3. middleware.ts (Next <=15) / proxy.ts (Next >=16), next to the app
  //    (project root, or src/ for a src/app project so Next discovers it).
  const mwPath = resolve(mwDir, mwFile);
  const otherMw = resolve(mwDir, mwFile === "proxy.ts" ? "middleware.ts" : "proxy.ts");
  const mwRel = relative(projectRoot, mwPath);
  if (!existsSync(mwPath) && !existsSync(otherMw)) {
    mkdirSync(dirname(mwPath), { recursive: true });
    writeFileSync(mwPath, middlewareSource(mwRoutingImport), "utf-8");
    created.push(mwRel);
    artifacts.push(mwPath);
  } else {
    skipped.push(`${mwRel} (or an existing middleware/proxy) — ensure it calls createMiddleware(routing).`);
  }

  // 4. messages dir + source-locale JSON.
  const messagesDir = resolve(projectRoot, config.output.path);
  mkdirSync(messagesDir, { recursive: true });
  const sourceLocalePath = resolve(messagesDir, `${config.sourceLocale}.json`);
  if (!existsSync(sourceLocalePath)) {
    writeFileSync(sourceLocalePath, "{}\n", "utf-8");
    created.push(`${config.output.path}/${config.sourceLocale}.json`);
    artifacts.push(sourceLocalePath);
  }

  // 5. next.config: add the next-intl plugin.
  const nextConfigPath = findNextConfig(projectRoot);
  if (nextConfigPath) {
    const current = readFileSync(nextConfigPath, "utf-8");
    const r = addNextIntlPlugin(current);
    if (r.changed) {
      const backupPath = resolve(
        projectRoot,
        ".transia-backup",
        "next-config",
        relative(projectRoot, nextConfigPath),
      );
      const outcome = safeWriteFile(nextConfigPath, r.output, { backupPath });
      if (outcome === "written") {
        created.push(`${relative(projectRoot, nextConfigPath)} (next-intl plugin added)`);
        // Track the backup so a --move rollback removes it too; otherwise the
        // untracked backup would leave the tree dirty and trap the next --move.
        artifacts.push(backupPath);
      }
    } else if (!current.includes("next-intl/plugin")) {
      skipped.push(
        `${relative(projectRoot, nextConfigPath)} — wrap your config in createNextIntlPlugin("./i18n/request.ts") manually.`,
      );
    }
  } else {
    skipped.push("next.config not found — add the next-intl plugin manually.");
  }

  const appAbs = resolve(projectRoot, appDirRel);

  // 5b. hreflang helper + localized sitemap (needs an absolute origin).
  if (config.siteUrl) {
    writeNew(
      resolve(i18nDir, "metadata.ts"),
      metadataHelperModule(config.siteUrl),
      "i18n/metadata.ts",
    );
    const sitemapImportBase = srcApp ? "../../i18n" : "../i18n";
    const sitemapPath = resolve(appAbs, "sitemap.ts");
    if (existsSync(sitemapPath)) {
      skipped.push(`${appDirRel}/sitemap.ts exists — add per-locale alternates.languages yourself.`);
    } else {
      writeNew(
        sitemapPath,
        sitemapModule(config.siteUrl, `${sitemapImportBase}/routing`, `${sitemapImportBase}/navigation`),
        `${appDirRel}/sitemap.ts`,
      );
    }
  } else {
    skipped.push(
      'Set "siteUrl" in transia.config.json to generate a localized sitemap + an hreflang getAlternates() helper.',
    );
  }

  // 6a. --move: guarded automated restructure (transforms the real root layout).
  if (options.move) {
    if (!existsSync(appAbs)) {
      skipped.push(`${appDirRel} not found — nothing to move.`);
      return { installed, created, skipped };
    }
    const build = runBuild ?? ((root: string) => runNextBuild(root, pm, !!options.verbose));
    const moveResult = runGuardedMove(projectRoot, appDirRel, layoutRoutingImport, artifacts, build);
    created.push(...moveResult.created);
    skipped.push(...moveResult.skipped);
    return { installed, created, skipped };
  }

  // 6b. Default (no --move): print the guided move checklist. Never move routes,
  //     never clobber. Only scaffold the [locale] layout template when there is
  //     NO root layout to move — otherwise the printed `git mv app/layout.tsx
  //     app/[locale]/layout.tsx` would collide with a template we just wrote.
  const hasRootLayout =
    existsSync(resolve(appAbs, "layout.tsx")) || existsSync(resolve(appAbs, "layout.jsx"));
  if (!hasRootLayout) {
    writeNew(
      resolve(appAbs, "[locale]", "layout.tsx"),
      localeLayoutTemplate(layoutRoutingImport),
      `${appDirRel}/[locale]/layout.tsx`,
    );
  }

  if (existsSync(appAbs)) {
    const entries = readdirSync(appAbs, { withFileTypes: true }).map((d) => ({
      name: d.name,
      isDir: d.isDirectory(),
    }));
    const plan = computeMovePlan(entries, appDirRel);
    if (plan.move.length > 0) {
      const adaptNote = hasRootLayout
        ? "\n      Then adapt the moved app/[locale]/layout.tsx for next-intl (read `locale` from params, set <html lang>, wrap with <NextIntlClientProvider>)."
        : "";
      skipped.push(
        "To finish prefix routing, move your routes under [locale] (commit/clean first), then run `next build`:\n" +
          plan.gitMvCommands.map((c) => "      " + c).join("\n") +
          adaptNote +
          "\n      Heads-up: `git mv` relocates whole directories, so any git-ignored files inside moved route folders move too." +
          "\n      (or re-run `transia setup --seo --move` to do this automatically with a build-verify rollback)",
      );
    }
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

  const usePrefix = options.seo || config.routing === "prefix";
  if (config.output.format === "next-intl") {
    if (usePrefix) {
      console.log(`  ${chalk.dim("Routing:")}  SEO URL-prefix mode (/es/...)`);
      console.log("");
    }
    result = usePrefix
      ? setupNextIntlPrefix(projectRoot, config, pm, options)
      : setupNextIntl(projectRoot, config, pm, options);
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
