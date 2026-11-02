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

function keyFromMaterial(parts: string[]): Buffer {
  return createHash("sha256").update(parts.join("|")).digest();
}

/**
 * Derive an encryption key from stable machine/user values. This isn't
 * HSM-grade protection, but it means the credentials file is useless if copied
 * to another machine or user account. NOTE: `hostname()` is deliberately NOT
 * included — it changes with DHCP/VPN/renames and used to silently invalidate
 * the key, logging the user out at random.
 */
export function deriveKey(): Buffer {
  return keyFromMaterial([homedir(), userInfo().username, "transia-cli-credential-key"]);
}

/**
 * The pre-migration key that mixed in `hostname()`. Used only to read files
 * written by older versions, so an existing login survives the upgrade.
 */
export function legacyDeriveKey(): Buffer {
  return keyFromMaterial([
    homedir(),
    hostname(),
    userInfo().username,
    "transia-cli-credential-key",
  ]);
}

export function encrypt(plaintext: string, key: Buffer): EncryptedPayload {
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

function decrypt(payload: EncryptedPayload, key: Buffer): string {
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
      let decrypted: string;
      let migrated = false;
      try {
        decrypted = decrypt(data as EncryptedPayload, deriveKey());
      } catch {
        // Fall back to the legacy hostname-bound key, then migrate on success.
        try {
          decrypted = decrypt(data as EncryptedPayload, legacyDeriveKey());
          migrated = true;
        } catch {
          return null;
        }
      }
      const creds = JSON.parse(decrypted);
      if (creds.authToken && creds.email && creds.apiUrl) {
        if (migrated) saveCredentials(creds as Credentials); // re-encrypt with the new key
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
  const payload = encrypt(JSON.stringify(credentials), deriveKey());
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
