import { z } from "zod";

// --- Config schema ---

export const ProviderConfigSchema = z.object({
  name: z.enum(["openai", "anthropic", "gemini", "grok"]),
  model: z.string().optional(),
  apiKeyEnv: z.string().optional(),
});

export const OutputConfigSchema = z.object({
  format: z.enum(["next-intl", "i18next"]),
  path: z.string(),
});

export const TransiaConfigSchema = z.object({
  version: z.number().int().min(1),
  sourceLocale: z.string().min(2),
  targetLocales: z
    .array(
      z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/, "Invalid locale format (use 'es' or 'en-US')"),
    )
    .min(1)
    .refine(
      (arr) => new Set(arr).size === arr.length,
      "Duplicate locales are not allowed",
    ),
  provider: ProviderConfigSchema,
  include: z.array(z.string()).min(1),
  exclude: z.array(z.string()).default([]),
  output: OutputConfigSchema,
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

export function createDefaultConfig(
  detectedDirs: string[],
): TransiaConfig {
  const include =
    detectedDirs.length > 0
      ? detectedDirs.map((dir) => `${dir}/**/*.{tsx,jsx}`)
      : ["src/**/*.{tsx,jsx}", "app/**/*.{tsx,jsx}"];

  return {
    version: 1,
    sourceLocale: "en",
    targetLocales: ["es"],
    provider: {
      name: "openai",
      model: "gpt-4o-mini",
    },
    include,
    exclude: [
      "**/*.test.*",
      "**/*.spec.*",
      "**/node_modules/**",
    ],
    output: {
      format: "next-intl",
      path: "locales",
    },
  };
}
