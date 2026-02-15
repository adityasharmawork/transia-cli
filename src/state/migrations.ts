import { TransiaStateSchema, type TransiaState } from "./schema.js";
import { TransiaError, ExitCode } from "../utils/errors.js";
import { logger } from "../utils/logger.js";

type MigrationFn = (state: Record<string, unknown>) => Record<string, unknown>;

const CURRENT_VERSION = 1;

const MIGRATIONS: Record<number, MigrationFn> = {
  // Future migrations go here:
  // 2: (state) => { /* v1 -> v2 migration */ state.version = 2; return state; },
};

export function migrateState(raw: Record<string, unknown>): TransiaState {
  const startVersion = (raw.version as number) ?? 1;

  if (startVersion > CURRENT_VERSION) {
    throw new TransiaError(
      ExitCode.STATE_ERROR,
      `State file version ${startVersion} is newer than this CLI supports (v${CURRENT_VERSION}). Please upgrade transia.`,
    );
  }

  let state = raw;
  for (let v = startVersion + 1; v <= CURRENT_VERSION; v++) {
    const migrate = MIGRATIONS[v];
    if (migrate) {
      logger.info(`Migrating state file from v${v - 1} to v${v}...`);
      state = migrate(state);
    }
  }

  return TransiaStateSchema.parse(state);
}
