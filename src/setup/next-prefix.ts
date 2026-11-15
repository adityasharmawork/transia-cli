/**
 * Generators for next-intl "prefix mode" (SEO URL-prefix routing): a shared
 * routing object, locale-aware navigation helpers, a request config that reads
 * the locale from the URL segment, the middleware/proxy that negotiates it, and
 * an app/[locale] root layout. Unlike cookie mode, prefix mode needs the app's
 * routes to live under app/[locale]/ — the move itself is handled (guarded) by
 * the setup command; these functions only produce file contents.
 */

import { parse } from "@babel/parser";
import { createRequire } from "node:module";
import { buildEdit, type Insertion, type Edit } from "../transform/safe-write.js";
import { planImports } from "../transform/hooks.js";

const require = createRequire(import.meta.url);
const traverse = require("@babel/traverse").default ?? require("@babel/traverse");

export type LocalePrefix = "as-needed" | "always";

/**
 * Parse the Next.js major version from a parsed package.json's dependencies,
 * or null when `next` is absent or its spec has no leading number (e.g.
 * "latest", "canary", a workspace ref). Pure for testability; the fs read lives
 * in the setup command.
 */
export function nextMajorFromPackage(pkg: unknown): number | null {
  if (!pkg || typeof pkg !== "object") return null;
  const record = pkg as Record<string, unknown>;
  const deps = {
    ...(record.dependencies as Record<string, string> | undefined),
    ...(record.devDependencies as Record<string, string> | undefined),
  };
  const spec = deps.next;
  if (typeof spec !== "string") return null;
  const match = spec.match(/\d+/);
  return match ? parseInt(match[0], 10) : null;
}

/**
 * Next 16 renamed `middleware.ts` -> `proxy.ts` (middleware still works but is
 * deprecated). Emit proxy.ts for Next >=16; middleware.ts for 15 and earlier, or
 * when the version is unknown (middleware.ts works on 16 too, so it is the safe
 * default).
 */
export function middlewareFilename(nextMajor: number | null): "middleware.ts" | "proxy.ts" {
  return nextMajor !== null && nextMajor >= 16 ? "proxy.ts" : "middleware.ts";
}

// --- Route-tree move plan (app/* -> app/[locale]/*) ---

export interface AppEntry {
  name: string;
  isDir: boolean;
}

export interface MovePlan {
  /** Top-level entry names to move under [locale]/. */
  move: string[];
  /** Top-level entry names that stay at the app root. */
  keep: string[];
  /** Structured moves for execution: { from, to } repo-relative paths. */
  moves: { from: string; to: string }[];
  /** Human-readable `git mv` commands for the dry-run / guided output. */
  gitMvCommands: string[];
}

/**
 * File-convention metadata that Next resolves at the app root and that must NOT
 * move under [locale] (matched by basename before the first dot, so
 * `opengraph-image.png`, `icon.svg`, `sitemap.ts` all match). `global-error`
 * also must stay at the app root.
 */
const METADATA_BASENAMES = new Set([
  "favicon",
  "icon",
  "apple-icon",
  "apple-touch-icon",
  "opengraph-image",
  "twitter-image",
  "robots",
  "sitemap",
  "manifest",
  "global-error",
]);

function isKeptFile(name: string): boolean {
  if (name === "favicon.ico") return true;
  // Basename before the first dot, with any trailing digits stripped, so Next's
  // numbered variants (icon1.png, apple-icon2.png, opengraph-image1.png) and
  // multi-segment names (opengraph-image.alt.txt) all map to their family.
  const dot = name.indexOf(".");
  const base = (dot === -1 ? name : name.slice(0, dot)).replace(/\d+$/, "");
  return METADATA_BASENAMES.has(base);
}

/**
 * Partition an app dir's top-level entries into what moves under `[locale]/` and
 * what stays. Keep at root: the `api` directory, the `[locale]` dir itself (if
 * present), and file-convention metadata (favicon/icon/opengraph-image/robots/
 * sitemap/manifest/global-error). Move everything else — route segments, route
 * groups `(...)`, nested dirs, and colocated files — so relative imports AMONG
 * moved files are preserved (they all shift by the same depth). Pure: callers
 * pass the directory listing and execute `moves` under a clean-tree guard.
 */
