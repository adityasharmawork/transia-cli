import { describe, it, expect } from "vitest";
import { parse } from "@babel/parser";
import {
  routingModule,
  navigationModule,
  prefixRequestConfig,
  middlewareSource,
  localeLayoutTemplate,
} from "../../src/setup/next-prefix";

const parses = (src: string) =>
  parse(src, { sourceType: "module", plugins: ["jsx", "typescript"] });

describe("next-prefix generators", () => {
  it("routingModule defines locales, defaultLocale, and localePrefix as-needed", () => {
    const src = routingModule("en", ["en", "es", "fr"], "as-needed");
    expect(src).toContain("defineRouting");
    expect(src).toContain('"en"');
    expect(src).toContain('"es"');
    expect(src).toContain('defaultLocale: "en"');
    expect(src).toContain('localePrefix: "as-needed"');
    expect(() => parses(src)).not.toThrow();
  });

  it("navigationModule re-exports createNavigation helpers", () => {
    const src = navigationModule();
    expect(src).toContain("createNavigation(routing)");
    expect(src).toContain("Link");
    expect(() => parses(src)).not.toThrow();
  });

  it("prefixRequestConfig uses requestLocale + hasLocale and imports messages", () => {
    const src = prefixRequestConfig("locales");
    expect(src).toContain("requestLocale");
    expect(src).toContain("hasLocale(routing.locales");
    expect(src).toContain("../locales/${locale}.json");
    expect(() => parses(src)).not.toThrow();
  });

  it("middlewareSource creates the next-intl middleware with an api-excluding matcher", () => {
    const src = middlewareSource();
    expect(src).toContain("createMiddleware(routing)");
    expect(src).toContain("matcher");
    expect(src).toContain("api");
    expect(() => parses(src)).not.toThrow();
  });

  it("localeLayoutTemplate validates locale, sets lang, and provides messages", () => {
    const src = localeLayoutTemplate();
    expect(src).toContain("generateStaticParams");
    expect(src).toContain("hasLocale(routing.locales, locale)");
    expect(src).toContain("notFound()");
    expect(src).toContain("setRequestLocale(locale)");
    expect(src).toContain("<html lang={locale}>");
    expect(src).toContain("NextIntlClientProvider");
    expect(() => parses(src)).not.toThrow();
  });
});
