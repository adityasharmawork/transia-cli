import { describe, it, expect } from "vitest";
import { parse } from "@babel/parser";
import {
  routingModule,
  navigationModule,
  prefixRequestConfig,
  middlewareSource,
  localeLayoutTemplate,
  nextMajorFromPackage,
  middlewareFilename,
  computeMovePlan,
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

describe("Next version detection", () => {
  it("reads the major from a caret range in dependencies", () => {
    expect(nextMajorFromPackage({ dependencies: { next: "^16.1.6" } })).toBe(16);
  });

  it("reads from devDependencies and plain versions (15.5 is still 15)", () => {
    expect(nextMajorFromPackage({ devDependencies: { next: "15.5.0" } })).toBe(15);
  });

  it("returns null when next is absent or non-numeric", () => {
    expect(nextMajorFromPackage({ dependencies: {} })).toBeNull();
    expect(nextMajorFromPackage({ dependencies: { next: "latest" } })).toBeNull();
    expect(nextMajorFromPackage(null)).toBeNull();
  });

  it("picks proxy.ts for Next >=16, middleware.ts otherwise (incl. unknown)", () => {
    expect(middlewareFilename(16)).toBe("proxy.ts");
    expect(middlewareFilename(17)).toBe("proxy.ts");
    expect(middlewareFilename(15)).toBe("middleware.ts");
    expect(middlewareFilename(null)).toBe("middleware.ts");
  });
});

describe("computeMovePlan", () => {
  const entries = [
    { name: "page.tsx", isDir: false },
    { name: "layout.tsx", isDir: false },
    { name: "globals.css", isDir: false },
    { name: "(marketing)", isDir: true },
    { name: "dashboard", isDir: true },
    { name: "api", isDir: true },
    { name: "sitemap.ts", isDir: false },
    { name: "robots.ts", isDir: false },
    { name: "favicon.ico", isDir: false },
    { name: "opengraph-image.png", isDir: false },
    { name: "global-error.tsx", isDir: false },
  ];
  const plan = computeMovePlan(entries);

  it("keeps api, metadata files, and global-error at the app root", () => {
    expect(plan.keep).toEqual(
      expect.arrayContaining([
        "api",
        "sitemap.ts",
        "robots.ts",
        "favicon.ico",
        "opengraph-image.png",
        "global-error.tsx",
      ]),
    );
    expect(plan.move).not.toContain("api");
    expect(plan.move).not.toContain("sitemap.ts");
    expect(plan.move).not.toContain("favicon.ico");
  });

  it("moves route segments, groups, and colocated files under [locale]", () => {
    expect(plan.move).toEqual(
      expect.arrayContaining(["page.tsx", "layout.tsx", "(marketing)", "dashboard", "globals.css"]),
    );
  });

  it("emits git mv commands and structured moves into the [locale] segment", () => {
    expect(plan.gitMvCommands).toContain('git mv "app/page.tsx" "app/[locale]/page.tsx"');
    expect(plan.moves).toContainEqual({ from: "app/dashboard", to: "app/[locale]/dashboard" });
  });

  it("ignores an existing [locale] dir and respects a src/app base", () => {
    const srcPlan = computeMovePlan(
      [
        { name: "page.tsx", isDir: false },
        { name: "[locale]", isDir: true },
      ],
      "src/app",
    );
    expect(srcPlan.move).toEqual(["page.tsx"]);
    expect(srcPlan.moves).toContainEqual({
      from: "src/app/page.tsx",
      to: "src/app/[locale]/page.tsx",
    });
  });
});
