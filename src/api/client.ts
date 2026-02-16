import { loadCredentials } from "../state/credentials.js";
import { TransiaError, ExitCode } from "../utils/errors.js";

const DEFAULT_API_URL = "https://transia.dev";

function getApiUrl(): string {
  const credentials = loadCredentials();
  return credentials?.apiUrl ?? process.env.TRANSIA_API_URL ?? DEFAULT_API_URL;
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
  return apiRequest(`/api/auth/cli/status?session=${sessionToken}`, {
    auth: false,
  });
}

export async function verifyAuth(): Promise<{ valid: boolean; email: string }> {
  return apiRequest("/api/auth/verify", { method: "POST" });
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
