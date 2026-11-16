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
  const distinct: string[] = [];
  for (const raw of messages) {
    const normalized = raw.replace(/\s+/g, " ").trim();
    const clipped =
      normalized.length > maxLen ? normalized.slice(0, maxLen - 1) + "…" : normalized;
    if (clipped && !distinct.includes(clipped)) distinct.push(clipped);
  }

  if (distinct.length === 0) return "";

  const shown = distinct.slice(0, maxDistinct);
  const extra = distinct.length - shown.length;
  const suffix = extra > 0 ? ` (+${extra} more)` : "";
  return shown.map((m) => `- ${m}`).join("\n") + suffix;
}
