import { describe, it, expect } from "vitest";
import { parse } from "@babel/parser";
import { transformSource } from "../../src/commands/apply";
import { recordCandidates } from "../../src/parser/candidates";
import { isLikelyUserFacing } from "../../src/parser/classify";

const parseOk = (s: string) => {
  try {
    parse(s, { sourceType: "module", plugins: ["jsx", "typescript"] });
    return true;
  } catch {
    return false;
  }
};

/** Simulate "already translated" by treating every user-facing site as known. */
const knownFrom = (src: string) =>
  new Set(
    recordCandidates(src, "T.tsx")
      .filter((c) => isLikelyUserFacing(c, []))
      .map((c) => c.hash),
  );

const run = (src: string) =>
  transformSource(src, "T.tsx", { knownHashes: knownFrom(src), format: "next-intl" }).output;

describe("apply transformSource — corruption regressions", () => {
  it("A1: a logic string in a comparison is left byte-for-byte intact", () => {
    const src = `function A(){ return <div>{status === "active" ? <p>Welcome back</p> : null}</div>; }`;
    const out = run(src);
    expect(out).toContain(`=== "active"`);
    expect(out).not.toContain("Welcome back");
    expect(out).toMatch(/\{t\("[^"]+"\)\}/);
  });

  it("A3: every component in a multi-component file gets a hook", () => {
    const src = `function A(){ return <p>Alpha text</p>; }\nfunction B(){ return <p>Beta text</p>; }`;
    const out = run(src);
    expect((out.match(/useTranslations\(\)/g) || []).length).toBe(2);
  });

  it("A4: an async server component uses getTranslations, not useTranslations", () => {
    const src = `async function Page(){ return <p>Hello page</p>; }`;
    const out = run(src);
    expect(out).toContain("getTranslations");
    expect(out).not.toContain("useTranslations");
  });

  it("A5: an existing `t` binding (map param) is never shadowed", () => {
    const src = `function A(){ const items = []; return <ul>{items.map((t) => <li>Row label</li>)}</ul>; }`;
    const out = run(src);
    expect(out).toContain("tTransia");
    expect(out).toMatch(/tTransia\("[^"]+"\)/);
  });

  it("A6: the hook import is inserted below \"use client\"", () => {
    const src = `"use client";\nimport React from "react";\nfunction A(){ return <p>Hi there now</p>; }`;
    const out = run(src);
    const useClient = out.indexOf('"use client"');
    const importPos = out.indexOf('from "next-intl"');
    expect(importPos).toBeGreaterThan(-1);
    expect(useClient).toBeLessThan(importPos);
  });

  it("A8: a second apply with no source change is a no-op (idempotent)", () => {
    const src = `function A(){ return <p>Once more here</p>; }`;
    const first = run(src);
    const second = transformSource(first, "T.tsx", {
      knownHashes: knownFrom(first),
      format: "next-intl",
    }).output;
    expect(second).toBe(first);
  });

  it("does not wrap a user-facing string that has no known translation yet", () => {
    const src = `function A(){ return <p>Untranslated string</p>; }`;
    const out = transformSource(src, "T.tsx", { knownHashes: new Set(), format: "next-intl" }).output;
    expect(out).toBe(src);
  });

  it("R1: single-line block body — hook is inserted INSIDE the body, before return", () => {
    // Trailing newline AFTER the closing brace is the trigger: the first \n
    // after `{` must not be mistaken for an in-body insertion point.
    const src = `export function Badge() { return <span>New here</span>; }\nconst other = 1;\n`;
    const out = run(src);
    expect(out).toContain("useTranslations");
    expect(out.indexOf("const t =")).toBeLessThan(out.indexOf("return"));
    expect(parseOk(out)).toBe(true);
  });

  it("R2: a string consumed by .includes() is not wrapped (control flow preserved)", () => {
    const src = `function A(){ return <div>{tabs.includes("Active") ? <span>Shown here</span> : null}</div>; }`;
    const out = run(src);
    expect(out).toContain(`includes("Active")`);
    expect(out).not.toContain("Shown here");
  });

  it("R3: an attribute already using an expression container gets single braces, not double", () => {
    const src = `function A(){ return <img title={"Logo pic here"} />; }`;
    const out = run(src);
    expect(out).toContain("title={t(");
    expect(out).not.toContain("title={{");
    expect(parseOk(out)).toBe(true);
  });

  it("R4: an implicit-return arrow component is wrapped into a block with a hook", () => {
    const src = `export const B = () => <button>Click me now</button>;`;
    const out = run(src);
    expect(out).toContain("useTranslations");
    expect(out).not.toContain("<button>Click me now</button>");
    expect(parseOk(out)).toBe(true);
  });

  it("R4b: a parenthesized implicit-return arrow is safely skipped (left unchanged)", () => {
    const src = `export const C = () => (<button>Done it now</button>);`;
    const res = transformSource(src, "T.tsx", { knownHashes: knownFrom(src), format: "next-intl" });
    expect(res.output).toBe(src);
    expect(res.skippedComponents.length).toBeGreaterThan(0);
  });
});
