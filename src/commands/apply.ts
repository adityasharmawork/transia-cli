import { readFileSync, existsSync } from "node:fs";
import { resolve, relative } from "node:path";
import { execFileSync } from "node:child_process";
import { glob } from "glob";
import ora from "ora";
import chalk from "chalk";
import { loadConfig, loadState } from "../state/manager.js";
import { generateKey } from "../utils/crypto.js";
import { recordCandidates, type Candidate } from "../parser/candidates.js";
import { isLikelyUserFacing } from "../parser/classify.js";
import { planHooks, planImports, type HookFormat } from "../transform/hooks.js";
import { buildEdit, safeWriteFile, undoLatest, unifiedDiff } from "../transform/safe-write.js";
import { logger } from "../utils/logger.js";
import { TransiaError, ExitCode } from "../utils/errors.js";

interface ApplyOptions {
  dryRun?: boolean;
  verbose?: boolean;
  undo?: boolean;
  typecheck?: boolean; // commander --no-typecheck sets this false; default true
}

export interface TransformOptions {
  knownHashes: Set<string>;
  format: HookFormat;
  excludeAttributes?: string[];
}

export interface TransformResult {
  output: string;
  wrapped: number;
  skippedComponents: string[];
}

/** Build the replacement text for a single recorded site. */
function buildReplacement(c: Candidate, tName: string, source: string): string {
  const key = generateKey(c.sanitized, c.hash);

  if (c.role === "template") {
    const parts = (c.interpolations ?? []).map(
      (i) => `${i.name}: ${source.slice(i.exprStart, i.exprEnd)}`,
    );
    return parts.length > 0
      ? `${tName}("${key}", { ${parts.join(", ")} })`
      : `${tName}("${key}")`;
  }

  const call = `${tName}("${key}")`;
  // jsx-text and a bare attribute (attr="literal") need a container; an
  // attribute that already used {...} must not get doubled braces.
  if (c.role === "jsx-text") return `{${call}}`;
  if (c.role === "jsx-attr") return c.attrExpressionContainer ? call : `{${call}}`;
  return call;
}

/**
 * The pure core of `apply`: given a file's source and the set of hashes known
 * to be translated, return the transformed source. Replaces ONLY recorded,
 * user-facing, already-translated sites (by exact byte range), inserts a
 * scope-correct hook per component, and leaves everything else byte-for-byte
 * unchanged. Returns the input unchanged when there is nothing safe to do.
 */
export function transformSource(
  source: string,
  filePath: string,
  opts: TransformOptions,
): TransformResult {
  const exclude = opts.excludeAttributes ?? [];
  const candidates = recordCandidates(source, filePath);

  let keep = candidates.filter(
    (c) => isLikelyUserFacing(c, exclude) && opts.knownHashes.has(c.hash),
  );
  if (keep.length === 0) {
    return { output: source, wrapped: 0, skippedComponents: [] };
  }

  const componentPaths = [
    ...new Set(keep.map((c) => c.componentPath).filter((p) => p !== "")),
  ];
  const hookPlan = planHooks(source, componentPaths, opts.format);

  // Drop sites whose component could not be safely wired with a hook.
  keep = keep.filter(
    (c) => c.componentPath !== "" && !hookPlan.skippedComponents.has(c.componentPath),
  );
  const skipped = [...hookPlan.skippedComponents.keys()];
  if (keep.length === 0) {
    return { output: source, wrapped: 0, skippedComponents: skipped };
  }

  const edits = keep.map((c) => ({
    start: c.start,
    end: c.end,
    replacement: buildReplacement(
      c,
      hookPlan.tNameByComponent.get(c.componentPath) ?? "t",
      source,
    ),
  }));

  const insertions = [
    ...hookPlan.insertions,
    ...planImports(source, hookPlan.importSpecs),
  ];

  const output = buildEdit(source, edits, insertions);
  return { output, wrapped: keep.length, skippedComponents: skipped };
}

