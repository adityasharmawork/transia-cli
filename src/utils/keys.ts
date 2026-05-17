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

// Priority order for auto-detection: cheapest/fastest first
const AUTO_DETECT_ORDER = ["gemini", "grok", "openai", "anthropic"] as const;

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
let _detectedProvider: string | null = null;

/**
 * Returns the provider name that was auto-detected from env vars.
 * Only set when provider is "auto".
 */
export function getDetectedProvider(): string | null {
  return _detectedProvider;
}

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
  priority?: string[],
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

  // Handle "auto" provider: detect which API key is available
  if (provider === "auto" && !customEnvVar) {
    const detectOrder = priority && priority.length > 0
      ? priority
      : AUTO_DETECT_ORDER;
    for (const candidate of detectOrder) {
      const envVar = DEFAULT_ENV_VARS[candidate];
      const key = process.env[envVar];
      if (key) {
        delete process.env[envVar];
        _activeKey = new SecureKey(key);
        _detectedProvider = candidate;
        logger.info(`Auto-detected provider: ${candidate} (from ${envVar})`);
        return _activeKey.value;
      }
    }
    throw new TransiaError(
      ExitCode.AUTH_ERROR,
      `No API key found. Add one of these to your .env or .env.local file:\n\n` +
        `  GEMINI_API_KEY=your-key       (Google Gemini)\n` +
        `  XAI_API_KEY=your-key          (Grok)\n` +
        `  OPENAI_API_KEY=your-key       (OpenAI)\n` +
        `  ANTHROPIC_API_KEY=your-key    (Anthropic Claude)\n\n` +
        `  Transia automatically detects whichever key you provide.`,
    );
  }

  // Determine which env var to read
  const envVar = customEnvVar ?? DEFAULT_ENV_VARS[provider];
  if (!envVar) {
    throw new TransiaError(
      ExitCode.CONFIG_ERROR,
      `Unknown provider "${provider}". Supported: openai, anthropic, gemini, grok, auto. Or set "apiKeyEnv" in your config.`,
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
  _detectedProvider = null;
  logger.debug("API keys cleared from memory");
}
