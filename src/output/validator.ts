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

  // Placeholder preservation
  const originalPlaceholders: string[] = original.match(/\{[^}]+\}/g) ?? [];
  const translatedPlaceholders: string[] = translated.match(/\{[^}]+\}/g) ?? [];
  const missing = originalPlaceholders.filter(
    (p) => !translatedPlaceholders.includes(p),
  );
  if (missing.length > 0) {
    warnings.push(
      `"${key}": Missing placeholders in translation: ${missing.join(", ")}`,
    );
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
