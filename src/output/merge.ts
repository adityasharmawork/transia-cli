export interface MergeOptions {
  /** Overwrite an existing value with the freshly generated one. */
  force: boolean;
  /** Remove existing keys that are no longer present in the generated set. */
  prune: boolean;
}

/**
 * Merge freshly generated translations into the existing on-disk catalogs.
 *
 * The committed locale files are the source of truth, so the default is
 * conservative: existing values win, nothing is dropped. This is what makes a
 * fresh clone (empty generated set), a partial provider failure (incomplete
 * generated set), and a hand edit all non-destructive.
 *
 * - A generated key is written only when it is absent from `existing`, unless
 *   `force` is set (then it overwrites).
 * - An existing key is never removed unless `prune` is set AND the key is
 *   absent from the generated set for that locale.
 */
export function mergeCatalogs(
  existing: Map<string, Record<string, string>>,
  generated: Map<string, Record<string, string>>,
  opts: MergeOptions,
): Map<string, Record<string, string>> {
  const result = new Map<string, Record<string, string>>();
  const locales = new Set<string>([...existing.keys(), ...generated.keys()]);

  for (const locale of locales) {
    const existingEntries = existing.get(locale) ?? {};
    const generatedEntries = generated.get(locale) ?? {};
    const merged: Record<string, string> = { ...existingEntries };

    for (const [key, value] of Object.entries(generatedEntries)) {
      if (opts.force || !(key in existingEntries)) {
        merged[key] = value;
      }
    }

    if (opts.prune) {
      for (const key of Object.keys(merged)) {
        if (!(key in generatedEntries)) {
          delete merged[key];
        }
      }
    }

    result.set(locale, merged);
  }

  return result;
}
