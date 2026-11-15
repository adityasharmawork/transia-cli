/**
 * Generators and transforms for next-intl "cookie mode" (no i18n routing,
 * no prefix middleware). The locale is read from a cookie on the server, so
 * pages do NOT need to move under app/[locale]/ — which is what made the old
 * prefix-middleware setup 404 every route.
 */

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
