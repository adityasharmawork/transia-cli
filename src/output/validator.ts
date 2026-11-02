import { logger } from "../utils/logger.js";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export function validateTranslation(
  key: string,
  original: string,
  translated: string,
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Empty translation for non-empty original
  if (translated.trim() === "" && original.trim() !== "") {
    errors.push(`"${key}": Translation is empty for non-empty original`);
  }

  // XSS: script tags
  if (/<script[\s>]/i.test(translated)) {
    errors.push(`"${key}": Translation contains <script> tag`);
  }

  // XSS: event handlers
  if (/\bon\w+\s*=/i.test(translated)) {
    errors.push(`"${key}": Translation contains event handler attribute`);
  }

  // Placeholder preservation — a mismatch (dropped OR added) is an ERROR: it
  // silently breaks interpolation in the translated locale. Compared as a
  // MULTISET so reordering is allowed but counts must match.
  const originalPlaceholders: string[] = original.match(/\{[^}]+\}/g) ?? [];
  const translatedPlaceholders: string[] = translated.match(/\{[^}]+\}/g) ?? [];
  const missing = multisetDiff(originalPlaceholders, translatedPlaceholders);
  const extra = multisetDiff(translatedPlaceholders, originalPlaceholders);
  if (missing.length > 0 || extra.length > 0) {
    const parts: string[] = [];
    if (missing.length > 0) parts.push(`missing ${missing.join(", ")}`);
    if (extra.length > 0) parts.push(`unexpected ${extra.join(", ")}`);
    errors.push(`"${key}": placeholder mismatch (${parts.join("; ")})`);
  }

  // Unbalanced braces would corrupt the catalog / interpolation.
  const openCount = (translated.match(/\{/g) ?? []).length;
  const closeCount = (translated.match(/\}/g) ?? []).length;
  if (openCount !== closeCount) {
    errors.push(`"${key}": unbalanced braces in translation`);
  }

  // New HTML tags that weren't in original
  const originalTags = (original.match(/<[a-zA-Z][^>]*>/g) || []).map(
    (t) => t.split(/[\s>]/)[0],
  );
  const translatedTags = (translated.match(/<[a-zA-Z][^>]*>/g) || []).map(
    (t) => t.split(/[\s>]/)[0],
  );
  const newTags = translatedTags.filter((t) => !originalTags.includes(t));
  if (newTags.length > 0) {
    warnings.push(
      `"${key}": Translation introduced new HTML tags: ${newTags.join(", ")}`,
    );
  }

  // Suspiciously long translation
  if (translated.length > original.length * 5 && original.length > 10) {
    warnings.push(
      `"${key}": Translation is ${translated.length} chars vs original ${original.length} chars`,
    );
  }

  // Log warnings
  for (const w of warnings) {
    logger.warn(w);
  }

  return { valid: errors.length === 0, errors, warnings };
}

/** Elements of `a` not covered by `b`, respecting multiplicity. */
function multisetDiff(a: string[], b: string[]): string[] {
  const counts = new Map<string, number>();
  for (const x of b) counts.set(x, (counts.get(x) ?? 0) + 1);
  const out: string[] = [];
  for (const x of a) {
    const c = counts.get(x) ?? 0;
    if (c > 0) counts.set(x, c - 1);
    else out.push(x);
  }
  return out;
}
