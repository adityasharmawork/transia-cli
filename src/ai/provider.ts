import { TransiaError, ExitCode } from "../utils/errors.js";
import { getDetectedProvider } from "../utils/keys.js";

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
