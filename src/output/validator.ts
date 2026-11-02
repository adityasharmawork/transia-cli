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

  // Placeholder/argument preservation — a mismatch (dropped OR added) is an
  // ERROR: it silently breaks interpolation in the translated locale. We compare
  // the MULTISET of TOP-LEVEL argument names, so reordering is allowed and ICU
  // constructs like `{count, plural, one {# item} other {# items}}` compare on
  // their argument (`count`), not on the sub-messages a translator must change.
  const originalArgs = parsePlaceholders(original);
  const translatedArgs = parsePlaceholders(translated);
  const missing = multisetDiff(originalArgs.args, translatedArgs.args);
  const extra = multisetDiff(translatedArgs.args, originalArgs.args);
  if (missing.length > 0 || extra.length > 0) {
    const parts: string[] = [];
    if (missing.length > 0) parts.push(`missing ${missing.join(", ")}`);
    if (extra.length > 0) parts.push(`unexpected ${extra.join(", ")}`);
    errors.push(`"${key}": placeholder/argument mismatch (${parts.join("; ")})`);
  }

  // Misnested or unbalanced braces would corrupt the catalog / interpolation.
  if (!translatedArgs.balanced) {
    errors.push(`"${key}": unbalanced or misnested braces in translation`);
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

/**
 * Extract the TOP-LEVEL interpolation argument names from a message, tracking
 * brace depth so nested ICU sub-messages are not mistaken for arguments. Also
 * reports whether braces are balanced and well-nested. Examples:
 *   "Hi {name}"                                   -> { args: ["name"] }
 *   "{a}{b}"                                       -> { args: ["a","b"] }
 *   "{count, plural, one {# item} other {# x}}"    -> { args: ["count"] }
 *   "}name{"                                        -> balanced: false
 */
function parsePlaceholders(s: string): { args: string[]; balanced: boolean } {
  const args: string[] = [];
  let depth = 0;
  let topStart = -1;
  let balanced = true;

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "{") {
      if (depth === 0) topStart = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth < 0) {
        balanced = false;
        depth = 0;
      } else if (depth === 0 && topStart >= 0) {
        const inner = s.slice(topStart + 1, i);
        const comma = inner.indexOf(",");
        args.push((comma >= 0 ? inner.slice(0, comma) : inner).trim());
        topStart = -1;
      }
    }
  }
  if (depth !== 0) balanced = false;
  return { args, balanced };
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
