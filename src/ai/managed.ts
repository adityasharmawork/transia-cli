import type { AIProvider, TranslationRequest, TranslationResult } from "./provider.js";
import { apiRequest } from "../api/client.js";
import { loadConfig } from "../state/manager.js";
import { TransiaError, ExitCode } from "../utils/errors.js";

interface ManagedTranslateResponse {
  translations: Record<string, string>;
}

export class ManagedProvider implements AIProvider {
  name = "managed";
  private projectApiKey: string;

  constructor(projectRoot: string) {
    // Read the project's API key from config or environment
    const config = loadConfig(projectRoot);
    this.projectApiKey =
      process.env.TRANSIA_PROJECT_API_KEY ??
      (config as Record<string, unknown>).projectApiKey as string ??
      "";

    if (!this.projectApiKey) {
      throw new TransiaError(
        ExitCode.CONFIG_ERROR,
        "Missing project API key. Set TRANSIA_PROJECT_API_KEY or add projectApiKey to transia.config.json.",
      );
    }
  }

  destroy(): void {
    // Overwrite key in memory
    this.projectApiKey = "x".repeat(this.projectApiKey.length);
  }

  async translate(request: TranslationRequest): Promise<TranslationResult> {
    const response = await apiRequest<ManagedTranslateResponse>(
      "/api/translate",
      {
        method: "POST",
        body: {
          apiKey: this.projectApiKey,
          strings: request.strings,
          sourceLocale: request.sourceLocale,
          targetLocale: request.targetLocale,
        },
      },
    );

    const translations = new Map<string, string>();
    for (const [key, value] of Object.entries(response.translations)) {
      translations.set(key, value);
    }

    return {
      translations,
      provider: "managed",
      model: "managed",
      tokensUsed: 0,
    };
  }
}
