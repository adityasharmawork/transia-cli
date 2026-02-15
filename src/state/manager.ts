import { readFileSync, existsSync, copyFileSync } from "node:fs";
import { resolve } from "node:path";
import writeFileAtomic from "write-file-atomic";
import {
  TransiaStateSchema,
  TransiaConfigSchema,
  createEmptyState,
  type TransiaState,
  type TransiaConfig,
  type StringEntry,
} from "./schema.js";
import { migrateState } from "./migrations.js";
import { TransiaError, ExitCode } from "../utils/errors.js";
import { logger } from "../utils/logger.js";
import { hashString } from "../utils/crypto.js";

const STATE_FILE = ".transia-state.json";
const STATE_BACKUP = ".transia-state.json.bak";
const CONFIG_FILE = "transia.config.json";

// --- Config ---

export function loadConfig(projectRoot: string): TransiaConfig {
  const configPath = resolve(projectRoot, CONFIG_FILE);

  if (!existsSync(configPath)) {
    throw new TransiaError(
      ExitCode.CONFIG_ERROR,
      `Config file not found: ${configPath}\nRun "transia init" to create one.`,
    );
  }

  try {
    const raw = JSON.parse(readFileSync(configPath, "utf-8"));
    return TransiaConfigSchema.parse(raw);
  } catch (error) {
    if (error instanceof TransiaError) throw error;
    throw new TransiaError(
      ExitCode.CONFIG_ERROR,
      `Invalid config file: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function saveConfig(
  projectRoot: string,
  config: TransiaConfig,
): void {
  const configPath = resolve(projectRoot, CONFIG_FILE);
  writeFileAtomic.sync(
    configPath,
    JSON.stringify(config, null, 2) + "\n",
  );
}

// --- State ---

export function loadState(projectRoot: string): TransiaState {
  const statePath = resolve(projectRoot, STATE_FILE);
  const backupPath = resolve(projectRoot, STATE_BACKUP);

  if (!existsSync(statePath)) {
    return createEmptyState();
  }

  // Try primary state file
  try {
    const raw = JSON.parse(readFileSync(statePath, "utf-8"));
    return migrateState(raw);
  } catch (primaryError) {
    logger.warn(
      `State file corrupted: ${primaryError instanceof Error ? primaryError.message : String(primaryError)}`,
    );

    // Try backup
    if (existsSync(backupPath)) {
      try {
        const raw = JSON.parse(readFileSync(backupPath, "utf-8"));
        const state = migrateState(raw);
        logger.info("Recovered from backup state file.");
        return state;
      } catch {
        // Both corrupted
      }
    }

    throw new TransiaError(
      ExitCode.STATE_ERROR,
      'State file and backup are both corrupted. Run "transia reset --confirm" to start fresh.',
    );
  }
}

export function saveState(
  projectRoot: string,
  state: TransiaState,
): void {
  const statePath = resolve(projectRoot, STATE_FILE);
  const backupPath = resolve(projectRoot, STATE_BACKUP);

  // Back up current state before overwriting
  if (existsSync(statePath)) {
    copyFileSync(statePath, backupPath);
  }

  state.lastRun = new Date().toISOString();
  writeFileAtomic.sync(
    statePath,
    JSON.stringify(state, null, 2) + "\n",
  );
}

// --- Delta Detection ---

export interface ExtractedString {
  original: string;
  context: string | null;
  source: string; // file:line
}

export interface DeltaResult {
  newStrings: Map<string, ExtractedString>;
  unchangedHashes: Set<string>;
  removedHashes: Set<string>;
}

export function detectDelta(
  extracted: Map<string, ExtractedString>,
  state: TransiaState,
): DeltaResult {
  const newStrings = new Map<string, ExtractedString>();
  const unchangedHashes = new Set<string>();
  const removedHashes = new Set<string>();

  // Check extracted strings against state
  for (const [hash, extractedStr] of extracted) {
    const existing = state.strings[hash];
    if (!existing) {
      newStrings.set(hash, extractedStr);
    } else {
      unchangedHashes.add(hash);
      // Update sources in case the string moved
      existing.sources = [extractedStr.source];
      if (extractedStr.context !== null) {
        existing.context = extractedStr.context;
      }
    }
  }

  // Find removed strings
  for (const hash of Object.keys(state.strings)) {
    if (!extracted.has(hash)) {
      removedHashes.add(hash);
    }
  }

  // Modified strings are inherently handled: a content change produces a new hash
  // (new string) and the old hash becomes removed.
  return { newStrings, unchangedHashes, removedHashes };
}

export function mergeTranslations(
  state: TransiaState,
  hash: string,
  extracted: ExtractedString,
  locale: string,
  translatedValue: string,
  provider: string,
): void {
  if (!state.strings[hash]) {
    state.strings[hash] = {
      original: extracted.original,
      context: extracted.context,
      sources: [extracted.source],
      translations: {},
    };
  }

  state.strings[hash].translations[locale] = {
    value: translatedValue,
    translatedAt: new Date().toISOString(),
    provider,
  };
}