function runTypecheck(projectRoot: string): boolean {
  if (!existsSync(resolve(projectRoot, "tsconfig.json"))) return true; // nothing to check
  try {
    execFileSync("npx", ["tsc", "--noEmit"], {
      cwd: projectRoot,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return true;
  } catch {
    return false;
  }
}

export async function applyCommand(
  projectRoot: string,
  options: ApplyOptions,
): Promise<void> {
  if (options.verbose) logger.setLevel("debug");

  if (options.undo) {
    const n = undoLatest(projectRoot);
    logger.info(
      n > 0
        ? `Restored ${n} file(s) from the most recent backup.`
        : "No backup found to undo.",
    );
    return;
  }

  // Safety: warn on uncommitted changes (advisory; the real net is backup + validate).
  if (!options.dryRun && existsSync(resolve(projectRoot, ".git"))) {
    try {
      const status = execFileSync("git", ["status", "--porcelain"], {
        cwd: projectRoot,
        stdio: ["pipe", "pipe", "pipe"],
      })
        .toString()
        .trim();
      if (status.length > 0) {
        logger.warn(
          "You have uncommitted changes. 'transia apply' backs up every file it " +
            "rewrites (restore with 'transia apply --undo'), but committing first is " +
            "still recommended.",
        );
      }
    } catch {
      // not a git repo / git unavailable — skip
    }
  }

  const config = loadConfig(projectRoot);
  const state = loadState(projectRoot);
  const knownHashes = new Set(Object.keys(state.strings));
  if (knownHashes.size === 0) {
    throw new TransiaError(
      ExitCode.STATE_ERROR,
      'No translations found. Run "transia translate" first.',
    );
  }
  const excludeAttributes = config.apply?.excludeAttributes ?? [];
  const format = config.output.format as HookFormat;

  const spinner = ora("Discovering source files...").start();
  const files: string[] = [];
  for (const pattern of config.include) {
    const matched = await glob(pattern, {
      cwd: projectRoot,
      ignore: config.exclude,
      absolute: true,
    });
    files.push(...matched);
  }
  const uniqueFiles = [...new Set(files)];
  spinner.succeed(`Found ${uniqueFiles.length} source files`);
  if (uniqueFiles.length === 0) {
    logger.warn("No source files found.");
    return;
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupDir = resolve(projectRoot, ".transia-backup", timestamp);

  const applySpinner = ora("Applying translations to source files...").start();
  const modified: Array<{ file: string; count: number }> = [];
  const skippedFiles: string[] = [];
  const diffs: string[] = [];
  let totalWrapped = 0;
  let skippedComponentCount = 0;

  for (const file of uniqueFiles) {
    const source = readFileSync(file, "utf-8");
    const relPath = relative(projectRoot, file);

    let result: TransformResult;
    try {
      result = transformSource(source, relPath, { knownHashes, format, excludeAttributes });
    } catch (error) {
      skippedFiles.push(relPath);
      logger.debug(
        `Skipped ${relPath}: ${error instanceof Error ? error.message : String(error)}`,
      );
      continue;
    }

    skippedComponentCount += result.skippedComponents.length;

    if (result.output === source) continue; // nothing to do / idempotent

    if (options.dryRun) {
      diffs.push(unifiedDiff(relPath, source, result.output));
      modified.push({ file: relPath, count: result.wrapped });
      totalWrapped += result.wrapped;
      continue;
    }

    const backupPath = resolve(backupDir, relPath);
    const outcome = safeWriteFile(file, result.output, { backupPath });
    if (outcome === "written") {
      modified.push({ file: relPath, count: result.wrapped });
      totalWrapped += result.wrapped;
    } else {
      skippedFiles.push(relPath);
      logger.warn(`Skipped ${relPath}: the transform would not re-parse.`);
    }
  }

  applySpinner.succeed(`Processed ${uniqueFiles.length} files`);

  // Typecheck gate (on by default; skipped in dry-run or with --no-typecheck).
  if (!options.dryRun && options.typecheck !== false && modified.length > 0) {
    const tcSpinner = ora("Type-checking changed files...").start();
    if (runTypecheck(projectRoot)) {
      tcSpinner.succeed("Type check passed");
    } else {
      tcSpinner.fail("Type check failed");
      const restored = undoLatest(projectRoot);
      throw new TransiaError(
        ExitCode.PARSE_ERROR,
        `Type check failed after apply; restored ${restored} file(s) from backup. ` +
          `Re-run with --no-typecheck to skip this gate.`,
      );
    }
  }

  // Summary
  console.log("");
  if (options.dryRun) {
    console.log(chalk.yellow.bold("  Dry run — no files were modified"));
    console.log("");
    for (const d of diffs) console.log(d);
  }

  if (modified.length === 0) {
    console.log(
      chalk.green(
        "  Nothing to apply — source files are already using t() calls (or no translated strings matched).",
      ),
    );
  } else {
    console.log(
      chalk.green.bold(
        `  ${options.dryRun ? "Would apply" : "Applied"} ${totalWrapped} replacements across ${modified.length} files:`,
      ),
    );
    console.log("");
    for (const { file, count } of modified) {
      console.log(`    ${chalk.cyan(file)} — ${count} string(s)`);
    }
    console.log("");
    if (!options.dryRun) {
      console.log(
        chalk.dim(
          "  Originals backed up. Review with `git diff`; undo with `transia apply --undo`.",
        ),
      );
      console.log("");
    }
  }

  if (skippedFiles.length > 0) {
    console.log(
      chalk.yellow(
        `  ${skippedFiles.length} file(s) skipped for safety (unsafe transform or unwireable hook).`,
      ),
    );
    console.log("");
  }

  if (skippedComponentCount > 0) {
    console.log(
      chalk.yellow(
        `  ${skippedComponentCount} component(s) left untouched (could not wire a hook safely — ` +
          `e.g. a parenthesized arrow body). Their strings were not wrapped.`,
      ),
    );
    console.log("");
  }
}
