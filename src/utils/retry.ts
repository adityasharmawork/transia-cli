import { TransiaError, ExitCode } from "./errors.js";
import { logger, redact } from "./logger.js";

export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

function isAuthError(status: number): boolean {
  return status === 401 || status === 403;
}

function isRateLimited(status: number): boolean {
  return status === 429;
}

function parseRetryAfter(headers: Headers): number | null {
  const retryAfter = headers.get("retry-after");
  if (!retryAfter) return null;

  const seconds = parseInt(retryAfter, 10);
  if (!isNaN(seconds)) return seconds * 1000;

  const date = Date.parse(retryAfter);
  if (!isNaN(date)) return Math.max(0, date - Date.now());

  return null;
}

function jitter(delayMs: number): number {
  return delayMs + Math.random() * delayMs * 0.3;
}

export async function withRetry<T>(
  fn: () => Promise<Response>,
  parseResponse: (res: Response) => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const { maxRetries = 3, baseDelayMs = 1000, maxDelayMs = 30000 } = options;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fn();

      if (response.ok) {
        return await parseResponse(response);
      }

      if (isAuthError(response.status)) {
        throw new TransiaError(
          ExitCode.AUTH_ERROR,
          `API authentication failed (HTTP ${response.status}). Check your API key.`,
        );
      }

      if (isRateLimited(response.status)) {
        const waitMs =
          parseRetryAfter(response.headers) ??
          jitter(Math.min(baseDelayMs * 2 ** attempt, maxDelayMs));
        logger.warn(
          `Rate limited. Waiting ${Math.round(waitMs / 1000)}s before retry...`,
        );
        await sleep(waitMs);
        continue;
      }

      // Server error or other non-OK status
      const body = await response.text().catch(() => "");
      lastError = new Error(
        `HTTP ${response.status}: ${redact(body.slice(0, 200))}`,
      );
    } catch (error) {
      if (error instanceof TransiaError) throw error;
      lastError = error as Error;
    }

    if (attempt < maxRetries) {
      const waitMs = jitter(
        Math.min(baseDelayMs * 2 ** attempt, maxDelayMs),
      );
      logger.debug(
        `Attempt ${attempt + 1}/${maxRetries + 1} failed. Retrying in ${Math.round(waitMs / 1000)}s...`,
      );
      await sleep(waitMs);
    }
  }

  throw new TransiaError(
    ExitCode.NETWORK_ERROR,
    `All ${maxRetries + 1} attempts failed: ${lastError?.message ?? "Unknown error"}`,
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
