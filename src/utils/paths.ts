import { resolve, relative, isAbsolute } from "node:path";

/**
 * True iff `target` resolves to a location strictly INSIDE `projectRoot`
 * (never the project root itself, never an ancestor or sibling).
 *
 * Used to contain destructive/output operations — e.g. `reset --output` and
 * locale-file writes — so a misconfigured `output.path` like "." or ".." can
 * never delete or escape the project. Pure: no internal imports.
 */
export function isInsideProject(projectRoot: string, target: string): boolean {
  const root = resolve(projectRoot);
  const full = resolve(projectRoot, target);
  if (full === root) return false;
  const rel = relative(root, full);
  return rel.length > 0 && !rel.startsWith("..") && !isAbsolute(rel);
}
