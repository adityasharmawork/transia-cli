/**
 * Format the distinct reasons a set of translation batches failed, for the
 * translate summary — so users see *why* (401, rate limit, bad model) instead
 * of only "N batch(es) failed". Dedupes, collapses whitespace, truncates long
 * provider errors, caps the number shown, and reports the remainder. Returns ""
 * when there were no failures.
 */
export function summarizeBatchFailures(
  messages: string[],
  maxDistinct = 3,
  maxLen = 160,
): string {
  // Dedupe on the FULL normalized message (before truncation), so two genuinely
  // distinct causes that only differ past maxLen are not collapsed into one.
  const distinct: string[] = [];
  for (const raw of messages) {
    const normalized = raw.replace(/\s+/g, " ").trim();
    if (normalized && !distinct.includes(normalized)) distinct.push(normalized);
  }

  if (distinct.length === 0) return "";

  const shown = distinct
    .slice(0, maxDistinct)
    .map((m) => (m.length > maxLen ? m.slice(0, maxLen - 1) + "…" : m));
  const extra = distinct.length - Math.min(distinct.length, maxDistinct);
  const suffix = extra > 0 ? ` (+${extra} more)` : "";
  return shown.map((m) => `- ${m}`).join("\n") + suffix;
}
