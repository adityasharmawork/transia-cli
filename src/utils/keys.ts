import { config } from "dotenv";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { inspect } from "node:util";
import { TransiaError, ExitCode } from "./errors.js";
import { logger } from "./logger.js";

const DEFAULT_ENV_VARS: Record<string, string> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  gemini: "GEMINI_API_KEY",
  grok: "XAI_API_KEY",
};

class SecureKey {
  private _value: string;

  constructor(value: string) {
    this._value = value;
  }

  get value(): string {
    return this._value;
  }

  clear(): void {
    this._value = "x".repeat(this._value.length);
  }

  toJSON(): string {
    return "[REDACTED]";
  }

  toString(): string {
    return "[REDACTED]";
  }

  [inspect.custom](): string {
    return "[REDACTED]";
  }
}

let _activeKey: SecureKey | null = null;

/**
 * Load the API key for a specific provider from the user's .env files.
 *
 * @param projectRoot - Project root directory
 * @param provider - Provider name (openai, anthropic, gemini, grok)
 * @param customEnvVar - Optional custom env var name from transia.config.json
 */
export function loadApiKey(
  projectRoot: string,
  provider: string,
  customEnvVar?: string,
): string {
  // Load .env files into process.env
  const envLocalPath = resolve(projectRoot, ".env.local");
  const envPath = resolve(projectRoot, ".env");

  if (existsSync(envLocalPath)) {
    config({ path: envLocalPath });
  }
  if (existsSync(envPath)) {
    config({ path: envPath });
  }

  // Determine which env var to read
  const envVar = customEnvVar ?? DEFAULT_ENV_VARS[provider];
  if (!envVar) {
    throw new TransiaError(
      ExitCode.CONFIG_ERROR,
      `Unknown provider "${provider}". Supported: openai, anthropic, gemini, grok. Or set "apiKeyEnv" in your config.`,
    );
  }

  const key = process.env[envVar];

  // Clean up from process.env immediately
  delete process.env[envVar];

  if (!key) {
    throw new TransiaError(
      ExitCode.AUTH_ERROR,
      `Missing API key. Add ${envVar} to your .env or .env.local file.\n` +
        (customEnvVar
          ? `  (Using custom variable name from transia.config.json)`
          : `  You can also set a custom variable name with "apiKeyEnv" in transia.config.json`),
    );
  }

  _activeKey = new SecureKey(key);
  return _activeKey.value;
}

export function clearKeys(): void {
  if (_activeKey) {
    _activeKey.clear();
    _activeKey = null;
  }
  logger.debug("API keys cleared from memory");
}
