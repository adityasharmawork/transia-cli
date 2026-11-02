/**
 * Attribute deny-list for the max-coverage policy: every JSX attribute value is
 * translatable EXCEPT structural/technical ones listed here (and data-*, on*,
 * and non-copy aria-*). Users can extend the list via
 * transia.config.json → apply.excludeAttributes.
 */
export const DEFAULT_EXCLUDED_ATTRIBUTES = new Set<string>([
  "className", "class", "id", "href", "src", "srcSet", "type", "key", "ref",
  "role", "name", "htmlFor", "for", "style", "rel", "target", "method",
  "action", "encType", "accept", "autoComplete", "autocomplete", "slot",
  "itemProp", "itemType", "datatype", "property", "content", "httpEquiv",
  "charSet", "dir", "value", "tabIndex", "tabindex", "pattern", "width",
  "height", "maxLength", "maxlength", "minLength", "minlength",
]);

/** aria-* attributes that DO carry user-facing copy (everything else aria- is excluded). */
const ARIA_ALLOWED = new Set<string>([
  "aria-label",
  "aria-description",
  "aria-placeholder",
  "aria-valuetext",
  "aria-roledescription",
]);

/**
 * True if an attribute's value should NOT be translated.
 * Deny-list semantics: excluded only if it is structural/technical.
 */
export function isExcludedAttribute(name: string, extra: string[] = []): boolean {
  if (!name) return false;
  if (name.startsWith("data-")) return true;
  if (/^on[A-Z]/.test(name)) return true; // event handlers: onClick, onChange, ...
  if (name.startsWith("aria-")) return !ARIA_ALLOWED.has(name);
  if (DEFAULT_EXCLUDED_ATTRIBUTES.has(name)) return true;
  if (extra.includes(name)) return true;
  return false;
}
