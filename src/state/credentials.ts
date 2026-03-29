import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { homedir, hostname, userInfo } from "node:os";
import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";

interface Credentials {
  authToken: string;
  email: string;
  apiUrl: string;
}

interface EncryptedPayload {
  v: 2;
  iv: string;
  data: string;
  tag: string;
}

const ALGORITHM = "aes-256-gcm";

/**
 * Derive an encryption key from stable machine-specific values.
 * This isn't HSM-grade protection, but it means the credentials file
 * is useless if copied to another machine or user account.
 */
function deriveKey(): Buffer {
  const material = [
    homedir(),
    hostname(),
    userInfo().username,
    "transia-cli-credential-key",
  ].join("|");
  return createHash("sha256").update(material).digest();
}

function encrypt(plaintext: string): EncryptedPayload {
  const key = deriveKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf-8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return {
    v: 2,
    iv: iv.toString("hex"),
    data: encrypted.toString("hex"),
    tag: tag.toString("hex"),
  };
}

function decrypt(payload: EncryptedPayload): string {
  const key = deriveKey();
  const iv = Buffer.from(payload.iv, "hex");
  const data = Buffer.from(payload.data, "hex");
  const tag = Buffer.from(payload.tag, "hex");
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString(
    "utf-8",
  );
}

function getCredentialsDir(): string {
  const dir = join(homedir(), ".transia");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  return dir;
}

function getCredentialsPath(): string {
  return join(getCredentialsDir(), "credentials.json");
}

export function loadCredentials(): Credentials | null {
  const path = getCredentialsPath();
  if (!existsSync(path)) return null;

  try {
    const content = readFileSync(path, "utf-8");
    const data = JSON.parse(content);

    // v2: encrypted format
    if (data.v === 2 && data.iv && data.data && data.tag) {
      const decrypted = decrypt(data as EncryptedPayload);
      const creds = JSON.parse(decrypted);
      if (creds.authToken && creds.email && creds.apiUrl) {
        return creds as Credentials;
      }
      return null;
    }

    // v1: legacy plaintext format — read and re-encrypt on next save
    if (data.authToken && data.email && data.apiUrl) {
      const creds = data as Credentials;
      // Silently upgrade to encrypted format
      saveCredentials(creds);
      return creds;
    }

    return null;
  } catch {
    return null;
  }
}

export function saveCredentials(credentials: Credentials): void {
  const path = getCredentialsPath();
  const payload = encrypt(JSON.stringify(credentials));
  writeFileSync(path, JSON.stringify(payload, null, 2), {
    mode: 0o600,
  });
}

export function deleteCredentials(): boolean {
  const path = getCredentialsPath();
  if (existsSync(path)) {
    // Overwrite with random data before unlinking to hinder recovery
    const size = readFileSync(path).length;
    writeFileSync(path, randomBytes(size), { mode: 0o600 });
    unlinkSync(path);
    return true;
  }
  return false;
}
