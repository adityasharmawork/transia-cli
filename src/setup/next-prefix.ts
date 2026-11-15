/**
 * Generators for next-intl "prefix mode" (SEO URL-prefix routing): a shared
 * routing object, locale-aware navigation helpers, a request config that reads
 * the locale from the URL segment, the middleware/proxy that negotiates it, and
 * an app/[locale] root layout. Unlike cookie mode, prefix mode needs the app's
 * routes to live under app/[locale]/ — the move itself is handled (guarded) by
 * the setup command; these functions only produce file contents.
 */

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
  const base = name.split(".")[0];
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
