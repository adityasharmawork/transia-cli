import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  detectApplied,
  summarizeReadiness,
  spendPrompt,
  installPrompt,
} from "../../src/commands/smart-helpers";

describe("detectApplied", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(resolve(tmpdir(), "transia-applied-"));
    mkdirSync(resolve(dir, "app"), { recursive: true });
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("is false when the source still has only hardcoded strings (apply not run)", () => {
    writeFileSync(
      resolve(dir, "app", "page.tsx"),
      `export default function P(){ return <h1>Hello world</h1>; }`,
    );
    expect(detectApplied(dir, ["app/**/*.{tsx,jsx}"])).toBe(false);
  });

  it("is true when a file uses a translation hook (apply has run)", () => {
    writeFileSync(
      resolve(dir, "app", "page.tsx"),
      `import {useTranslations} from "next-intl";\nexport default function P(){ const t=useTranslations(); return <h1>{t("hello")}</h1>; }`,
    );
    expect(detectApplied(dir, ["app/**/*.{tsx,jsx}"])).toBe(true);
  });

  it("ignores the generated language-switcher widget (added before apply, not evidence)", () => {
    mkdirSync(resolve(dir, "src", "components"), { recursive: true });
    writeFileSync(
      resolve(dir, "src", "components", "TransiaLanguageSwitcher.tsx"),
      `import {useTranslation} from "react-i18next";\nexport function W(){ const {t}=useTranslation(); return null; }`,
    );
    writeFileSync(resolve(dir, "src", "page.tsx"), `export default function P(){ return <h1>Hardcoded</h1>; }`);
    expect(detectApplied(dir, ["src/**/*.{tsx,jsx}"])).toBe(false);
  });
});

describe("summarizeReadiness", () => {
  it("claims full setup only when applied", () => {
    const r = summarizeReadiness(true);
    expect(r.applied).toBe(true);
    expect(r.title).toMatch(/fully set up/i);
    expect(r.nextStep).toBeNull();
  });

  it("never claims full setup when not applied, and names `apply` as the next step", () => {
    const r = summarizeReadiness(false);
    expect(r.applied).toBe(false);
    expect(r.title).not.toMatch(/fully set up/i);
    expect(r.nextStep).toMatch(/transia apply/);
  });
});

describe("confirmation prompts", () => {
  it("spendPrompt names the provider, the locales, and that it costs", () => {
    const p = spendPrompt("openai", ["es", "fr"]);
    expect(p).toContain("openai");
    expect(p).toContain("es, fr");
    expect(p).toMatch(/cost|API/i);
  });

  it("installPrompt names the library and that it installs", () => {
    const p = installPrompt("next-intl");
    expect(p).toContain("next-intl");
    expect(p).toMatch(/install/i);
  });
});
