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
      context: c.context,
      source: `${filePath}:${c.line}`,
    });
  }

  return { strings, errors: [] };
}
