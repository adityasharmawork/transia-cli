// Attributes whose values should NOT be extracted
const SKIP_ATTRIBUTES = new Set([
  "className",
  "class",
  "style",
  "key",
  "id",
  "ref",
  "href",
  "src",
  "type",
  "htmlFor",
  "for",
  "name",
  "value",
  "action",
  "method",
  "target",
  "role",
  "tabIndex",
  "tabindex",
  "autoComplete",
  "autocomplete",
  "pattern",
  "accept",
  "maxLength",
  "maxlength",
  "minLength",
  "minlength",
  "width",
  "height",
]);

// Attributes whose values SHOULD be extracted
const TRANSLATABLE_ATTRIBUTES = new Set([
  "placeholder",
  "title",
  "alt",
  "aria-label",
  "aria-description",
  "aria-placeholder",
  "aria-roledescription",
  "label",
]);

// data-* attributes are never translatable
function isDataAttribute(name: string): boolean {
  return name.startsWith("data-");
}

export function isTranslatableAttribute(attrName: string): boolean {
  if (isDataAttribute(attrName)) return false;
  if (SKIP_ATTRIBUTES.has(attrName)) return false;
  return TRANSLATABLE_ATTRIBUTES.has(attrName);
}

// --- String content filters ---

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const URL_REGEX = /^(https?:\/\/|mailto:|tel:|ftp:\/\/)/i;
const FILE_PATH_REGEX = /^[./\\].*\.[a-zA-Z]{1,5}$/;
const ALL_CAPS_REGEX = /^[A-Z][A-Z0-9_]{2,}$/;
const CSS_CLASS_REGEX =
  /^(flex|grid|block|inline|hidden|relative|absolute|fixed|sticky|p-|m-|w-|h-|bg-|text-|border-|rounded|shadow|font-|items-|justify-|gap-|space-|overflow-|z-|opacity-|transition|animate|cursor-|select-|resize|appearance|outline|ring)/;
const HEX_COLOR_REGEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

export function isTranslatableString(value: string): boolean {
  const trimmed = value.trim();

  // Skip empty or whitespace-only
  if (trimmed.length === 0) return false;

  // Skip single characters
  if (trimmed.length === 1) return false;

  // Skip pure punctuation or numbers
  if (/^[\d\s.,;:!?'"()\-–—/\\|@#$%^&*+=<>{}\[\]`~]+$/.test(trimmed))
    return false;

  // Skip UUIDs
  if (UUID_REGEX.test(trimmed)) return false;

  // Skip URLs
  if (URL_REGEX.test(trimmed)) return false;

  // Skip file paths
  if (FILE_PATH_REGEX.test(trimmed)) return false;

  // Skip ALL_CAPS constants
  if (ALL_CAPS_REGEX.test(trimmed)) return false;

  // Skip CSS class names (Tailwind-style)
  if (CSS_CLASS_REGEX.test(trimmed)) return false;

  // Skip hex colors
  if (HEX_COLOR_REGEX.test(trimmed)) return false;

  // Skip import-like paths
  if (
    trimmed.startsWith("@") &&
    trimmed.includes("/") &&
    !trimmed.includes(" ")
  )
    return false;

  // Must contain at least one letter to be translatable
  if (!/[a-zA-Z]/.test(trimmed)) return false;

  return true;
}
