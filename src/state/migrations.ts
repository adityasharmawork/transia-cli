import { TransiaStateSchema, type TransiaState } from "./schema.js";
import { TransiaError, ExitCode } from "../utils/errors.js";
import { logger } from "../utils/logger.js";

type MigrationFn = (state: Record<string, unknown>) => Record<string, unknown>;

const CURRENT_VERSION = 2;

const MIGRATIONS: Record<number, MigrationFn> = {
  // v1 -> v2: the committed locale files become the source of truth; state is
  // demoted to a provenance/cache role. The on-disk `strings` shape is
  // unchanged (translations are retained as a non-authoritative cache), so
  // this migration only stamps the new version. The behavioral change — read
  // existing catalogs and merge rather than regenerate — lives in the write
  // path (output/reader + output/merge), not in a destructive schema rewrite.
  2: (state) => ({ ...state, version: 2 }),
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
