import { parse } from "@babel/parser";
import type { Comment } from "@babel/types";
import { isTranslatableString } from "./filters.js";
import { sanitizeForPrompt } from "./sanitizer.js";
import { hashString } from "../utils/crypto.js";
import { logger } from "../utils/logger.js";

import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const traverse = require("@babel/traverse").default ?? require("@babel/traverse");

export type CandidateRole =
  | "jsx-text"
  | "jsx-attr"
  | "jsx-expr-string"
  | "conditional"
  | "template";

/**
 * A single translatable site in a source file, identified by its exact byte
 * range — NOT by its text. Both extraction and application consume the same
 * records, so they can never disagree about what to touch. Classification
 * (is this user-facing copy?) is a separate concern (see classify.ts); this
 * recorder only records sites and the context a classifier needs.
 */
export interface Candidate {
  /** Byte offset of the span to replace (== source.slice(start,end)). */
  start: number;
  end: number;
  role: CandidateRole;
  /** For jsx-attr: the attribute name (e.g. "alt", "className"). */
  attribute?: string;
  /** For jsx-attr: true when the value was ALREADY in `{...}` (e.g. title={"x"}). */
  attrExpressionContainer?: boolean;
  /** True if the string is an operand of a comparison (===, !==, <, > ...). */
  insideComparison: boolean;
  /** Nearest enclosing call callee name (e.g. "cn", "clsx", "t"). */
  insideCall?: string;
  /** sanitizeForPrompt output — what gets hashed and translated. */
  sanitized: string;
  /** Content hash of `sanitized` (stable key input). */
  hash: string;
  /** Stable id of the enclosing component function (start offset as string). */
  componentPath: string;
  /** transia-context comment for the file, if any. */
  context: string | null;
  /** 1-based source line. */
  line: number;
  /** Template interpolation expressions, in order. */
  interpolations?: { name: string; exprStart: number; exprEnd: number }[];
}

const COMPARISON_OPERATORS = new Set(["==", "===", "!=", "!==", "<", ">", "<=", ">="]);

function extractTransiaContext(comments?: Comment[] | null): string | null {
  if (!comments) return null;
  for (const comment of comments) {
    const match = comment.value.match(/transia-context:\s*(.+)/);
    if (match) return match[1].trim();
  }
  return null;
}

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

/** console.*, require(), import(), and test-framework calls are never candidates. */
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
      if (callee.type === "Identifier" && callee.name === "require") return true;
      if (callee.type === "Import") return true;
      if (
        callee.type === "Identifier" &&
        ["test", "describe", "it", "expect", "beforeEach", "afterEach", "beforeAll", "afterAll"].includes(
          callee.name,
        )
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
        ["css", "keyframes", "createGlobalStyle", "injectGlobal"].includes(tag.name)
      ) {
        return true;
      }
    }
    current = current.parentPath;
  }
  return false;
}

function detectInsideComparison(path: any): boolean {
  let current = path.parentPath;
  while (current) {
    const node = current.node;
    if (node?.type === "BinaryExpression" && COMPARISON_OPERATORS.has(node.operator)) {
      return true;
    }
    if (node?.type === "SwitchCase" && node.test) {
      return true;
    }
    current = current.parentPath;
  }
  return false;
}

function calleeName(callee: any): string | undefined {
  if (!callee) return undefined;
  if (callee.type === "Identifier") return callee.name;
  if (callee.type === "MemberExpression" && callee.property?.type === "Identifier") {
    return callee.property.name;
  }
  return undefined;
}

function enclosingCallName(path: any): string | undefined {
  let current = path.parentPath;
  while (current) {
    if (current.node?.type === "CallExpression") {
      return calleeName(current.node.callee);
    }
    current = current.parentPath;
  }
  return undefined;
}

/**
 * The component function a site belongs to, for hook insertion. Inline
 * callbacks (map/forEach args) are skipped so the hook lands in the component,
 * not the callback.
 */
