import { createHash } from "node:crypto";

export function hashString(str: string): string {
  return createHash("sha256").update(str, "utf8").digest("hex");
}

/**
 * Generate a stable, readable key from a string with a hash suffix for uniqueness.
 * "Welcome to Dashboard" → "welcome_to_dashboard_a1b2c3"
 *
 * IMPORTANT: This function is the single source of truth for key generation.
 * Both output/formats.ts and commands/apply.ts must use this same function
 * to ensure translation keys match between generated files and applied code.
 */
export function generateKey(original: string, hash: string): string {
  const base = original
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .trim()
    .replace(/\s+/g, "_")
    .slice(0, 50);
  return base ? `${base}_${hash.slice(0, 6)}` : hash.slice(0, 16);
}
