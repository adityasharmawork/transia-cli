/**
 * Validate a BCP-47 language tag using the platform's own canonicaliser.
 * This accepts real-world tags the old `^[a-z]{2}(-[A-Z]{2})?$` regex rejected
 * — script subtags (`zh-Hans`), UN M.49 regions (`es-419`), and three-part
 * tags (`zh-Hant-TW`) — while still rejecting structurally invalid input.
 */
export function isValidLocale(tag: string): boolean {
  if (typeof tag !== "string") return false;
  // Reject surrounding whitespace outright so a padded tag can't sneak through.
  if (tag.length === 0 || tag !== tag.trim()) return false;
  try {
    return Intl.getCanonicalLocales(tag).length === 1;
  } catch {
    return false;
  }
}
