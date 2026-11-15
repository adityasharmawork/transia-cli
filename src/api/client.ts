import { loadCredentials } from "../state/credentials.js";
import { TransiaError, ExitCode } from "../utils/errors.js";
import { logger } from "../utils/logger.js";
import { DEFAULT_TIMEOUT_MS } from "../utils/retry.js";

const DEFAULT_API_URL = "https://transia.dev";

let _httpWarningShown = false;

function isLocalhost(raw: string): boolean {
  // Exact hostname match only. A substring check (`includes("localhost")`) is
  // bypassable — `https://localhost.evil.com` and `https://evil.com/localhost`
  // both contain "localhost" and would leak the bearer token to the attacker.
  try {
    const u = new URL(raw);
    if (u.username || u.password) return false;
    const host = u.hostname.toLowerCase().replace(/\.$/, "");
    return (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "[::1]" ||
      host === "::1"
    );
  } catch {
    return false;
  }
}

function getApiUrl(authenticated: boolean): string {
  const env = process.env.TRANSIA_API_URL;
  // An env override is honored for unauthenticated calls (dev flexibility), but
  // for AUTHENTICATED calls only when it targets localhost — otherwise a project
  // .env could redirect the bearer token to an attacker-controlled host.
  if (env && (!authenticated || isLocalhost(env))) {
    if (
      !_httpWarningShown &&
      !env.startsWith("https://") &&
      !isLocalhost(env)
    ) {
      _httpWarningShown = true;
      logger.warn(
        "Warning: TRANSIA_API_URL is using HTTP (not HTTPS). Your auth tokens may be sent insecurely over the network.",
      );
    }
    return env;
  }
  const credentials = loadCredentials();
  return credentials?.apiUrl ?? DEFAULT_API_URL;
}

function getAuthToken(): string {
  // CI / non-interactive: a token supplied via the real environment takes
  // priority over the stored credential.
  const envToken = process.env.TRANSIA_TOKEN;
  if (envToken) return envToken;

  const credentials = loadCredentials();
  if (!credentials?.authToken) {
    throw new TransiaError(
      ExitCode.AUTH_ERROR,
      "Not logged in. Run `transia login` (or set TRANSIA_TOKEN for CI) to authenticate.",
    );
  }
  return credentials.authToken;
}

export async function apiRequest<T>(
  path: string,
  options: {
    method?: string;
    body?: Record<string, unknown>;
    auth?: boolean;
  } = {},
): Promise<T> {
  const { method = "GET", body, auth = true } = options;
  const url = `${getApiUrl(auth)}${path}`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (auth) {
    headers["Authorization"] = `Bearer ${getAuthToken()}`;
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      // Never follow a redirect on an authenticated call: a 3xx to another host
      // (e.g. apex→www) would strip or forward the bearer token. Fail loudly.
      redirect: "error",
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });
  } catch (err) {
    const name = (err as Error)?.name;
    if (name === "TimeoutError") {
      throw new TransiaError(
        ExitCode.NETWORK_ERROR,
        `API request to ${path} timed out after ${Math.round(DEFAULT_TIMEOUT_MS / 1000)}s.`,
      );
    }
    throw new TransiaError(
      ExitCode.NETWORK_ERROR,
      `Could not reach the API at ${path} (redirect refused or network error). ` +
        `If the server redirects (e.g. apex→www), point TRANSIA at the canonical host.`,
    );
  }

  if (!res.ok) {
    if (res.status === 401) {
      throw new TransiaError(
        ExitCode.AUTH_ERROR,
        "Authentication failed. Run `transia login` to re-authenticate.",
      );
    }
    const error = await res.json().catch(() => ({ error: "Unknown error" }));
    throw new TransiaError(
      ExitCode.NETWORK_ERROR,
      `API error (${res.status}): ${error.error || res.statusText}`,
    );
  }

  return res.json();
}

export async function initCliSession(): Promise<{ sessionToken: string }> {
  return apiRequest("/api/auth/cli/init", {
    method: "POST",
    auth: false,
  });
}

export async function pollCliSession(
  sessionToken: string,
): Promise<{ status: string; authToken?: string; email?: string }> {
  // Send session token in POST body instead of query params to avoid
  // leaking tokens in server access logs, CDN logs, and browser history.
  return apiRequest("/api/auth/cli/status", {
    method: "POST",
    body: { session: sessionToken },
    auth: false,
  });
}

export async function verifyAuth(): Promise<{ valid: boolean; email: string }> {
  return apiRequest("/api/auth/verify", { method: "POST" });
}

export async function createProject(data: {
  name: string;
  sourceLocale: string;
  targetLocales: string[];
  outputFormat: string;
}): Promise<{
  project: {
    _id: string;
    name: string;
    publicKey: string;
    apiKey: string;
  };
}> {
  return apiRequest("/api/cli/projects", {
    method: "POST",
    body: data,
  });
}

export async function listProjects(): Promise<{
  projects: Array<{
    _id: string;
    name: string;
    publicKey: string;
    apiKeyPrefix: string;
  }>;
}> {
  return apiRequest("/api/cli/projects");
}

export async function logUsage(data: {
  projectApiKey?: string;
  stringsTranslated: number;
  tokensUsed: number;
  provider: string;
  locale: string;
}): Promise<void> {
  try {
    await apiRequest("/api/usage/log", {
      method: "POST",
      body: data,
    });
  } catch {
    // Usage logging is best-effort; don't block the user
  }
}
