/**
 * Whether to run interactive prompts.
 *
 * `process.stdin.isTTY` is `true` on a real terminal but `undefined` when stdin
 * is piped or redirected (CI, `init < /dev/null`, `echo | init`). The old check
 * `isTTY !== false` treated `undefined` as interactive and crashed in CI; only
 * an explicit `true` is interactive. `--yes` always forces non-interactive.
 */
export function shouldPromptInteractively(
  acceptDefaults: boolean | undefined,
  stdinIsTTY: boolean | undefined,
): boolean {
  return acceptDefaults !== true && stdinIsTTY === true;
}
