import type {
  AIProvider,
  TranslationRequest,
  TranslationResult,
} from "./provider.js";
import { buildTranslationPrompt } from "./prompts.js";
import { withRetry } from "../utils/retry.js";
import { logger } from "../utils/logger.js";

const DEFAULT_MODEL = "claude-sonnet-4-5-20250929";
const API_URL = "https://api.anthropic.com/v1/messages";

export class AnthropicProvider implements AIProvider {
  name = "anthropic";
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
      `Anthropic: Translating ${request.strings.length} strings to ${request.targetLocale} using ${this.model}`,
    );

    const result = await withRetry(
      () =>
        fetch(API_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": this.apiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: this.model,
            max_tokens: 4096,
            system,
            messages: [{ role: "user", content: user }],
          }),
        }),
      async (response) => {
        const data = await response.json();
        return data as {
          content: Array<{ type: string; text?: string }>;
          usage?: { input_tokens: number; output_tokens: number };
        };
      },
    );

    const textBlock = result.content?.find((b) => b.type === "text");
    const content = textBlock?.text;
    if (!content) {
      throw new Error("Anthropic returned empty response");
    }

    // Extract JSON from the response (Anthropic may wrap it in markdown)
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("Could not extract JSON from Anthropic response");
    }

    let parsed: Record<string, string>;
    try {
      parsed = JSON.parse(jsonMatch[0]) as Record<string, string>;
    } catch {
      throw new Error("Anthropic returned invalid JSON in translation response");
    }
    const translations = new Map<string, string>();
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "string") {
        translations.set(key, value);
      }
    }

    const tokensUsed =
      (result.usage?.input_tokens ?? 0) +
      (result.usage?.output_tokens ?? 0);

    return {
      translations,
      provider: this.name,
      model: this.model,
      tokensUsed,
    };
  }
}
