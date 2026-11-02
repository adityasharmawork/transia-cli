import { describe, it, expect } from "vitest";
import { transformSource } from "../../src/commands/apply";
import { recordCandidates } from "../../src/parser/candidates";
import { isLikelyUserFacing } from "../../src/parser/classify";

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
});
