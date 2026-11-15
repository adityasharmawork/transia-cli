/**
 * Generators and transforms for next-intl "cookie mode" (no i18n routing,
 * no prefix middleware). The locale is read from a cookie on the server, so
 * pages do NOT need to move under app/[locale]/ — which is what made the old
 * prefix-middleware setup 404 every route.
 */

import { parse } from "@babel/parser";
import { createRequire } from "node:module";
import { buildEdit, type Insertion, type Edit } from "../transform/safe-write.js";
import { planImports } from "../transform/hooks.js";

const require = createRequire(import.meta.url);
const traverse = require("@babel/traverse").default ?? require("@babel/traverse");

const COOKIE_NAME = "NEXT_LOCALE";

/** Source for `i18n/request.ts` — reads the locale from a cookie. */
export function cookieRequestConfig(
  _sourceLocale: string,
  _locales: string[],
  messagesRelDir: string,
): string {
  return `import { getRequestConfig } from "next-intl/server";
import { cookies } from "next/headers";
import { locales, defaultLocale } from "./locales";

// Cookie mode: the active locale comes from the "${COOKIE_NAME}" cookie (set by
// the language switcher), not from a URL prefix — so no middleware is needed.
export default getRequestConfig(async () => {
  const store = await cookies();
  const cookieLocale = store.get("${COOKIE_NAME}")?.value;
  const locale =
    cookieLocale && locales.includes(cookieLocale) ? cookieLocale : defaultLocale;

  return {
    locale,
    messages: (await import(\`../${messagesRelDir}/\${locale}.json\`)).default,
  };
});
`;
}

/** Source for `i18n/locales.ts`. */
export function localesModule(sourceLocale: string, locales: string[]): string {
  const list = locales.map((l) => `"${l}"`).join(", ");
  return `export const locales: string[] = [${list}];
export const defaultLocale = "${sourceLocale}";
`;
}

export type LayoutWrapResult =
  | { output: string; wrapped: true }
  | { wrapped: false; reason: string };

function parseModule(source: string) {
  return parse(source, {
    sourceType: "module",
    plugins: ["jsx", "typescript", "decorators-legacy"],
    errorRecovery: true,
  });
}

/**
 * Safely wrap a Next.js App Router root layout for next-intl cookie mode:
 * make the component async, read `getLocale()`/`getMessages()`, set
 * `<html lang={locale}>`, and wrap the <body> children in
 * <NextIntlClientProvider>. Edits are surgical (magic-string) and the result is
 * re-parsed; any unexpected shape returns `wrapped:false` so the caller can
 * print a manual snippet instead of risking the user's file.
 */
