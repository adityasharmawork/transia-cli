import { recordCandidates } from "./candidates.js";
import { isLikelyUserFacing } from "./classify.js";

export interface ExtractedString {
  original: string;
  hash: string;
  context: string | null;
  source: string; // file:line
}

interface ExtractionResult {
  strings: ExtractedString[];
  errors: string[];
}

/**
 * Combine the auto-derived role hint with the author's explicit
 * `transia-context` note into the single `context` string the prompt consumes.
 * Both are complementary (structural role + semantic note), so we keep both;
 * null when neither is present.
 */
function mergeContext(auto?: string, explicit?: string | null): string | null {
  const parts = [auto, explicit].filter(
    (x): x is string => typeof x === "string" && x.trim().length > 0,
  );
  return parts.length > 0 ? parts.join(" — ") : null;
}

/**
 * Extract translatable strings from a source file.
 *
 * This is now a thin projection over the single shared recorder: it records
 * every candidate site, keeps the user-facing ones (the same classifier that
 * `apply` uses, so the two can never disagree), de-duplicates by content hash,
 * and maps to the extracted-string shape. Parse failures are logged by the
 * recorder; this function reports no separate error list.
 */
export function extractStringsFromSource(
  source: string,
  filePath: string,
  excludeAttributes: string[] = [],
): ExtractionResult {
  const candidates = recordCandidates(source, filePath);
  const strings: ExtractedString[] = [];
  const seen = new Set<string>();

  for (const c of candidates) {
    if (!isLikelyUserFacing(c, excludeAttributes)) continue;
    if (seen.has(c.hash)) continue;
    seen.add(c.hash);
    strings.push({
      original: c.sanitized,
      hash: c.hash,
      context: mergeContext(c.autoContext, c.context),
      source: `${filePath}:${c.line}`,
    });
  }

  return { strings, errors: [] };
}
