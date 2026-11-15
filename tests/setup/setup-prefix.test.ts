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
    expect(existsSync(resolve(dir, "app/[locale]/layout.tsx"))).toBe(true);

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

    // Guided move checklist is surfaced.
    expect(res.skipped.join("\n")).toMatch(/git mv .*\[locale\]/);
  });

  it("is idempotent: a second run clobbers nothing and reports no new creations", () => {
    setupNextIntlPrefix(dir, config, "npm", {});
    const res2 = setupNextIntlPrefix(dir, config, "npm", {});
    expect(res2.created).toEqual([]);
  });
});