export function computeMovePlan(entries: AppEntry[], appRel = "app"): MovePlan {
  const plan: MovePlan = { move: [], keep: [], moves: [], gitMvCommands: [] };
  for (const e of entries) {
    if (e.name === "[locale]") continue; // already the target segment
    const keep = (e.isDir && e.name === "api") || (!e.isDir && isKeptFile(e.name));
    if (keep) {
      plan.keep.push(e.name);
      continue;
    }
    plan.move.push(e.name);
    const from = `${appRel}/${e.name}`;
    const to = `${appRel}/[locale]/${e.name}`;
    plan.moves.push({ from, to });
    plan.gitMvCommands.push(`git mv "${from}" "${to}"`);
  }
  return plan;
}

/** Source for `i18n/routing.ts`. */
export function routingModule(
  sourceLocale: string,
  locales: string[],
  localePrefix: LocalePrefix = "as-needed",
): string {
  const list = locales.map((l) => `"${l}"`).join(", ");
  return `import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: [${list}],
  defaultLocale: "${sourceLocale}",
  localePrefix: "${localePrefix}",
});
`;
}

/** Source for `i18n/navigation.ts` — locale-aware Link/useRouter/etc. */
export function navigationModule(): string {
  return `import { createNavigation } from "next-intl/navigation";
import { routing } from "./routing";

// Use these in place of next/link and next/navigation so hrefs carry the locale.
export const { Link, redirect, usePathname, useRouter, getPathname } =
  createNavigation(routing);
`;
}

/** Source for `i18n/request.ts` — reads the locale from the URL segment. */
export function prefixRequestConfig(messagesRelDir: string): string {
  return `import { getRequestConfig } from "next-intl/server";
import { hasLocale } from "next-intl";
import { routing } from "./routing";

// Prefix mode: the active locale comes from the URL segment (requestLocale),
// validated against the configured locales.
export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested)
    ? requested
    : routing.defaultLocale;

  return {
    locale,
    messages: (await import(\`../${messagesRelDir}/\${locale}.json\`)).default,
  };
});
`;
}

/**
 * Source for `middleware.ts` (Next <=15) or `proxy.ts` (Next >=16). The content
 * is identical; only the filename differs by Next version (see setup).
 * `routingImport` is the import path to `i18n/routing` relative to the file.
 */
export function middlewareSource(routingImport = "./i18n/routing"): string {
  return `import createMiddleware from "next-intl/middleware";
import { routing } from "${routingImport}";

export default createMiddleware(routing);

export const config = {
  // Match all pathnames except API routes, Next internals, and files with a dot.
  matcher: "/((?!api|trpc|_next|_vercel|.*\\\\..*).*)",
};
`;
}

/**
 * Template for a new `app/[locale]/layout.tsx`. Written only when one does not
 * already exist, so the safe default never clobbers a user's layout.
 * `routingImport` is the path to `i18n/routing` relative to the layout file.
 */
export function localeLayoutTemplate(routingImport = "../../i18n/routing"): string {
  return `import { NextIntlClientProvider, hasLocale } from "next-intl";
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { routing } from "${routingImport}";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }
  // Enable static rendering for this locale.
  setRequestLocale(locale);

  return (
    <html lang={locale}>
      <body>
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
`;
}

// --- Transform an existing root layout into a [locale] layout (for --move) ---

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
 * Transform a Next.js App Router root layout (being moved to app/[locale]/) into
 * a next-intl prefix-mode layout: read `locale` from `params`, validate it
 * (`hasLocale` -> `notFound()`), call `setRequestLocale`, set `<html
 * lang={locale}>`, wrap <body> children in <NextIntlClientProvider>, and add
 * `generateStaticParams`. Edits are surgical (magic-string) and the result is
 * re-parsed; any shape it can't confidently rewrite returns `wrapped:false` so
 * the caller can fall back to the generated template or a manual note instead of
 * risking the user's file.
 */
