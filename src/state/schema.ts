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
  };

  if (providerPriority && providerPriority.length > 0) {
    config.providerPriority = providerPriority as TransiaConfig["providerPriority"];
  }

  return config;
}
