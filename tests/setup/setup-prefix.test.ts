import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { setupNextIntlPrefix } from "../../src/commands/setup";
import type { TransiaConfig } from "../../src/state/schema";

function makeProject(): string {
  const dir = mkdtempSync(resolve(tmpdir(), "transia-prefix-"));
  writeFileSync(
    resolve(dir, "package.json"),
    JSON.stringify({ dependencies: { next: "16.1.6", "next-intl": "4.0.0" } }),
  );
  mkdirSync(resolve(dir, "app"), { recursive: true });
  writeFileSync(
    resolve(dir, "app", "layout.tsx"),
    `export default function RootLayout({ children }: { children: React.ReactNode }) { return (<html><body>{children}</body></html>); }`,
  );
  writeFileSync(resolve(dir, "app", "page.tsx"), `export default function Page(){ return <h1>Hi</h1>; }`);
  return dir;
}

const config = {
  version: 1,
  sourceLocale: "en",
  targetLocales: ["es", "fr"],
  provider: { name: "auto" },
  include: ["app/**/*.{tsx,jsx}"],
  exclude: [],
  output: { format: "next-intl", path: "locales" },
  routing: "prefix",
} as unknown as TransiaConfig;

describe("setupNextIntlPrefix (scaffold; default, no --move)", () => {
  let dir: string;
  beforeEach(() => {
    dir = makeProject();
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("scaffolds routing/navigation/request + proxy.ts (Next 16) without moving routes", () => {
    const res = setupNextIntlPrefix(dir, config, "npm", {});

    expect(existsSync(resolve(dir, "i18n/routing.ts"))).toBe(true);
    expect(existsSync(resolve(dir, "i18n/navigation.ts"))).toBe(true);
    expect(existsSync(resolve(dir, "i18n/request.ts"))).toBe(true);
    // Next 16 -> proxy.ts, not middleware.ts
    expect(existsSync(resolve(dir, "proxy.ts"))).toBe(true);
    expect(existsSync(resolve(dir, "middleware.ts"))).toBe(false);
    // A root layout exists, so the default must NOT write a template that would
    // collide with the printed `git mv app/layout.tsx app/[locale]/layout.tsx`.
    expect(existsSync(resolve(dir, "app/[locale]/layout.tsx"))).toBe(false);

    // The safe default moves nothing and never clobbers the existing layout.
    expect(existsSync(resolve(dir, "app/page.tsx"))).toBe(true);
    expect(existsSync(resolve(dir, "app/[locale]/page.tsx"))).toBe(false);
    expect(readFileSync(resolve(dir, "app/layout.tsx"), "utf8")).not.toContain(
      "NextIntlClientProvider",
    );

    // Generated content is prefix-mode.
    expect(readFileSync(resolve(dir, "i18n/routing.ts"), "utf8")).toContain(
      'localePrefix: "as-needed"',
    );
    expect(readFileSync(resolve(dir, "proxy.ts"), "utf8")).toContain("createMiddleware(routing)");

    // Guided move checklist is surfaced, including moving + adapting the layout.
    const notes = res.skipped.join("\n");
    expect(notes).toMatch(/git mv .*\[locale\]/);
    expect(notes).toMatch(/git mv "app\/layout\.tsx"/);
    expect(notes).toMatch(/adapt the moved app\/\[locale\]\/layout\.tsx/i);

    // No siteUrl -> no sitemap/metadata, just a note to set it.
    expect(existsSync(resolve(dir, "i18n/metadata.ts"))).toBe(false);
    expect(existsSync(resolve(dir, "app/sitemap.ts"))).toBe(false);
    expect(notes).toMatch(/siteUrl/);
  });

  it("writes i18n/metadata.ts + app/sitemap.ts when siteUrl is set", () => {
    const withUrl = { ...config, siteUrl: "https://example.com" } as typeof config;
    setupNextIntlPrefix(dir, withUrl, "npm", {});

    expect(existsSync(resolve(dir, "i18n/metadata.ts"))).toBe(true);
    expect(existsSync(resolve(dir, "app/sitemap.ts"))).toBe(true);
    expect(readFileSync(resolve(dir, "i18n/metadata.ts"), "utf8")).toContain("getAlternates");
    const sm = readFileSync(resolve(dir, "app/sitemap.ts"), "utf8");
    expect(sm).toContain("MetadataRoute.Sitemap");
    expect(sm).toContain('"https://example.com"');
    expect(sm).toContain('from "../i18n/routing"');
  });

  it("writes the [locale] layout template when the project has NO root layout", () => {
    rmSync(resolve(dir, "app", "layout.tsx"));
    const res = setupNextIntlPrefix(dir, config, "npm", {});
    expect(existsSync(resolve(dir, "app/[locale]/layout.tsx"))).toBe(true);
    expect(res.created).toContain("app/[locale]/layout.tsx");
  });

  it("places middleware under src/ for a src/app project (so Next discovers it)", () => {
    const sdir = mkdtempSync(resolve(tmpdir(), "transia-srcapp-"));
    writeFileSync(
      resolve(sdir, "package.json"),
      JSON.stringify({ dependencies: { next: "16.1.6", "next-intl": "4.0.0" } }),
    );
    mkdirSync(resolve(sdir, "src", "app"), { recursive: true });
    writeFileSync(
      resolve(sdir, "src", "app", "layout.tsx"),
      `export default function L({ children }: { children: React.ReactNode }) { return <html><body>{children}</body></html>; }`,
    );
    try {
      setupNextIntlPrefix(sdir, config, "npm", {});
      // middleware (proxy.ts on Next 16) must be under src/, not the project root.
      expect(existsSync(resolve(sdir, "src/proxy.ts"))).toBe(true);
      expect(existsSync(resolve(sdir, "proxy.ts"))).toBe(false);
      // Its routing import resolves to <root>/i18n from src/.
      expect(readFileSync(resolve(sdir, "src/proxy.ts"), "utf8")).toContain('"../i18n/routing"');
      // i18n still lives at the project root.
      expect(existsSync(resolve(sdir, "i18n/routing.ts"))).toBe(true);
    } finally {
      rmSync(sdir, { recursive: true, force: true });
    }
  });

  it("is idempotent: a second run clobbers nothing and reports no new creations", () => {
    setupNextIntlPrefix(dir, config, "npm", {});
    const res2 = setupNextIntlPrefix(dir, config, "npm", {});
    expect(res2.created).toEqual([]);
  });
});
