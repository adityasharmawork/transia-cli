import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

interface Credentials {
  authToken: string;
  email: string;
  apiUrl: string;
}

function getCredentialsPath(): string {
  const dir = join(homedir(), ".transia");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  return join(dir, "credentials.json");
}

export function loadCredentials(): Credentials | null {
  const path = getCredentialsPath();
  if (!existsSync(path)) return null;

  try {
    const content = readFileSync(path, "utf-8");
    const data = JSON.parse(content);
    if (data.authToken && data.email && data.apiUrl) {
      return data as Credentials;
    }
    return null;
  } catch {
    return null;
  }
}

export function saveCredentials(credentials: Credentials): void {
  const path = getCredentialsPath();
  writeFileSync(path, JSON.stringify(credentials, null, 2), {
    mode: 0o600, // owner read/write only
  });
}

export function deleteCredentials(): boolean {
  const path = getCredentialsPath();
  if (existsSync(path)) {
    unlinkSync(path);
    return true;
  }
  return false;
}
