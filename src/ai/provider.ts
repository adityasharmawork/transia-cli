import { TransiaError, ExitCode } from "../utils/errors.js";
import { getDetectedProvider } from "../utils/keys.js";
import { buildTranslationPrompt } from "./prompts.js";

export interface TranslationRequest {
  strings: Array<{ key: string; original: string; context?: string | null }>;
  sourceLocale: string;
  targetLocale: string;
  /** Preferred translations for specific source terms. */
  glossary?: Record<string, string>;
  /** Terms to keep verbatim in every locale. */
  doNotTranslate?: string[];
  /** Tone/register for the translation. */
  formality?: "formal" | "informal" | "neutral";
}

/** Build the system/user prompt for a request, forwarding all translation controls. */
export function buildPromptForRequest(request: TranslationRequest): {
  system: string;
  user: string;
} {
  return buildTranslationPrompt({
    sourceLocale: request.sourceLocale,
    targetLocale: request.targetLocale,
    strings: request.strings,
    glossary: request.glossary,
    doNotTranslate: request.doNotTranslate,
    formality: request.formality,
  });
}

export interface TranslationResult {
  translations: Map<string, string>; // key → translated string
  provider: string;
  model: string;
  tokensUsed: number;
}

export interface AIProvider {
  name: string;
  destroy(): void;
  translate(request: TranslationRequest): Promise<TranslationResult>;
}

// Provider registry
import { OpenAIProvider } from "./openai.js";
import { AnthropicProvider } from "./anthropic.js";
import { GeminiProvider } from "./gemini.js";
import { GrokProvider } from "./grok.js";
import { ManagedProvider } from "./managed.js";

export function createProvider(
  name: string,
  apiKey: string,
  model?: string,
  projectRoot?: string,
): AIProvider {
  // Resolve "auto" to the provider that was detected from env vars
  const resolvedName = name === "auto" ? (getDetectedProvider() ?? "openai") : name;

  switch (resolvedName) {
    case "openai":
      return new OpenAIProvider(apiKey, model);
    case "anthropic":
      return new AnthropicProvider(apiKey, model);
    case "gemini":
      return new GeminiProvider(apiKey, model);
    case "grok":
      return new GrokProvider(apiKey, model);
    case "managed":
      return new ManagedProvider(projectRoot ?? process.cwd());
    default:
      throw new TransiaError(
        ExitCode.CONFIG_ERROR,
        `Unknown provider: "${resolvedName}". Supported providers: openai, anthropic, gemini, grok, managed`,
      );
  }
}
