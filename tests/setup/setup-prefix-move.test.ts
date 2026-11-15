import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { setupNextIntlPrefix } from "../../src/commands/setup";
import type { TransiaConfig } from "../../src/state/schema";

function git(dir: string, args: string[]): void {
  execFileSync("git", args, { cwd: dir, stdio: "pipe" });
}

function makeGitProject(): string {
  const dir = mkdtempSync(resolve(tmpdir(), "transia-move-"));
  writeFileSync(
    resolve(dir, "package.json"),
    JSON.stringify({ dependencies: { next: "16.1.6", "next-intl": "4.0.0" } }),
  );
  writeFileSync(
    resolve(dir, "tsconfig.json"),
    JSON.stringify({ compilerOptions: { paths: { "@/*": ["./*"] } } }),
  );
  // A tracked next.config.js with no plugin: the plugin edit backs it up under
  // .transia-backup/, which a build-failure rollback must also clean up.
  writeFileSync(resolve(dir, "next.config.js"), `module.exports = {};\n`);
  mkdirSync(resolve(dir, "app", "api"), { recursive: true });
  writeFileSync(
    resolve(dir, "app", "layout.tsx"),
    `export default function RootLayout({ children }: { children: React.ReactNode }) { return (<html lang="en"><body>{children}</body></html>); }`,
  );
  writeFileSync(resolve(dir, "app", "page.tsx"), `export default function Page(){ return <h1>Hi</h1>; }`);
  writeFileSync(resolve(dir, "app", "api", "route.ts"), `export function GET(){ return new Response("ok"); }`);
  git(dir, ["init", "-q"]);
  git(dir, ["config", "user.email", "t@example.com"]);
  git(dir, ["config", "user.name", "t"]);
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-qm", "init"]);
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

describe("setupNextIntlPrefix --move (guarded)", () => {
  let dir: string;
  beforeEach(() => {
    dir = makeGitProject();
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("moves routes under [locale], adapts the layout, keeps api at root (build ok)", () => {
    setupNextIntlPrefix(dir, config, "npm", { move: true }, () => true);

    expect(existsSync(resolve(dir, "app/[locale]/page.tsx"))).toBe(true);
    expect(existsSync(resolve(dir, "app/[locale]/layout.tsx"))).toBe(true);
    expect(existsSync(resolve(dir, "app/page.tsx"))).toBe(false);
    // api never moves.
    expect(existsSync(resolve(dir, "app/api/route.ts"))).toBe(true);
    expect(existsSync(resolve(dir, "app/[locale]/api"))).toBe(false);
    // The moved layout is adapted for next-intl.
    const layout = readFileSync(resolve(dir, "app/[locale]/layout.tsx"), "utf8");
    expect(layout).toContain("NextIntlClientProvider");
    expect(layout).toMatch(/\{\s*children\s*,\s*params\b/);
  });

  it("rolls everything back to a clean tree when the build fails", () => {
    expect(() => setupNextIntlPrefix(dir, config, "npm", { move: true }, () => false)).toThrow(
      /rolled/i,
    );

    // Original tree restored.
    expect(existsSync(resolve(dir, "app/page.tsx"))).toBe(true);
    expect(existsSync(resolve(dir, "app/[locale]"))).toBe(false);
    // Scaffold artifacts removed.
    expect(existsSync(resolve(dir, "i18n/routing.ts"))).toBe(false);
    expect(existsSync(resolve(dir, "proxy.ts"))).toBe(false);
    // Working tree is clean again.
    const status = execFileSync("git", ["status", "--porcelain"], { cwd: dir, encoding: "utf8" });
    expect(status.trim()).toBe("");
  });

  it("refuses on a dirty git tree before touching anything", () => {
    writeFileSync(resolve(dir, "untracked.txt"), "x");
    expect(() => setupNextIntlPrefix(dir, config, "npm", { move: true }, () => true)).toThrow(
      /clean git tree/i,
    );
    // Nothing was scaffolded.
    expect(existsSync(resolve(dir, "i18n/routing.ts"))).toBe(false);
  });
});
