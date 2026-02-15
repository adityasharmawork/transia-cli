import { resolve } from "node:path";
import type { TransiaState } from "../state/schema.js";

export type OutputFormat = "next-intl" | "i18next";

export interface OutputFile {
  path: string;
  content: string;
}

/**
 * Generate output translation files from state.
 */
export function generateOutputFiles(
  state: TransiaState,
  outputPath: string,
  format: OutputFormat,
  locales: string[],
  sourceLocale: string,
): OutputFile[] {
  const files: OutputFile[] = [];

  // Build translation maps per locale
  const translationsByLocale = new Map<string, Record<string, string>>();

  // Include source locale
  const allLocales = [sourceLocale, ...locales];
  for (const locale of allLocales) {
    translationsByLocale.set(locale, {});
  }

  for (const [hash, entry] of Object.entries(state.strings)) {
    // Generate a stable key from the original string, using hash suffix for uniqueness
    const key = generateKey(entry.original, hash);

    // Source locale gets the original
    const sourceMap = translationsByLocale.get(sourceLocale)!;
    sourceMap[key] = entry.original;

    // Target locales get translations
    for (const locale of locales) {
      const localeMap = translationsByLocale.get(locale)!;
      const translation = entry.translations[locale];
      if (translation) {
        localeMap[key] = translation.value;
      }
    }
  }

  if (format === "next-intl") {
    files.push(
      ...generateNextIntlFiles(translationsByLocale, outputPath),
    );
  } else {
    files.push(
      ...generateI18nextFiles(translationsByLocale, outputPath),
    );
  }

  return files;
}

/**
 * next-intl format: locales/en.json, locales/es.json
 */
function generateNextIntlFiles(
  translations: Map<string, Record<string, string>>,
  outputPath: string,
): OutputFile[] {
  const files: OutputFile[] = [];

  for (const [locale, strings] of translations) {
    // Sort keys for deterministic output
    const sorted: Record<string, string> = {};
    for (const key of Object.keys(strings).sort()) {
      sorted[key] = strings[key];
    }

    files.push({
      path: resolve(outputPath, `${locale}.json`),
      content: JSON.stringify(sorted, null, 2) + "\n",
    });
  }

  return files;
}

/**
 * i18next format: locales/en/translation.json, locales/es/translation.json
 */
function generateI18nextFiles(
  translations: Map<string, Record<string, string>>,
  outputPath: string,
): OutputFile[] {
  const files: OutputFile[] = [];

  for (const [locale, strings] of translations) {
    // Build nested structure from dot-separated keys
    const nested = buildNestedObject(strings);

    files.push({
      path: resolve(outputPath, locale, "translation.json"),
      content: JSON.stringify(nested, null, 2) + "\n",
    });
  }

  return files;
}

/**
 * Generate a stable, readable key from a string with a hash suffix for uniqueness.
 * "Welcome to Dashboard" → "welcome_to_dashboard_a1b2c3"
 */
function generateKey(original: string, hash: string): string {
  const base = original
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .trim()
    .replace(/\s+/g, "_")
    .slice(0, 50);
  return base ? `${base}_${hash.slice(0, 6)}` : hash.slice(0, 16);
}

/**
 * Convert flat dot-separated keys to nested object.
 * { "dashboard.title": "X" } → { dashboard: { title: "X" } }
 */
function buildNestedObject(
  flat: Record<string, string>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  const sortedKeys = Object.keys(flat).sort();
  for (const key of sortedKeys) {
    const parts = key.split(".");
    let current = result;

    for (let i = 0; i < parts.length - 1; i++) {
      if (!(parts[i] in current) || typeof current[parts[i]] !== "object") {
        current[parts[i]] = {};
      }
      current = current[parts[i]] as Record<string, unknown>;
    }

    current[parts[parts.length - 1]] = flat[key];
  }

  return result;
}
