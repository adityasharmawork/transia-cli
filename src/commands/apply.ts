import { readFileSync, writeFileSync } from "node:fs";
import { resolve, relative } from "node:path";
import { glob } from "glob";
import ora from "ora";
import chalk from "chalk";
import { parse } from "@babel/parser";
import { createRequire } from "node:module";
import { loadConfig, loadState } from "../state/manager.js";
import { hashString } from "../utils/crypto.js";
import { sanitizeForPrompt } from "../parser/sanitizer.js";
import { isTranslatableAttribute, isTranslatableString } from "../parser/filters.js";
import { logger } from "../utils/logger.js";
import { TransiaError, ExitCode } from "../utils/errors.js";

const require = createRequire(import.meta.url);
const traverse =
  require("@babel/traverse").default ?? require("@babel/traverse");

interface ApplyOptions {
  dryRun?: boolean;
  verbose?: boolean;
}

interface Replacement {
  start: number;
  end: number;
  original: string;
  replacement: string;
  type: "jsx-text" | "jsx-attr" | "string-literal" | "template-literal";
}

/**
 * Generate a stable key from original string + hash (must match formats.ts logic exactly).
 */
function generateKey(original: string, hash: string): string {
  const base = original
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .trim()
    .replace(/\s+/g, "_")
    .slice(0, 50);
  return base ? `${base}_${hash.slice(0, 6)}` : hash.slice(0, 16);
}

/**
 * Build a lookup map: sanitized original text -> translation key
 */
function buildOriginalToKeyMap(
  state: import("../state/schema.js").TransiaState,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const [hash, entry] of Object.entries(state.strings)) {
    const key = generateKey(entry.original, hash);
    map.set(entry.original, key);
  }
  return map;
}

/**
 * Determine the t() function name and import based on output format.
 */
function getI18nImport(format: "next-intl" | "i18next"): {
  hookImport: string;
  hookCall: string;
  tFunction: string;
} {
  if (format === "next-intl") {
    return {
      hookImport: 'import { useTranslations } from "next-intl";',
      hookCall: "const t = useTranslations();",
      tFunction: "t",
    };
  }
  return {
    hookImport: 'import { useTranslation } from "react-i18next";',
    hookCall: "const { t } = useTranslation();",
    tFunction: "t",
  };
}

/**
 * Check if a node is inside a JSX tree (mirrors extractor.ts logic).
 */
function isInsideJSX(path: any): boolean {
  let current = path;
  while (current) {
    const type = current.node?.type;
    if (
      type === "JSXElement" ||
      type === "JSXFragment" ||
      type === "JSXAttribute" ||
      type === "JSXExpressionContainer"
    ) {
      return true;
    }
    current = current.parentPath;
  }
  return false;
}

function isInsideImport(path: any): boolean {
  let current = path;
  while (current) {
    if (current.node?.type === "ImportDeclaration") return true;
    current = current.parentPath;
  }
  return false;
}

function isInsideSkippableCall(path: any): boolean {
  let current = path.parentPath;
  while (current) {
    if (current.node?.type === "CallExpression") {
      const callee = current.node.callee;
      if (
        callee.type === "MemberExpression" &&
        callee.object?.type === "Identifier" &&
        callee.object.name === "console"
      ) {
        return true;
      }
      if (callee.type === "Identifier") {
        if (["require"].includes(callee.name)) return true;
      }
      if (callee.type === "Import") return true;
      if (
        callee.type === "Identifier" &&
        [
          "test",
          "describe",
          "it",
          "expect",
          "beforeEach",
          "afterEach",
          "beforeAll",
          "afterAll",
        ].includes(callee.name)
      ) {
        return true;
      }
    }
    if (current.node?.type === "TaggedTemplateExpression") {
      const tag = current.node.tag;
      if (
        tag.type === "MemberExpression" &&
        tag.object?.type === "Identifier" &&
        tag.object.name === "styled"
      ) {
        return true;
      }
      if (
        tag.type === "Identifier" &&
        ["css", "keyframes", "createGlobalStyle", "injectGlobal"].includes(
          tag.name,
        )
      ) {
        return true;
      }
    }
    current = current.parentPath;
  }
  return false;
}

function isSkippedAttribute(path: any): boolean {
  const parent = path.parentPath;
  if (!parent) return false;
  if (parent.node?.type === "JSXAttribute") {
    const attrName = parent.node.name?.name;
    if (typeof attrName === "string" && !isTranslatableAttribute(attrName)) {
      return true;
    }
  }
  const grandparent = parent.parentPath;
  if (
    parent.node?.type === "JSXExpressionContainer" &&
    grandparent?.node?.type === "JSXAttribute"
  ) {
    const attrName = grandparent.node.name?.name;
    if (typeof attrName === "string" && !isTranslatableAttribute(attrName)) {
      return true;
    }
  }
  return false;
}

