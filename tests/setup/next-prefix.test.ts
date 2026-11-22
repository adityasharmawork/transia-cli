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
  transformLayoutForPrefix,
  metadataHelperModule,
  sitemapModule,
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

  it("keeps numbered metadata variants (icon1.png, opengraph-image1.png) at the root", () => {
    const p = computeMovePlan([
      { name: "icon1.png", isDir: false },
      { name: "apple-icon2.png", isDir: false },
      { name: "opengraph-image1.png", isDir: false },
      { name: "opengraph-image.alt.txt", isDir: false },
      { name: "page.tsx", isDir: false },
    ]);
    expect(p.keep).toEqual(
      expect.arrayContaining([
        "icon1.png",
        "apple-icon2.png",
        "opengraph-image1.png",
        "opengraph-image.alt.txt",
      ]),
    );
    expect(p.move).toEqual(["page.tsx"]);
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

describe("transformLayoutForPrefix", () => {
  const base = `import "./globals.css";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}`;

  it("turns a standard root layout into a [locale] layout", () => {
    const r = transformLayoutForPrefix(base);
    expect(r.wrapped).toBe(true);
    if (!r.wrapped) return;
    const out = r.output;
    expect(out).toContain("async function RootLayout");
    // params must be bound in the destructure (not only present in the type).
    expect(out).toMatch(/\{\s*children\s*,\s*params\b/);
    expect(out).toContain("await params");
    expect(out).toContain("params: Promise<{ locale: string }>");
    expect(out).toContain("hasLocale(routing.locales, locale)");
    expect(out).toContain("notFound()");
    expect(out).toContain("setRequestLocale(locale)");
    expect(out).toContain("lang={locale}");
    expect(out).toContain("NextIntlClientProvider");
    expect(out).toContain("generateStaticParams");
    expect(() => parses(out)).not.toThrow();
  });

  it("handles a Readonly<{ children }> prop type and still produces valid TSX", () => {
    const src = `export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html>
      <body>{children}</body>
    </html>
  );
}`;
    const r = transformLayoutForPrefix(src);
    expect(r.wrapped).toBe(true);
    if (r.wrapped) {
      expect(r.output).toContain("lang={locale}");
      expect(() => parses(r.output)).not.toThrow();
    }
  });

  it('refuses a "use client" layout', () => {
    const r = transformLayoutForPrefix(`"use client";\n${base}`);
    expect(r.wrapped).toBe(false);
  });

  it("refuses when there is no <html>/<body>", () => {
    const r = transformLayoutForPrefix(
      `export default function L({ children }: { children: React.ReactNode }) { return <div>{children}</div>; }`,
    );
    expect(r.wrapped).toBe(false);
  });

  it("refuses a layout with two conditional <html> branches (review #5)", () => {
    const src = `export default function RootLayout({ children }: { children: React.ReactNode }) {
  if (process.env.MAINTENANCE) {
    return (
      <html>
        <body>{children}</body>
      </html>
    );
  }
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}`;
    const r = transformLayoutForPrefix(src);
    expect(r.wrapped).toBe(false);
    if (!r.wrapped) expect(r.reason).toMatch(/multiple|conditional/i);
  });
});

describe("metadataHelperModule", () => {
  it("builds getAlternates with canonical + per-locale languages + x-default", () => {
    const src = metadataHelperModule("https://example.com/");
    expect(src).toContain("export function getAlternates");
    expect(src).toContain("getPathname({ href: pathname, locale })");
    expect(src).toContain("routing.locales");
    expect(src).toContain('"x-default"');
    // Trailing slash stripped so URLs aren't doubled.
    expect(src).toContain('"https://example.com"');
    expect(src).not.toContain('"https://example.com/"');
    expect(() => parses(src)).not.toThrow();
  });
});

describe("sitemapModule", () => {
  it("emits a localized MetadataRoute.Sitemap with per-entry alternates.languages", () => {
    const src = sitemapModule("https://example.com", "../i18n/routing", "../i18n/navigation");
    expect(src).toContain("MetadataRoute.Sitemap");
    expect(src).toContain("const pathnames");
    expect(src).toContain("alternates: { languages:");
    expect(src).toContain('"x-default"');
    expect(src).toContain('from "../i18n/routing"');
    expect(src).toContain('from "../i18n/navigation"');
    expect(() => parses(src)).not.toThrow();
  });
});
