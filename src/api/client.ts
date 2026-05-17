import { loadCredentials } from "../state/credentials.js";
import { TransiaError, ExitCode } from "../utils/errors.js";
import { logger } from "../utils/logger.js";

const DEFAULT_API_URL = "https://transia.dev";

let _httpWarningShown = false;

function getApiUrl(): string {
  // Env var takes priority (useful for local development against localhost)
  if (process.env.TRANSIA_API_URL) {
    const url = process.env.TRANSIA_API_URL;
    if (
      !_httpWarningShown &&
      !url.startsWith("https://") &&
      !url.includes("localhost") &&
      !url.includes("127.0.0.1")
    ) {
      _httpWarningShown = true;
      logger.warn(
        "Warning: TRANSIA_API_URL is using HTTP (not HTTPS). Your auth tokens may be sent insecurely over the network.",
      );
    }
    return url;
  }
  const credentials = loadCredentials();
  return credentials?.apiUrl ?? DEFAULT_API_URL;
}

function getAuthToken(): string {
  const credentials = loadCredentials();
  if (!credentials?.authToken) {
    throw new TransiaError(
      ExitCode.AUTH_ERROR,
      "Not logged in. Run `transia login` to authenticate.",
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
  const url = `${getApiUrl()}${path}`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (auth) {
    headers["Authorization"] = `Bearer ${getAuthToken()}`;
  }

  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

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
