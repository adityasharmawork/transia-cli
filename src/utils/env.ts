import { config } from "dotenv";
import { resolve } from "node:path";
import { existsSync } from "node:fs";

/**
 * Load the project's `.env.local` then `.env` into `process.env` (best-effort).
 * Shared by BYOK key loading and managed mode (which previously never loaded
 * env files, so the key written to `.env.local` by `init` was invisible).
 * Returns the filenames that were loaded. `quiet` suppresses dotenv's stdout.
 */
export function loadProjectEnv(projectRoot: string): string[] {
  const loaded: string[] = [];
  for (const name of [".env.local", ".env"]) {
    const p = resolve(projectRoot, name);
    if (existsSync(p)) {
      config({ path: p, quiet: true });
      loaded.push(name);
    }
  }
  return loaded;
}
