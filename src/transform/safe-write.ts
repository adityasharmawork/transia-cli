import {
  existsSync,
  copyFileSync,
  mkdirSync,
  readdirSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import MagicString from "magic-string";
import { createPatch } from "diff";
import { parse } from "@babel/parser";
import writeFileAtomic from "write-file-atomic";

export interface Edit {
  start: number;
  end: number;
  replacement: string;
}

export interface Insertion {
  pos: number;
  text: string;
}

/**
 * Produce the transformed source by applying byte-range edits and insertions
 * surgically via magic-string. Untouched bytes are preserved exactly (no
 * reprint, so comments/whitespace/quotes survive). Overlapping edits are a bug
 * in the caller and throw here rather than splice corrupt output.
 */
export function buildEdit(
  source: string,
  edits: Edit[],
  insertions: Insertion[],
): string {
  const sorted = [...edits].sort((a, b) => a.start - b.start);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].start < sorted[i - 1].end) {
      throw new Error(
        `Overlapping edits: [${sorted[i - 1].start},${sorted[i - 1].end}) and [${sorted[i].start},${sorted[i].end})`,
      );
    }
  }

  const s = new MagicString(source);
  for (const e of edits) {
    s.overwrite(e.start, e.end, e.replacement);
  }
  for (const ins of insertions) {
    s.appendLeft(ins.pos, ins.text);
  }
  return s.toString();
}

/**
 * Write a transformed file only if it still parses, backing up the original
 * first so the write is reversible. A transform that would make the file
 * unparseable is never written — the file is left exactly as it was.
 */
export function safeWriteFile(
  absPath: string,
  newSource: string,
  opts: { backupPath: string },
): "written" | "skipped-unparseable" {
  try {
    parse(newSource, {
      sourceType: "module",
      plugins: ["jsx", "typescript", "decorators-legacy"],
      // strict: no errorRecovery — if the transform broke syntax, bail.
    });
  } catch {
    return "skipped-unparseable";
  }

  if (existsSync(absPath)) {
    mkdirSync(dirname(opts.backupPath), { recursive: true });
    copyFileSync(absPath, opts.backupPath);
  }

  writeFileAtomic.sync(absPath, newSource);
  return "written";
}

function walkFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(full));
    else out.push(full);
  }
  return out;
}

/**
 * Restore the most recent backup set, undoing the last `apply`.
 * Returns the number of files restored.
 */
export function undoLatest(projectRoot: string): number {
  const backupRoot = join(projectRoot, ".transia-backup");
  if (!existsSync(backupRoot)) return 0;

  const sets = readdirSync(backupRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort(); // ISO-like timestamps sort lexically → last is newest
  if (sets.length === 0) return 0;

  const latest = join(backupRoot, sets[sets.length - 1]);
  let count = 0;
  for (const file of walkFiles(latest)) {
    const rel = relative(latest, file);
    const dest = join(projectRoot, rel);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(file, dest);
    count++;
  }
  return count;
}

/** Unified diff for `--dry-run` output. */
export function unifiedDiff(filename: string, before: string, after: string): string {
  return createPatch(filename, before, after);
}
