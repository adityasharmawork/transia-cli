import { z } from "zod";
import { isValidLocale } from "../utils/locale.js";

// --- Config schema ---

export const ProviderConfigSchema = z.object({
  name: z.enum(["openai", "anthropic", "gemini", "grok", "managed", "auto"]),
  model: z.string().optional(),
  apiKeyEnv: z.string().optional(),
});

export const OutputConfigSchema = z.object({
  format: z.enum(["next-intl", "i18next"]),
  path: z.string(),
});

export const TransiaConfigSchema = z.object({
  version: z.number().int().min(1),
  sourceLocale: z
    .string()
    .refine(isValidLocale, "Invalid source locale (use a BCP-47 tag like 'en', 'en-US', 'zh-Hans')"),
  targetLocales: z
    .array(
      z
        .string()
        .refine(isValidLocale, "Invalid locale tag (use a BCP-47 tag like 'es', 'en-US', 'zh-Hans', 'es-419')"),
    )
    .min(1)
    .refine(
      (arr) => new Set(arr).size === arr.length,
      "Duplicate locales are not allowed",
    ),
  provider: ProviderConfigSchema,
  providerPriority: z
    .array(z.enum(["gemini", "grok", "openai", "anthropic"]))
    .optional(),
  include: z.array(z.string()).min(1),
  exclude: z.array(z.string()).default([]),
  output: OutputConfigSchema,
  projectId: z.string().optional(),
  publicKey: z.string().optional(),
  apply: z
    .object({
      // Extra attribute names to exclude from translation, on top of the
      // built-in deny-list. Empowers a cautious team under the max-coverage policy.
      excludeAttributes: z.array(z.string()).default([]),
    })
    .optional(),
  translation: z
    .object({
      // Preferred translations for specific source terms, applied consistently
      // (brand/product vocabulary). Keyed by TARGET LOCALE, then source text ->
      // required translation, so a term's translation differs per language:
      //   { "es": { "Sign up": "Regístrate" }, "fr": { "Sign up": "S'inscrire" } }
      glossary: z.record(z.string(), z.record(z.string(), z.string())).optional(),
      // Terms to keep verbatim in every locale (brand names, code tokens).
      doNotTranslate: z.array(z.string()).optional(),
      // Tone/register the model should use.
      formality: z.enum(["formal", "informal", "neutral"]).optional(),
    })
    .optional(),
  // Next.js i18n routing mode. "cookie" (default): locale from a cookie, no URL
  // change. "prefix": SEO URL-prefix mode (/es/...) via next-intl middleware and
  // an app/[locale] segment. Defaults to "cookie" so existing configs are
  // unaffected.
  routing: z.enum(["cookie", "prefix"]).default("cookie"),
  // Absolute site origin (e.g. "https://example.com"), used to build absolute
  // hreflang alternate links and sitemap URLs in SEO prefix mode.
  siteUrl: z.string().url().optional(),
});

export type TransiaConfig = z.infer<typeof TransiaConfigSchema>;

// --- State schema ---

export const TranslationEntrySchema = z.object({
  value: z.string(),
  translatedAt: z.string(),
  provider: z.string(),
});

export const StringEntrySchema = z.object({
  original: z.string(),
  context: z.string().nullable().default(null),
  sources: z.array(z.string()),
  translations: z.record(
    z.string(),
    TranslationEntrySchema.nullable(),
  ),
});

export const TransiaStateSchema = z.object({
  version: z.number().int().min(1),
  lastRun: z.string(),
  strings: z.record(z.string(), StringEntrySchema),
});

export type TranslationEntry = z.infer<typeof TranslationEntrySchema>;
export type StringEntry = z.infer<typeof StringEntrySchema>;
export type TransiaState = z.infer<typeof TransiaStateSchema>;

// --- Default state ---

export function createEmptyState(): TransiaState {
  return {
    version: 1,
    lastRun: new Date().toISOString(),
    strings: {},
  };
}

// --- Default config ---

export interface CreateConfigOptions {
  detectedDirs: string[];
  provider?: string;
  providerPriority?: string[];
  targetLocales?: string[];
  outputFormat?: "next-intl" | "i18next";
}

export function createDefaultConfig(
  options: CreateConfigOptions,
): TransiaConfig {
  const { detectedDirs, provider, providerPriority, targetLocales, outputFormat } = options;

  const include =
    detectedDirs.length > 0
      ? detectedDirs.map((dir) => `${dir}/**/*.{tsx,jsx}`)
      : ["src/**/*.{tsx,jsx}", "app/**/*.{tsx,jsx}"];

  const config: TransiaConfig = {
    version: 1,
    sourceLocale: "en",
    targetLocales: targetLocales ?? ["es"],
    provider: {
      name: (provider ?? "auto") as TransiaConfig["provider"]["name"],
    },
    include,
    exclude: [
      "**/*.test.*",
      "**/*.spec.*",
      "**/node_modules/**",
    ],
    output: {
      format: outputFormat ?? "next-intl",
      path: "locales",
    },
    routing: "cookie",
  };

  if (providerPriority && providerPriority.length > 0) {
    config.providerPriority = providerPriority as TransiaConfig["providerPriority"];
  }

  return config;
}
