import type {
  AIProvider,
  TranslationRequest,
  TranslationResult,
} from "./provider.js";
import { buildTranslationPrompt } from "./prompts.js";
import { withRetry } from "../utils/retry.js";
import { logger } from "../utils/logger.js";

const DEFAULT_MODEL = "gemini-2.0-flash";

function getApiUrl(model: string): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
}

export class GeminiProvider implements AIProvider {
  name = "gemini";
  private apiKey: string;
  private model: string;

  constructor(apiKey: string, model?: string) {
    this.apiKey = apiKey;
    this.model = model ?? DEFAULT_MODEL;
  }

  destroy(): void {
    this.apiKey = "";
  }

  async translate(request: TranslationRequest): Promise<TranslationResult> {
    const { system, user } = buildTranslationPrompt({
      sourceLocale: request.sourceLocale,
      targetLocale: request.targetLocale,
      strings: request.strings,
    });

    logger.debug(
      `Gemini: Translating ${request.strings.length} strings to ${request.targetLocale} using ${this.model}`,
    );

    const url = getApiUrl(this.model);

    const result = await withRetry(
      () =>
        fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": this.apiKey,
          },
          body: JSON.stringify({
            system_instruction: {
              parts: [{ text: system }],
            },
            contents: [
              {
                parts: [{ text: user }],
              },
            ],
            generationConfig: {
              responseMimeType: "application/json",
              temperature: 0.3,
            },
          }),
        }),
      async (response) => {
        const data = await response.json();
        return data as {
          candidates?: Array<{
            content?: { parts?: Array<{ text?: string }> };
          }>;
          usageMetadata?: {
            totalTokenCount?: number;
          };
        };
      },
    );

    const content = result.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!content) {
      throw new Error("Gemini returned empty response");
    }

    let parsed: Record<string, string>;
    try {
      parsed = JSON.parse(content) as Record<string, string>;
    } catch {
      throw new Error("Gemini returned invalid JSON in translation response");
    }

    const translations = new Map<string, string>();
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "string") {
        translations.set(key, value);
      }
    }

    return {
      translations,
      provider: this.name,
      model: this.model,
      tokensUsed: result.usageMetadata?.totalTokenCount ?? 0,
    };
  }
}