function enclosingComponentPath(path: any): string {
  let fallback = "";
  let current = path.parentPath;
  while (current) {
    const type = current.node?.type;
    if (type === "FunctionDeclaration") return String(current.node.start);
    if (type === "ArrowFunctionExpression" || type === "FunctionExpression") {
      const parentType = current.parentPath?.node?.type;
      if (
        parentType === "VariableDeclarator" ||
        parentType === "ExportDefaultDeclaration" ||
        parentType === "ExportNamedDeclaration"
      ) {
        return String(current.node.start);
      }
      if (fallback === "") fallback = String(current.node.start);
    }
    current = current.parentPath;
  }
  return fallback;
}

export function recordCandidates(source: string, filePath: string): Candidate[] {
  const candidates: Candidate[] = [];

  let ast;
  try {
    ast = parse(source, {
      sourceType: "module",
      plugins: ["jsx", "typescript", "decorators-legacy"],
      errorRecovery: true,
    });
  } catch (error) {
    logger.warn(
      `Failed to parse ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return candidates;
  }

  const fileContext = ast.comments ? extractTransiaContext(ast.comments) : null;

  function record(
    start: number,
    end: number,
    role: CandidateRole,
    rawValue: string,
    path: any,
    extra: {
      attribute?: string;
      attrExpressionContainer?: boolean;
      interpolations?: Candidate["interpolations"];
    } = {},
  ): void {
    const trimmed = rawValue.trim();
    if (!isTranslatableString(trimmed)) return;

    const line = path.node.loc?.start.line ?? 0;
    const { sanitized } = sanitizeForPrompt(trimmed, `${filePath}:${line}`);

    candidates.push({
      start,
      end,
      role,
      attribute: extra.attribute,
      attrExpressionContainer: extra.attrExpressionContainer,
      insideComparison: detectInsideComparison(path),
      insideCall: enclosingCallName(path),
      sanitized,
      hash: hashString(sanitized),
      componentPath: enclosingComponentPath(path),
      context: fileContext,
      line,
      interpolations: extra.interpolations,
    });
  }

  traverse(ast, {
    JSXText(path: any) {
      const raw: string = path.node.value;
      if (!raw.trim()) return;
      const leading = raw.length - raw.trimStart().length;
      const trailing = raw.length - raw.trimEnd().length;
      record(
        path.node.start + leading,
        path.node.end - trailing,
        "jsx-text",
        raw,
        path,
      );
    },

    StringLiteral(path: any) {
      if (isInsideImport(path)) return;
      if (isInsideSkippableCall(path)) return;
      if (!isInsideJSX(path)) return;

      const parent = path.parentPath;
      const parentType = parent?.node?.type;
      let role: CandidateRole = "jsx-expr-string";
      let attribute: string | undefined;
      let attrExpressionContainer = false;

      if (parentType === "JSXAttribute") {
        role = "jsx-attr";
        attribute =
          typeof parent.node.name?.name === "string" ? parent.node.name.name : undefined;
      } else if (
        parentType === "JSXExpressionContainer" &&
        parent.parentPath?.node?.type === "JSXAttribute"
      ) {
        role = "jsx-attr";
        attrExpressionContainer = true;
        const attrName = parent.parentPath.node.name?.name;
        attribute = typeof attrName === "string" ? attrName : undefined;
      } else if (parentType === "ConditionalExpression") {
        role = "conditional";
      }

      record(path.node.start, path.node.end, role, path.node.value, path, {
        attribute,
        attrExpressionContainer,
      });
    },

    TemplateLiteral(path: any) {
      if (isInsideSkippableCall(path)) return;
      if (path.parent?.type === "TaggedTemplateExpression") return;
      if (!isInsideJSX(path)) return;

      const quasis = path.node.quasis;
      const expressions = path.node.expressions;

      let fullText = "";
      const interpolations: NonNullable<Candidate["interpolations"]> = [];
      for (let i = 0; i < quasis.length; i++) {
        fullText += quasis[i].value.cooked ?? quasis[i].value.raw;
        if (i < expressions.length) {
          const expr = expressions[i];
          const name =
            expr.type === "Identifier"
              ? expr.name
              : expr.type === "MemberExpression" && expr.property?.type === "Identifier"
                ? expr.property.name
                : `expr${i}`;
          fullText += `{${name}}`;
          interpolations.push({ name, exprStart: expr.start, exprEnd: expr.end });
        }
      }

      record(path.node.start, path.node.end, "template", fullText, path, { interpolations });
    },
  });

  return candidates;
}
