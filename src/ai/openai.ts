import type {
  AIProvider,
  TranslationRequest,
  TranslationResult,
} from "./provider.js";
import { buildTranslationPrompt } from "./prompts.js";
import { withRetry } from "../utils/retry.js";
import { logger } from "../utils/logger.js";

const DEFAULT_MODEL = "gpt-4o-mini";
const API_URL = "https://api.openai.com/v1/chat/completions";

export class OpenAIProvider implements AIProvider {
  name = "openai";
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
      `OpenAI: Translating ${request.strings.length} strings to ${request.targetLocale} using ${this.model}`,
    );

    const result = await withRetry(
      () =>
        fetch(API_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify({
            model: this.model,
            messages: [
              { role: "system", content: system },
              { role: "user", content: user },
            ],
            response_format: { type: "json_object" },
            temperature: 0.3,
          }),
        }),
      async (response) => {
        const data = await response.json();
        return data as {
          choices: Array<{ message: { content: string } }>;
          usage?: { total_tokens: number };
        };
      },
    );

    const content = result.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("OpenAI returned empty response");
    }

    let parsed: Record<string, string>;
    try {
      parsed = JSON.parse(content) as Record<string, string>;
    } catch {
      throw new Error("OpenAI returned invalid JSON in translation response");
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
      tokensUsed: result.usage?.total_tokens ?? 0,
    };
  }
}