/**
 * Check if a file already has the i18n hook imported.
 */
function hasI18nImport(source: string, format: "next-intl" | "i18next"): boolean {
  if (format === "next-intl") {
    return source.includes("useTranslations");
  }
  return source.includes("useTranslation");
}

/**
 * Check if a file already has the t hook call.
 */
function hasHookCall(source: string, format: "next-intl" | "i18next"): boolean {
  if (format === "next-intl") {
    return /const\s+t\s*=\s*useTranslations\s*\(/.test(source);
  }
  return /const\s*\{\s*t\s*\}\s*=\s*useTranslation\s*\(/.test(source);
}

/**
 * Find the position to inject the hook import (after the last import statement).
 */
function findImportInsertPosition(ast: any): number {
  let lastImportEnd = 0;
  for (const node of ast.program.body) {
    if (node.type === "ImportDeclaration") {
      lastImportEnd = node.end;
    }
  }
  return lastImportEnd;
}

/**
 * Find the first line inside a React component function body
 * to insert the hook call.
 */
function findHookInsertPosition(ast: any, source: string): number | null {
  let bestPosition: number | null = null;

  traverse(ast, {
    // Look for function components that return JSX
    FunctionDeclaration(path: any) {
      if (containsJSXReturn(path) && bestPosition === null) {
        bestPosition = findBodyStart(path, source);
      }
    },
    ArrowFunctionExpression(path: any) {
      if (containsJSXReturn(path) && bestPosition === null) {
        // Only top-level or exported arrow functions
        const parentType = path.parent?.type;
        if (
          parentType === "VariableDeclarator" ||
          parentType === "ExportDefaultDeclaration"
        ) {
          bestPosition = findBodyStart(path, source);
        }
      }
    },
    FunctionExpression(path: any) {
      if (containsJSXReturn(path) && bestPosition === null) {
        const parentType = path.parent?.type;
        if (parentType === "VariableDeclarator") {
          bestPosition = findBodyStart(path, source);
        }
      }
    },
  });

  return bestPosition;
}

function containsJSXReturn(path: any): boolean {
  let found = false;
  path.traverse({
    ReturnStatement(retPath: any) {
      const arg = retPath.node.argument;
      if (
        arg &&
        (arg.type === "JSXElement" ||
          arg.type === "JSXFragment" ||
          arg.type === "ParenthesizedExpression")
      ) {
        found = true;
      }
    },
    JSXElement() {
      found = true;
    },
    JSXFragment() {
      found = true;
    },
  });
  return found;
}

function findBodyStart(path: any, source: string): number {
  const body = path.node.body;
  if (body.type === "BlockStatement") {
    // Insert after the opening brace
    const openBrace = body.start;
    // Find the newline after the opening brace
    const afterBrace = source.indexOf("\n", openBrace);
    return afterBrace !== -1 ? afterBrace + 1 : openBrace + 1;
  }
  // Arrow function with expression body — can't easily inject hook
  return body.start;
}

/**
 * Process a single file: find translatable strings and create replacements.
 */
function processFile(
  source: string,
  filePath: string,
  keyMap: Map<string, string>,
): Replacement[] {
  const replacements: Replacement[] = [];

  let ast;
  try {
    ast = parse(source, {
      sourceType: "module",
      plugins: ["jsx", "typescript", "decorators-legacy"],
      errorRecovery: true,
    });
  } catch {
    logger.warn(`Failed to parse ${filePath}, skipping.`);
    return [];
  }

  traverse(ast, {
    // Direct JSX text: <p>Hello World</p>
    JSXText(path: any) {
      const rawValue = path.node.value;
      const trimmed = rawValue.trim();
      if (!trimmed || !isTranslatableString(trimmed)) return;

      const { sanitized } = sanitizeForPrompt(trimmed, `${filePath}`);
      const key = keyMap.get(sanitized);
      if (!key) return;

      replacements.push({
        start: path.node.start,
        end: path.node.end,
        original: rawValue,
        replacement: `{t("${key}")}`,
        type: "jsx-text",
      });
    },

    // String literals in JSX context
    StringLiteral(path: any) {
      if (isInsideImport(path)) return;
      if (isInsideSkippableCall(path)) return;
      if (isSkippedAttribute(path)) return;

      const parent = path.parentPath;
      if (!parent) return;
      const parentType = parent.node?.type;

      // JSXAttribute: <input placeholder="Enter name" />
      if (parentType === "JSXAttribute") {
        const attrName = parent.node.name?.name;
        if (
          typeof attrName === "string" &&
          isTranslatableAttribute(attrName)
        ) {
          const { sanitized } = sanitizeForPrompt(
            path.node.value,
            filePath,
          );
          const key = keyMap.get(sanitized);
          if (!key) return;

          // Replace "Enter name" with {t("key")}
          replacements.push({
            start: path.node.start,
            end: path.node.end,
            original: path.node.value,
            replacement: `{t("${key}")}`,
            type: "jsx-attr",
          });
          return;
        }
      }

      // JSXExpressionContainer: <p>{"Hello"}</p>
      if (parentType === "JSXExpressionContainer") {
        const { sanitized } = sanitizeForPrompt(
          path.node.value,
          filePath,
        );
        const key = keyMap.get(sanitized);
        if (!key) return;

        replacements.push({
          start: path.node.start,
          end: path.node.end,
          original: path.node.value,
          replacement: `t("${key}")`,
          type: "string-literal",
        });
        return;
      }

      // ConditionalExpression inside JSX: {cond ? "Yes" : "No"}
      if (parentType === "ConditionalExpression" && isInsideJSX(parent)) {
        const { sanitized } = sanitizeForPrompt(
          path.node.value,
          filePath,
        );
        const key = keyMap.get(sanitized);
        if (!key) return;

        replacements.push({
          start: path.node.start,
          end: path.node.end,
          original: path.node.value,
          replacement: `t("${key}")`,
          type: "string-literal",
        });
        return;
      }

      // Array expressions inside JSX
      if (parentType === "ArrayExpression" && isInsideJSX(parent)) {
        const { sanitized } = sanitizeForPrompt(
          path.node.value,
          filePath,
        );
        const key = keyMap.get(sanitized);
        if (!key) return;

        replacements.push({
          start: path.node.start,
          end: path.node.end,
          original: path.node.value,
          replacement: `t("${key}")`,
          type: "string-literal",
        });
        return;
      }

      // General string inside JSXExpressionContainer
      if (isInsideJSX(path) && parentType !== "ObjectProperty") {
        const inExpContainer = path.findParent(
          (p: any) => p.node?.type === "JSXExpressionContainer",
        );
        if (inExpContainer) {
          const { sanitized } = sanitizeForPrompt(
            path.node.value,
            filePath,
          );
          const key = keyMap.get(sanitized);
          if (!key) return;

          replacements.push({
            start: path.node.start,
            end: path.node.end,
            original: path.node.value,
            replacement: `t("${key}")`,
            type: "string-literal",
          });
        }
      }
    },

    // Template literals inside JSX: <p>{`Welcome ${name}`}</p>
    TemplateLiteral(path: any) {
      if (isInsideSkippableCall(path)) return;
      if (path.parent?.type === "TaggedTemplateExpression") return;
      if (!isInsideJSX(path)) return;

      const quasis = path.node.quasis;
      const expressions = path.node.expressions;

      // Build the same representation as the extractor
      let fullText = "";
      for (let i = 0; i < quasis.length; i++) {
        fullText += quasis[i].value.cooked ?? quasis[i].value.raw;
        if (i < expressions.length) {
          const expr = expressions[i];
          const name =
            expr.type === "Identifier"
              ? expr.name
              : expr.type === "MemberExpression" &&
                  expr.property?.type === "Identifier"
                ? expr.property.name
                : `expr${i}`;
          fullText += `{${name}}`;
        }
      }

      const { sanitized } = sanitizeForPrompt(fullText, filePath);
      const key = keyMap.get(sanitized);
      if (!key) return;

      // Build the t() call with interpolation params
      const params: string[] = [];
      for (let i = 0; i < expressions.length; i++) {
        const expr = expressions[i];
        const exprSource = source.slice(expr.start, expr.end);
        const name =
          expr.type === "Identifier"
            ? expr.name
            : expr.type === "MemberExpression" &&
                expr.property?.type === "Identifier"
              ? expr.property.name
              : `expr${i}`;
        params.push(`${name}: ${exprSource}`);
      }

      const tCall =
        params.length > 0
          ? `t("${key}", { ${params.join(", ")} })`
          : `t("${key}")`;

      replacements.push({
        start: path.node.start,
        end: path.node.end,
        original: fullText,
        replacement: tCall,
        type: "template-literal",
      });
    },
  });

  return replacements;
}

/**
 * Apply replacements to source, working from end to start to preserve positions.
 */
function applyReplacements(source: string, replacements: Replacement[]): string {
  // Sort by start position descending so we don't shift indices
  const sorted = [...replacements].sort((a, b) => b.start - a.start);

  let result = source;
  for (const rep of sorted) {
    result = result.slice(0, rep.start) + rep.replacement + result.slice(rep.end);
  }
  return result;
}

/**
 * Add the i18n import and hook call to a file if not already present.
 */
function addI18nBoilerplate(
  source: string,
  format: "next-intl" | "i18next",
): string {
  let result = source;
  const i18n = getI18nImport(format);

  // Add import if missing
  if (!hasI18nImport(result, format)) {
    let ast;
    try {
      ast = parse(result, {
        sourceType: "module",
        plugins: ["jsx", "typescript", "decorators-legacy"],
        errorRecovery: true,
      });
    } catch {
      return result;
    }

    const importPos = findImportInsertPosition(ast);
    if (importPos > 0) {
      result =
        result.slice(0, importPos) +
        "\n" +
        i18n.hookImport +
        result.slice(importPos);
    } else {
      result = i18n.hookImport + "\n" + result;
    }
  }

  // Add hook call if missing
  if (!hasHookCall(result, format)) {
    let ast;
    try {
      ast = parse(result, {
        sourceType: "module",
        plugins: ["jsx", "typescript", "decorators-legacy"],
        errorRecovery: true,
      });
    } catch {
      return result;
    }

    const hookPos = findHookInsertPosition(ast, result);
    if (hookPos !== null) {
      // Detect indentation at insert position
      const lineStart = result.lastIndexOf("\n", hookPos - 1) + 1;
      const nextLineStart = hookPos;
      const nextLine = result.slice(
        nextLineStart,
        result.indexOf("\n", nextLineStart),
      );
      const indent = nextLine.match(/^(\s*)/)?.[1] ?? "  ";

      result =
        result.slice(0, hookPos) +
        indent +
        i18n.hookCall +
        "\n" +
        result.slice(hookPos);
    }
  }

  return result;
}

export async function applyCommand(
  projectRoot: string,
  options: ApplyOptions,
): Promise<void> {
  if (options.verbose) {
    logger.setLevel("debug");
  }

  // Load config and state
  const config = loadConfig(projectRoot);
  const state = loadState(projectRoot);

  // Check if translations exist
  const hasTranslations = Object.keys(state.strings).length > 0;
  if (!hasTranslations) {
    throw new TransiaError(
      ExitCode.STATE_ERROR,
      'No translations found. Run "transia translate" first.',
    );
  }

  // Build the original-text-to-key map
  const keyMap = buildOriginalToKeyMap(state);
  logger.debug(`Loaded ${keyMap.size} translation keys from state`);

  // Discover source files
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

  // Process each file
  const applySpinner = ora("Applying translations to source files...").start();

  let totalReplacements = 0;
  let filesModified = 0;
  const modifiedFiles: Array<{ file: string; count: number }> = [];

  for (const file of uniqueFiles) {
    const source = readFileSync(file, "utf-8");
    const relativePath = relative(projectRoot, file);

    // Skip files that are already fully translated (contain t() calls but no raw strings)
    const replacements = processFile(source, relativePath, keyMap);

    if (replacements.length === 0) continue;

    // Apply string replacements
    let modified = applyReplacements(source, replacements);

    // Add import and hook call
    modified = addI18nBoilerplate(modified, config.output.format);

    if (modified !== source) {
      if (options.dryRun) {
        modifiedFiles.push({ file: relativePath, count: replacements.length });
      } else {
        writeFileSync(file, modified, "utf-8");
        modifiedFiles.push({ file: relativePath, count: replacements.length });
      }
      totalReplacements += replacements.length;
      filesModified++;
    }
  }

  applySpinner.succeed(
    `Processed ${uniqueFiles.length} files`,
  );

  // Summary
  console.log("");
  if (options.dryRun) {
    console.log(chalk.yellow.bold("  Dry run — no files were modified"));
    console.log("");
  }

  if (filesModified === 0) {
    console.log(
      chalk.green(
        "  All source files are already using t() calls. Nothing to apply.",
      ),
    );
  } else {
    console.log(
      chalk.green.bold(
        `  ${options.dryRun ? "Would apply" : "Applied"} ${totalReplacements} replacements across ${filesModified} files:`,
      ),
    );
    console.log("");
    for (const { file, count } of modifiedFiles) {
      console.log(`    ${chalk.cyan(file)} — ${count} string(s)`);
    }
    console.log("");

    if (!options.dryRun) {
      console.log(
        chalk.dim(
          "  Tip: Review the changes with `git diff` and test your app before committing.",
        ),
      );
      console.log("");
    }
  }
}
