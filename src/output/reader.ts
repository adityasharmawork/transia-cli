import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { TransiaError, ExitCode } from "../utils/errors.js";
import type { OutputFormat } from "./formats.js";

/**
 * Read the existing on-disk translation catalogs.
 *
 * The committed locale files are the source of truth; this reader lets the
 * writer merge new translations into them instead of regenerating from scratch
 * (which is what destroyed hand edits and wiped data on fresh clones).
 *
 * Returns a flat `key -> value` map per locale. For i18next the nested JSON is
 * flattened back to dot-separated keys so both formats share one shape. A
 * missing file yields an empty map (not an error); malformed JSON is an error
 * so we never silently treat a corrupt catalog as "empty" and overwrite it.
 */
export function readCatalogs(
  outputPath: string,
  format: OutputFormat,
  locales: string[],
): Map<string, Record<string, string>> {
  const catalogs = new Map<string, Record<string, string>>();

  for (const locale of locales) {
    const filePath =
      format === "next-intl"
        ? resolve(outputPath, `${locale}.json`)
        : resolve(outputPath, locale, "translation.json");

    if (!existsSync(filePath)) {
      catalogs.set(locale, {});
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(filePath, "utf-8"));
    } catch (error) {
      throw new TransiaError(
        ExitCode.STATE_ERROR,
        `Could not parse translation file "${filePath}": ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    const flat =
      format === "next-intl"
        ? toStringRecord(parsed)
        : flattenCatalog(parsed as Record<string, unknown>);

    catalogs.set(locale, flat);
  }

  return catalogs;
}

/** Coerce an already-flat object into a string record, dropping non-strings. */
function toStringRecord(value: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (typeof v === "string") out[k] = v;
    }
  }
  return out;
}

/**
 * Flatten a nested catalog `{ a: { b: "X" } }` to `{ "a.b": "X" }`.
 * Inverse of `formats.ts#buildNestedObject`.
 */
function flattenCatalog(
  obj: Record<string, unknown>,
  prefix = "",
  out: Record<string, string> = {},
): Record<string, string> {
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      flattenCatalog(value as Record<string, unknown>, path, out);
    } else if (typeof value === "string") {
      out[path] = value;
    }
  }
  return out;
}
