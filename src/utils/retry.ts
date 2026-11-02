import { TransiaError, ExitCode } from "./errors.js";
import { logger, redact } from "./logger.js";

/**
 * Default per-request timeout. Generous (2 min) because a translate batch can
 * legitimately take a while — a 50-string request can emit thousands of tokens.
 * The timeout exists to kill a genuinely hung connection, not a slow-but-fine
 * response, so erring large avoids aborting (and re-spending on) healthy requests.
 */
export const DEFAULT_TIMEOUT_MS = 120000;

export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Per-attempt request timeout; a hung request is aborted after this. */
  timeoutMs?: number;
}

function isAuthError(status: number): boolean {
  return status === 401 || status === 403;
}

function isRateLimited(status: number): boolean {
  return status === 429;
}

/** 4xx other than 429 — a client error that retrying cannot fix. */
function isNonRetryableClientError(status: number): boolean {
  return status >= 400 && status < 500 && status !== 429;
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
  fn: (signal: AbortSignal) => Promise<Response>,
  parseResponse: (res: Response) => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const {
    maxRetries = 3,
    baseDelayMs = 1000,
    maxDelayMs = 30000,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = options;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fn(controller.signal);

      if (response.ok) {
        return await parseResponse(response);
      }

      if (isAuthError(response.status)) {
        throw new TransiaError(
          ExitCode.AUTH_ERROR,
          `API authentication failed (HTTP ${response.status}). Check your API key.`,
        );
      }

      // Other 4xx are the caller's fault (bad request, not found, unprocessable);
      // retrying wastes time and tokens. Fail fast.
      if (isNonRetryableClientError(response.status)) {
        const body = await response.text().catch(() => "");
        throw new TransiaError(
          ExitCode.NETWORK_ERROR,
          `API request failed (HTTP ${response.status}) and will not be retried: ${redact(body.slice(0, 200))}`,
        );
      }

      if (isRateLimited(response.status)) {
        const backoff = jitter(Math.min(baseDelayMs * 2 ** attempt, maxDelayMs));
        // Honour Retry-After, but never wait longer than maxDelayMs — a hostile
        // or buggy header must not stall the CLI for hours.
        const waitMs = Math.min(
          parseRetryAfter(response.headers) ?? backoff,
          maxDelayMs,
        );
        logger.warn(
          `Rate limited. Waiting ${Math.round(waitMs / 1000)}s before retry...`,
        );
        await sleep(waitMs);
        continue;
      }

      // Server error (5xx) or other non-OK status — retryable.
      const body = await response.text().catch(() => "");
      lastError = new Error(
        `HTTP ${response.status}: ${redact(body.slice(0, 200))}`,
      );
    } catch (error) {
      if (error instanceof TransiaError) throw error;
      lastError = error as Error;
    } finally {
      clearTimeout(timer);
    }

    if (attempt < maxRetries) {
      const waitMs = jitter(Math.min(baseDelayMs * 2 ** attempt, maxDelayMs));
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
