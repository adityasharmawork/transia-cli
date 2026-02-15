import { TransiaError, ExitCode } from "../utils/errors.js";

export interface TranslationRequest {
  strings: Array<{ key: string; original: string; context?: string | null }>;
  sourceLocale: string;
  targetLocale: string;
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

export function createProvider(
  name: string,
  apiKey: string,
  model?: string,
): AIProvider {
  switch (name) {
    case "openai":
      return new OpenAIProvider(apiKey, model);
    case "anthropic":
      return new AnthropicProvider(apiKey, model);
    case "gemini":
      return new GeminiProvider(apiKey, model);
    case "grok":
      return new GrokProvider(apiKey, model);
    default:
      throw new TransiaError(
        ExitCode.CONFIG_ERROR,
        `Unknown provider: "${name}". Supported providers: openai, anthropic, gemini, grok`,
      );
  }
}
