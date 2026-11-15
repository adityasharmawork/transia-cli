/**
 * Generators for next-intl "prefix mode" (SEO URL-prefix routing): a shared
 * routing object, locale-aware navigation helpers, a request config that reads
 * the locale from the URL segment, the middleware/proxy that negotiates it, and
 * an app/[locale] root layout. Unlike cookie mode, prefix mode needs the app's
 * routes to live under app/[locale]/ — the move itself is handled (guarded) by
 * the setup command; these functions only produce file contents.
 */

export type LocalePrefix = "as-needed" | "always";

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