export function wrapLayoutForNextIntl(source: string): LayoutWrapResult {
  if (source.includes("NextIntlClientProvider")) {
    return { wrapped: false, reason: "layout already uses NextIntlClientProvider" };
  }

  let ast;
  try {
    ast = parseModule(source);
  } catch {
    return { wrapped: false, reason: "could not parse the layout file" };
  }

  // Locate the default-exported component function.
  let fnNode: any = null;
  traverse(ast, {
    ExportDefaultDeclaration(path: any) {
      const d = path.node.declaration;
      if (d?.type === "FunctionDeclaration") {
        fnNode = d;
      } else if (d?.type === "Identifier") {
        const binding = path.scope.getBinding(d.name);
        const n = binding?.path?.node;
        if (n?.type === "FunctionDeclaration") fnNode = n;
        else if (
          n?.type === "VariableDeclarator" &&
          (n.init?.type === "ArrowFunctionExpression" ||
            n.init?.type === "FunctionExpression")
        ) {
          fnNode = n.init;
        }
      }
    },
  });
  if (!fnNode) return { wrapped: false, reason: "no default-exported layout function found" };
  if (fnNode.body?.type !== "BlockStatement") {
    return { wrapped: false, reason: "layout body is not a block statement" };
  }

  // Find <html> and <body> inside that component.
  let htmlOpen: any = null;
  let bodyEl: any = null;
  traverse(ast, {
    JSXElement(path: any) {
      if (path.node.start < fnNode.start || path.node.end > fnNode.end) return;
      const name = path.node.openingElement?.name;
      const tag = name?.type === "JSXIdentifier" ? name.name : null;
      if (tag === "html") htmlOpen = path.node.openingElement;
      if (tag === "body") bodyEl = path.node;
    },
  });
  if (!htmlOpen || !bodyEl) {
    return { wrapped: false, reason: "layout does not render <html> and <body>" };
  }
  if (!bodyEl.closingElement) {
    return { wrapped: false, reason: "<body> is self-closing" };
  }

  const insertions: Insertion[] = [];
  const edits: Edit[] = [];

  // Make the component async.
  if (!fnNode.async) insertions.push({ pos: fnNode.start, text: "async " });

  // Read locale + messages at the top of the body.
  insertions.push({
    pos: fnNode.body.start + 1,
    text: "\n  const locale = await getLocale();\n  const messages = await getMessages();",
  });

  // Set <html lang={locale}> (replace an existing lang, else add one).
  const langAttr = htmlOpen.attributes?.find(
    (a: any) => a.type === "JSXAttribute" && a.name?.name === "lang",
  );
  if (langAttr) {
    edits.push({ start: langAttr.start, end: langAttr.end, replacement: "lang={locale}" });
  } else {
    insertions.push({ pos: htmlOpen.end - 1, text: " lang={locale}" });
  }

  // Wrap the <body> children in the provider.
  insertions.push({
    pos: bodyEl.openingElement.end,
    text: "<NextIntlClientProvider messages={messages}>",
  });
  insertions.push({
    pos: bodyEl.closingElement.start,
    text: "</NextIntlClientProvider>",
  });

  // Add imports (below any directive/existing imports).
  insertions.push(
    ...planImports(source, [
      { module: "next-intl", name: "NextIntlClientProvider" },
      { module: "next-intl/server", name: "getLocale" },
      { module: "next-intl/server", name: "getMessages" },
    ]),
  );

  let output: string;
  try {
    output = buildEdit(source, edits, insertions);
  } catch {
    return { wrapped: false, reason: "could not build the layout transform (overlap)" };
  }

  try {
    parse(output, { sourceType: "module", plugins: ["jsx", "typescript", "decorators-legacy"] });
  } catch {
    return { wrapped: false, reason: "transform produced invalid output" };
  }

  return { output, wrapped: true };
}

/**
 * Add the next-intl plugin to a next.config file so it loads i18n/request.ts.
 * Wraps the default export (ESM) or module.exports (CJS) in
 * `withNextIntl(...)`. Idempotent; returns `changed:false` for a shape it can't
 * confidently rewrite so the caller can print manual instructions.
 */
export function addNextIntlPlugin(source: string): { output: string; changed: boolean } {
  if (source.includes("next-intl/plugin")) return { output: source, changed: false };

  let ast;
  try {
    ast = parseModule(source);
  } catch {
    return { output: source, changed: false };
  }

  let statementStart: number | null = null;
  let declStart: number | null = null;
  let declEnd: number | null = null;

  traverse(ast, {
    ExportDefaultDeclaration(path: any) {
      if (statementStart !== null) return;
      const d = path.node.declaration;
      if (d?.start != null && d?.end != null) {
        statementStart = path.node.start;
        declStart = d.start;
        declEnd = d.end;
      }
    },
    AssignmentExpression(path: any) {
      if (statementStart !== null) return;
      const l = path.node.left;
      if (
        l?.type === "MemberExpression" &&
        l.object?.type === "Identifier" &&
        l.object.name === "module" &&
        l.property?.type === "Identifier" &&
        l.property.name === "exports"
      ) {
        const r = path.node.right;
        if (r?.start != null && r?.end != null) {
          statementStart = path.parentPath?.node?.start ?? path.node.start;
          declStart = r.start;
          declEnd = r.end;
        }
      }
    },
  });

  if (statementStart === null || declStart === null || declEnd === null) {
    return { output: source, changed: false };
  }

  const directivesEnd =
    ((ast.program as any).directives ?? []).reduce(
      (m: number, d: any) => Math.max(m, d.end ?? 0),
      0,
    ) || 0;

  const insertions: Insertion[] = [
    { pos: directivesEnd, text: `import createNextIntlPlugin from "next-intl/plugin";\n` },
    {
      pos: statementStart,
      text: `const withNextIntl = createNextIntlPlugin("./i18n/request.ts");\n\n`,
    },
    { pos: declStart, text: "withNextIntl(" },
    { pos: declEnd, text: ")" },
  ];

  let output: string;
  try {
    output = buildEdit(source, [], insertions);
  } catch {
    return { output: source, changed: false };
  }
  try {
    parse(output, { sourceType: "module", plugins: ["jsx", "typescript", "decorators-legacy"] });
  } catch {
    return { output: source, changed: false };
  }
  return { output, changed: true };
}
