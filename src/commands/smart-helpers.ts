import { readFileSync } from "node:fs";
import { globSync } from "glob";

/**
 * The same translation-hook signature apply/hooks inserts and detects
 * (hooks.ts). If any included source file matches, `apply` has run.
 */
const HOOK_RE = /\b(useTranslations|useTranslation|getTranslations)\s*\(/;

/**
 * Has `transia apply` run? True when any file matched by the config's `include`
 * patterns references a translation hook. Conservative and read-only: on any
 * error (bad glob, unreadable file) it keeps scanning and returns false if it
 * finds nothing — so smart mode never over-claims "fully set up".
 */
export function detectApplied(
  projectRoot: string,
  include: string[],
  exclude: string[] = [],
): boolean {
  for (const pattern of include) {
    let files: string[] = [];
    try {
      files = globSync(pattern, { cwd: projectRoot, absolute: true, ignore: exclude });
    } catch {
      continue;
    }
    for (const file of files) {
      try {
        if (HOOK_RE.test(readFileSync(file, "utf-8"))) return true;
      } catch {
        // unreadable file — ignore and keep scanning
      }
    }
  }
  return false;
}

export interface Readiness {
  applied: boolean;
  title: string;
  /** The remaining step to perform, or null when fully set up. */
  nextStep: string | null;
}

/**
 * Honest readiness summary for smart mode. Only claims "fully set up" once
 * `apply` has run; otherwise it names `apply` as the remaining step so we never
 * tell the user their app is localized while the source still has hardcoded
 * strings.
 */
export function summarizeReadiness(applied: boolean): Readiness {
  if (applied) {
    return { applied: true, title: "Your project is fully set up!", nextStep: null };
  }
  return {
    applied: false,
    title: "Almost there — your translations are ready.",
    nextStep:
      "Run `transia apply` to replace the hardcoded strings in your source with t() calls (preview first with `transia apply --dry-run`).",
  };
}

/** Confirmation shown before smart mode auto-translates (which spends money). */
export function spendPrompt(provider: string, locales: string[]): string {
  return `Translate your strings into ${locales.join(", ")} using "${provider}"? This calls the provider API and may incur cost.`;
}

/** Confirmation shown before smart mode auto-runs setup (which installs packages). */
export function installPrompt(library: string): string {
  return `Install and configure "${library}" in this project? This runs your package manager to install it.`;
}
