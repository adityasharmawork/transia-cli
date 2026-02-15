import { parse } from "@babel/parser";
import type { Comment } from "@babel/types";
import { isTranslatableAttribute, isTranslatableString } from "./filters.js";
import { sanitizeForPrompt } from "./sanitizer.js";
import { hashString } from "../utils/crypto.js";
import { logger } from "../utils/logger.js";

// Dynamic import to handle ESM/CJS interop for @babel/traverse
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const traverse = require("@babel/traverse").default ?? require("@babel/traverse");

export interface ExtractedString {
  original: string;
  hash: string;
  context: string | null;
  source: string; // file:line
}

interface ExtractionResult {
  strings: ExtractedString[];
  errors: string[];
}

// Extracts the transia-context comment from leading comments
function extractTransiaContext(comments?: Comment[] | null): string | null {
  if (!comments) return null;
  for (const comment of comments) {
    const match = comment.value.match(/transia-context:\s*(.+)/);
    if (match) return match[1].trim();
  }
  return null;
}

// Check if a node is inside a JSX tree
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

// Check if inside a call to console.*, require(), import(), test(), describe(), it(), expect()
function isInsideSkippableCall(path: any): boolean {
  let current = path.parentPath;
  while (current) {
    if (current.node?.type === "CallExpression") {
      const callee = current.node.callee;

      // console.*
      if (
        callee.type === "MemberExpression" &&
        callee.object?.type === "Identifier" &&
        callee.object.name === "console"
      ) {
        return true;
      }

      // require(), import()
      if (callee.type === "Identifier") {
        if (["require"].includes(callee.name)) return true;
      }
      if (callee.type === "Import") return true;

      // test(), describe(), it(), expect()
      if (
        callee.type === "Identifier" &&
        ["test", "describe", "it", "expect", "beforeEach", "afterEach", "beforeAll", "afterAll"].includes(callee.name)
      ) {
        return true;
      }
    }

    // Skip styled-components tagged templates
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

// Check if inside an import declaration
function isInsideImport(path: any): boolean {
  let current = path;
  while (current) {
    if (current.node?.type === "ImportDeclaration") return true;
    current = current.parentPath;
  }
  return false;
}

// Check if the string is a className or style attribute value
function isSkippedAttribute(path: any): boolean {
  const parent = path.parentPath;
  if (!parent) return false;

  if (parent.node?.type === "JSXAttribute") {
    const attrName = parent.node.name?.name;
    if (typeof attrName === "string" && !isTranslatableAttribute(attrName)) {
      return true;
    }
  }

  // Check grandparent for JSXExpressionContainer > JSXAttribute
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

export function extractStringsFromSource(
  source: string,
  filePath: string,
): ExtractionResult {
  const strings: ExtractedString[] = [];
  const errors: string[] = [];
  const seenHashes = new Set<string>();

  let ast;
  try {
    ast = parse(source, {
      sourceType: "module",
      plugins: ["jsx", "typescript", "decorators-legacy"],
      errorRecovery: true,
    });
  } catch (error) {
    const msg = `Failed to parse ${filePath}: ${error instanceof Error ? error.message : String(error)}`;
    errors.push(msg);
    logger.warn(msg);
    return { strings, errors };
  }

  // Collect transia-context from top-level function/component comments
  let fileContext: string | null = null;
  if (ast.comments) {
    fileContext = extractTransiaContext(ast.comments);
  }

  function addString(value: string, line: number, context: string | null): void {
    const trimmed = value.trim();
    if (!isTranslatableString(trimmed)) return;

    const { sanitized } = sanitizeForPrompt(trimmed, `${filePath}:${line}`);
    const hash = hashString(sanitized);

    if (seenHashes.has(hash)) return;
    seenHashes.add(hash);

    strings.push({
      original: sanitized,
      hash,
      context: context ?? fileContext,
      source: `${filePath}:${line}`,
    });
  }

  traverse(ast, {
    // Direct text in JSX: <p>Hello World</p>
    JSXText(path: any) {
      const value = path.node.value;
      if (value.trim()) {
        addString(
          value,
          path.node.loc?.start.line ?? 0,
          null,
        );
      }
    },

    // String literals — only extract if inside JSX context
    StringLiteral(path: any) {
      if (isInsideImport(path)) return;
      if (isInsideSkippableCall(path)) return;
      if (isSkippedAttribute(path)) return;

      const parent = path.parentPath;
      if (!parent) return;

      const parentType = parent.node?.type;

      // String in JSXAttribute: <input placeholder="Enter name" />
      if (parentType === "JSXAttribute") {
        const attrName = parent.node.name?.name;
        if (typeof attrName === "string" && isTranslatableAttribute(attrName)) {
          addString(
            path.node.value,
            path.node.loc?.start.line ?? 0,
            null,
          );
        }
        return;
      }

      // String in JSXExpressionContainer: <p>{"Hello"}</p>
      if (parentType === "JSXExpressionContainer") {
        addString(
          path.node.value,
          path.node.loc?.start.line ?? 0,
          null,
        );
        return;
      }

      // String in conditional expression inside JSX: {cond ? "Yes" : "No"}
      if (
        parentType === "ConditionalExpression" &&
        isInsideJSX(parent)
      ) {
        addString(
          path.node.value,
          path.node.loc?.start.line ?? 0,
          null,
        );
        return;
      }

      // String in array inside JSX: {['Home', 'About'].map(...)}
      if (parentType === "ArrayExpression" && isInsideJSX(parent)) {
        addString(
          path.node.value,
          path.node.loc?.start.line ?? 0,
          null,
        );
        return;
      }

      // String in JSXExpressionContainer (via expression container > ...)
      if (isInsideJSX(path) && parentType !== "ObjectProperty") {
        // Only if it's clearly user-facing
        const inExpContainer = path.findParent(
          (p: any) => p.node?.type === "JSXExpressionContainer",
        );
        if (inExpContainer) {
          addString(
            path.node.value,
            path.node.loc?.start.line ?? 0,
            null,
          );
        }
      }
    },

    // Template literals inside JSX: <p>{`Welcome ${name}`}</p>
    TemplateLiteral(path: any) {
      if (isInsideSkippableCall(path)) return;

      // Skip tagged templates (styled, css, gql, etc.)
      if (path.parent?.type === "TaggedTemplateExpression") return;

      if (!isInsideJSX(path)) return;

      // Extract static parts of the template
      const quasis = path.node.quasis;
      const expressions = path.node.expressions;

      // Build a representation with placeholders
      let fullText = "";
      for (let i = 0; i < quasis.length; i++) {
        fullText += quasis[i].value.cooked ?? quasis[i].value.raw;
        if (i < expressions.length) {
          const expr = expressions[i];
          // Use the expression source as a placeholder name
          const name =
            expr.type === "Identifier"
              ? expr.name
              : expr.type === "MemberExpression" && expr.property?.type === "Identifier"
                ? expr.property.name
                : `expr${i}`;
          fullText += `{${name}}`;
        }
      }

      addString(
        fullText,
        path.node.loc?.start.line ?? 0,
        null,
      );
    },

    // JSX attributes: extract translatable attribute values
    JSXAttribute(path: any) {
      const attrName =
        typeof path.node.name?.name === "string"
          ? path.node.name.name
          : typeof path.node.name?.name === "object" && path.node.name.name?.name
            ? path.node.name.name.name
            : null;

      if (!attrName || !isTranslatableAttribute(attrName)) return;

      const value = path.node.value;
      if (!value) return;

      // JSXExpressionContainer with StringLiteral
      if (
        value.type === "JSXExpressionContainer" &&
        value.expression?.type === "StringLiteral"
      ) {
        addString(
          value.expression.value,
          value.expression.loc?.start.line ?? 0,
          null,
        );
      }
      // Direct StringLiteral (handled by StringLiteral visitor, but keep for completeness)
    },
  });

  return { strings, errors };
}