export function transformLayoutForPrefix(
  source: string,
  routingImport = "../../i18n/routing",
): LayoutWrapResult {
  if (source.includes("NextIntlClientProvider")) {
    return { wrapped: false, reason: "layout already uses NextIntlClientProvider" };
  }

  let ast;
  try {
    ast = parseModule(source);
  } catch {
    return { wrapped: false, reason: "could not parse the layout file" };
  }

  const directives = (ast.program as any).directives ?? [];
  if (directives.some((d: any) => d.value?.value === "use client")) {
    return {
      wrapped: false,
      reason:
        'the root layout is a "use client" component; keep it a server component so the locale segment and getMessages work, then adapt it manually',
    };
  }

  // Locate the default-exported component function and the export statement.
  let fnNode: any = null;
  let exportStart: number | null = null;
  traverse(ast, {
    ExportDefaultDeclaration(path: any) {
      const d = path.node.declaration;
      if (d?.type === "FunctionDeclaration") {
        fnNode = d;
        exportStart = path.node.start;
      } else if (d?.type === "Identifier") {
        const binding = path.scope.getBinding(d.name);
        const n = binding?.path?.node;
        if (n?.type === "FunctionDeclaration") {
          fnNode = n;
          exportStart = path.node.start;
        } else if (
          n?.type === "VariableDeclarator" &&
          (n.init?.type === "ArrowFunctionExpression" ||
            n.init?.type === "FunctionExpression")
        ) {
          fnNode = n.init;
          exportStart = path.node.start;
        }
      }
    },
  });
  if (!fnNode || exportStart === null) {
    return { wrapped: false, reason: "no default-exported layout function found" };
  }
  if (fnNode.body?.type !== "BlockStatement") {
    return { wrapped: false, reason: "layout body is not a block statement" };
  }

  // The first param must be the `{ children }` object pattern so we can add `params`.
  const prop = fnNode.params?.[0];
  if (!prop || prop.type !== "ObjectPattern") {
    return { wrapped: false, reason: "layout props are not a { children } object pattern" };
  }

  // Find <html> and <body> inside the component.
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

  // Add `params` to the BINDING pattern. Note: a typed pattern's `end` extends
  // past its type annotation, so we anchor on the last binding property (not
  // prop.end) to land inside `{ children }`, not inside the type literal.
  const bindingProps = prop.properties ?? [];
  if (bindingProps.length > 0) {
    insertions.push({ pos: bindingProps[bindingProps.length - 1].end, text: ", params" });
  } else {
    insertions.push({ pos: prop.start + 1, text: " params " });
  }

  // Extend the props type, if present: `{ children: ... }` or `Readonly<{ ... }>`.
  if (prop.typeAnnotation?.type === "TSTypeAnnotation") {
    const t = prop.typeAnnotation.typeAnnotation;
    let literal: any = null;
    if (t.type === "TSTypeLiteral") {
      literal = t;
    } else if (t.type === "TSTypeReference") {
      const args = t.typeParameters ?? t.typeArguments;
      if (args?.params?.[0]?.type === "TSTypeLiteral") literal = args.params[0];
    }
    if (!literal) {
      return {
        wrapped: false,
        reason: "could not extend the layout props type for the locale param",
      };
    }
    insertions.push({ pos: literal.end - 1, text: "; params: Promise<{ locale: string }> " });
  }

  // Read + validate the locale at the top of the body.
  insertions.push({
    pos: fnNode.body.start + 1,
    text:
      "\n  const { locale } = await params;" +
      "\n  if (!hasLocale(routing.locales, locale)) {\n    notFound();\n  }" +
      "\n  setRequestLocale(locale);" +
      "\n  const messages = await getMessages();",
  });

  // Set <html lang={locale}>.
  const langAttr = htmlOpen.attributes?.find(
    (a: any) => a.type === "JSXAttribute" && a.name?.name === "lang",
  );
  if (langAttr) {
    edits.push({ start: langAttr.start, end: langAttr.end, replacement: "lang={locale}" });
  } else {
    insertions.push({ pos: htmlOpen.end - 1, text: " lang={locale}" });
  }

  // Wrap <body> children in the provider.
  insertions.push({
    pos: bodyEl.openingElement.end,
    text: "<NextIntlClientProvider messages={messages}>",
  });
  insertions.push({
    pos: bodyEl.closingElement.start,
    text: "</NextIntlClientProvider>",
  });

  // Add generateStaticParams before the default export.
  insertions.push({
    pos: exportStart,
    text:
      "export function generateStaticParams() {\n" +
      "  return routing.locales.map((locale) => ({ locale }));\n" +
      "}\n\n",
  });

  // Imports.
  insertions.push(
    ...planImports(source, [
      { module: "next-intl", name: "NextIntlClientProvider" },
      { module: "next-intl", name: "hasLocale" },
      { module: "next-intl/server", name: "getMessages" },
      { module: "next-intl/server", name: "setRequestLocale" },
      { module: "next/navigation", name: "notFound" },
      { module: routingImport, name: "routing" },
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
