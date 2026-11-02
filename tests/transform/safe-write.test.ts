import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildEdit,
  safeWriteFile,
  undoLatest,
  unifiedDiff,
} from "../../src/transform/safe-write";

describe("buildEdit", () => {
  it("applies non-overlapping edits and insertions by byte range", () => {
    const src = `const x = "old";`;
    const start = src.indexOf('"old"');
    const out = buildEdit(
      src,
      [{ start, end: start + 5, replacement: `t("k")` }],
      [{ pos: 0, text: `"use client";\n` }],
    );
    expect(out).toBe(`"use client";\nconst x = t("k");`);
  });

  it("throws on overlapping edits instead of splicing garbage", () => {
    const src = `abcdefgh`;
    expect(() =>
      buildEdit(src, [
        { start: 0, end: 4, replacement: "X" },
        { start: 2, end: 6, replacement: "Y" },
      ], []),
    ).toThrow();
  });

  it("preserves CRLF and multibyte bytes outside the edited range", () => {
    const src = `const s = "🎉";\r\nconst t = "old";\r\n`;
    const start = src.indexOf('"old"');
    const out = buildEdit(src, [{ start, end: start + 5, replacement: `t("k")` }], []);
    expect(out).toContain("🎉");
    expect(out).toContain("\r\n");
    expect(out).toContain(`t("k")`);
    expect(out).not.toContain(`"old"`);
  });
});

describe("safeWriteFile + undoLatest", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "transia-safewrite-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("refuses to write an unparseable transform and leaves the file untouched", () => {
    const file = join(dir, "a.tsx");
    const original = `export const A = () => <p>Hi</p>;`;
    writeFileSync(file, original);
    const result = safeWriteFile(file, `export const A = () => <p>Hi</p` /* truncated */, {
      backupPath: join(dir, ".transia-backup", "x", "a.tsx"),
    });
    expect(result).toBe("skipped-unparseable");
    expect(readFileSync(file, "utf-8")).toBe(original);
  });

  it("writes a valid transform, backs up the original, and undoLatest restores it", () => {
    const file = join(dir, "a.tsx");
    const original = `export const A = () => <p>Hi</p>;`;
    writeFileSync(file, original);
    const result = safeWriteFile(file, `export const A = () => <p>Bye</p>;`, {
      backupPath: join(dir, ".transia-backup", "2026-11-02T00-00-00", "a.tsx"),
    });
    expect(result).toBe("written");
    expect(readFileSync(file, "utf-8")).toContain("Bye");

    const restored = undoLatest(dir);
    expect(restored).toBe(1);
    expect(readFileSync(file, "utf-8")).toBe(original);
  });
});

describe("unifiedDiff", () => {
  it("produces a patch showing the change", () => {
    const patch = unifiedDiff("a.tsx", `const x = "old";\n`, `const x = "new";\n`);
    expect(patch).toContain("-const x = \"old\";");
    expect(patch).toContain("+const x = \"new\";");
  });
});
