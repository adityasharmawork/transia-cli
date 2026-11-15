import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "@babel/parser";
import { setupCommand } from "../../src/commands/setup";

const parseOk = (s: string) => {
  try {
    parse(s, { sourceType: "module", plugins: ["jsx", "typescript"] });
    return true;
  } catch {
    return false;
  }
};

describe("setupCommand — Next.js cookie mode (no middleware)", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "transia-setup-e2e-"));
    // next + next-intl already "installed" so setup skips the network install.
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ dependencies: { next: "15.0.0", "next-intl": "3.0.0" } }),
    );
    writeFileSync(
      join(root, "transia.config.json"),
      JSON.stringify({
        version: 2,
        sourceLocale: "en",
        targetLocales: ["es"],
        provider: { name: "gemini" },
        include: ["app/**/*.tsx"],
        exclude: [],
        output: { format: "next-intl", path: "locales" },
      }),
    );
    writeFileSync(
      join(root, "next.config.ts"),
      `import type { NextConfig } from "next";\nconst nextConfig: NextConfig = { reactStrictMode: true };\nexport default nextConfig;\n`,
    );
    mkdirSync(join(root, "app"), { recursive: true });
    writeFileSync(
      join(root, "app", "layout.tsx"),
      `export default function RootLayout({ children }: { children: React.ReactNode }) {\n  return (\n    <html>\n      <body>{children}</body>\n    </html>\n  );\n}\n`,
    );
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("creates cookie-mode request config, no middleware, wraps layout + next.config", async () => {
    await setupCommand(root, {});

    // cookie-reading request config, no prefix middleware
    const req = readFileSync(join(root, "i18n", "request.ts"), "utf-8");
    expect(req).toContain("NEXT_LOCALE");
    expect(existsSync(join(root, "middleware.ts"))).toBe(false);

    // layout wrapped and still valid
    const layout = readFileSync(join(root, "app", "layout.tsx"), "utf-8");
    expect(layout).toContain("NextIntlClientProvider");
    expect(parseOk(layout)).toBe(true);

    // next.config gets the plugin
    expect(readFileSync(join(root, "next.config.ts"), "utf-8")).toContain("next-intl/plugin");

    // source messages file
    expect(existsSync(join(root, "locales", "en.json"))).toBe(true);
  });

  it("migrates an old prefix-mode setup: rewrites request.ts and removes the prefix middleware", async () => {
    // Simulate a project configured by an earlier (prefix-routing) build.
    mkdirSync(join(root, "i18n"), { recursive: true });
    writeFileSync(
      join(root, "i18n", "request.ts"),
      `import { getRequestConfig } from "next-intl/server";\nimport { routing } from "./routing";\nexport default getRequestConfig(async ({ requestLocale }) => {\n  const locale = await requestLocale;\n  return { locale, messages: {} };\n});\n`,
    );
    writeFileSync(
      join(root, "middleware.ts"),
      `import createMiddleware from "next-intl/middleware";\nexport default createMiddleware({});\n`,
    );

    await setupCommand(root, {});

    // request.ts migrated to cookie mode; prefix middleware removed (backed up).
    expect(readFileSync(join(root, "i18n", "request.ts"), "utf-8")).toContain("NEXT_LOCALE");
    expect(existsSync(join(root, "middleware.ts"))).toBe(false);
    expect(existsSync(join(root, ".transia-backup"))).toBe(true);
  });
});
