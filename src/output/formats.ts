import { resolve } from "node:path";
import type { TransiaState, TransiaConfig } from "../state/schema.js";
import { generateKey } from "../utils/crypto.js";
import { readCatalogs } from "./reader.js";
import { mergeCatalogs, type MergeOptions } from "./merge.js";
import { writeOutputFiles } from "./writer.js";

export type OutputFormat = "next-intl" | "i18next";

export interface OutputFile {
  path: string;
  content: string;
}

/**
 * Build the in-memory `locale -> (key -> value)` catalogs from state.
 * This is the pre-serialization shape shared by file generation and merging.
 */
export function buildCatalogs(
  state: TransiaState,
  locales: string[],
  sourceLocale: string,
): Map<string, Record<string, string>> {
  const byLocale = new Map<string, Record<string, string>>();
  for (const locale of [sourceLocale, ...locales]) {
    byLocale.set(locale, {});
  }

  for (const [hash, entry] of Object.entries(state.strings)) {
    const key = generateKey(entry.original, hash);

    byLocale.get(sourceLocale)![key] = entry.original;

    for (const locale of locales) {
      const translation = entry.translations[locale];
      if (translation) {
        byLocale.get(locale)![key] = translation.value;
      }
    }
  }

  return byLocale;
}

/** Serialize in-memory catalogs to on-disk files for the chosen format. */
export function serializeCatalogs(
  catalogs: Map<string, Record<string, string>>,
  outputPath: string,
  format: OutputFormat,
): OutputFile[] {
  return format === "next-intl"
    ? generateNextIntlFiles(catalogs, outputPath)
    : generateI18nextFiles(catalogs, outputPath);
}

/**
 * Generate output translation files from state (regenerate from scratch).
 * Retained for callers that want a pure projection of state; the write path
 * now prefers writeMergedCatalogs so existing files and hand edits survive.
 */
export function generateOutputFiles(
  state: TransiaState,
  outputPath: string,
  format: OutputFormat,
  locales: string[],
  sourceLocale: string,
): OutputFile[] {
  return serializeCatalogs(
    buildCatalogs(state, locales, sourceLocale),
    outputPath,
    format,
  );
}

/**
 * Write translations by MERGING freshly generated values into the existing
 * on-disk catalogs, rather than regenerating from scratch. This is what makes
 * a fresh clone, a partial failure, and a hand edit all non-destructive:
 * committed locale files are the source of truth.
 */
export function writeMergedCatalogs(
  projectRoot: string,
  state: TransiaState,
  config: TransiaConfig,
  locales: string[],
  opts: MergeOptions,
): number {
  const outputPath = resolve(projectRoot, config.output.path);
  const allLocales = [config.sourceLocale, ...locales];

  const existing = readCatalogs(outputPath, config.output.format, allLocales);
  const generated = buildCatalogs(state, locales, config.sourceLocale);
  const merged = mergeCatalogs(existing, generated, opts);

  const files = serializeCatalogs(merged, outputPath, config.output.format);
  writeOutputFiles(files);
  return files.length;
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
/**
 * i18next uses double-brace interpolation (`{{name}}`); our in-memory/state and
 * next-intl form is single-brace (`{name}`). Convert only on the way to disk.
 */
function toI18nextInterp(value: string): string {
  return value.replace(/\{([^{}]+)\}/g, "{{$1}}");
}

function generateI18nextFiles(
  translations: Map<string, Record<string, string>>,
  outputPath: string,
): OutputFile[] {
  const files: OutputFile[] = [];

  for (const [locale, strings] of translations) {
    // Convert interpolation to i18next's {{x}} form, then nest.
    const converted: Record<string, string> = {};
    for (const [k, v] of Object.entries(strings)) converted[k] = toI18nextInterp(v);
    const nested = buildNestedObject(converted);

    files.push({
      path: resolve(outputPath, locale, "translation.json"),
      content: JSON.stringify(nested, null, 2) + "\n",
    });
  }

  return files;
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
