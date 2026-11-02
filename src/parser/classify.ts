import type { Candidate } from "./candidates.js";
import { isExcludedAttribute } from "./attributes.js";

/** Calls whose string arguments are styling tokens, never user copy. */
const STYLING_CALLS = new Set(["cn", "clsx", "cva", "tw", "twMerge", "cx", "styled"]);

/** Calls that mean the string is already a translation key / already wrapped. */
const TRANSLATION_CALLS = new Set(["t", "getTranslations", "useTranslations"]);

/**
 * Predicate/membership calls whose string argument is a sentinel compared
 * against data, not copy. Translating it breaks control flow in non-source
 * locales exactly like `=== "active"` does.
 */
const PREDICATE_CALLS = new Set([
  "includes",
  "startsWith",
  "endsWith",
  "indexOf",
  "lastIndexOf",
  "has",
  "match",
  "test",
]);

/**
 * Decide whether a recorded candidate is user-facing copy that should be
 * translated. Policy (signed off): translate by DEFAULT (max coverage), and
 * reject only when the string is clearly not words —
 *   1. it is an operand of a comparison (sentinel, not copy),
 *   2. it sits inside a styling helper (cn/clsx/cva/...),
 *   3. it is already inside a t()/getTranslations() call (idempotency),
 *   4. it is a deny-listed structural/technical attribute value.
 *
 * The asymmetry that drives this: a false "yes" on a sentinel breaks control
 * flow in the translated locale (expensive, invisible); a false "no" merely
 * leaves one string untranslated (cheap). So we reject the code-like cases and
 * translate everything else.
 */
export function isLikelyUserFacing(
  c: Candidate,
  excludeAttributes: string[] = [],
): boolean {
  if (c.insideComparison) return false;
  if (c.insideCall && STYLING_CALLS.has(c.insideCall)) return false;
  if (c.insideCall && TRANSLATION_CALLS.has(c.insideCall)) return false;
  if (c.insideCall && PREDICATE_CALLS.has(c.insideCall)) return false;
  if (
    c.role === "jsx-attr" &&
    c.attribute &&
    isExcludedAttribute(c.attribute, excludeAttributes)
  ) {
    return false;
  }
  return true;
}
