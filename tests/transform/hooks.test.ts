import { describe, it, expect } from "vitest";
import { planHooks, planImports } from "../../src/transform/hooks";
import { recordCandidates } from "../../src/parser/candidates";

const compPaths = (src: string, sanitized: string[]) => {
  const cands = recordCandidates(src, "T.tsx");
  return sanitized.map((s) => cands.find((c) => c.sanitized === s)!.componentPath);
};

describe("planHooks", () => {
  it("inserts a hook into every component that has a site, not just the first", () => {
    const src = `function A(){ return <p>Hello there</p>; }\nfunction B(){ return <p>Goodbye now</p>; }`;
    const starts = compPaths(src, ["Hello there", "Goodbye now"]);
    const plan = planHooks(src, starts, "next-intl");
    expect(plan.insertions.length).toBe(2);
  });

  it("uses getTranslations (not useTranslations) for an async server component", () => {
    const src = `async function Page(){ return <p>Hello there</p>; }`;
    const starts = compPaths(src, ["Hello there"]);
    const plan = planHooks(src, starts, "next-intl");
    expect(plan.insertions[0].text).toContain("getTranslations");
    expect(plan.importSpecs.some((s) => s.module === "next-intl/server")).toBe(true);
  });

  it("does not re-insert a hook when the component already has one", () => {
    const src = `function A(){ const t = useTranslations(); return <p>Hello there</p>; }`;
    const starts = compPaths(src, ["Hello there"]);
    const plan = planHooks(src, starts, "next-intl");
    expect(plan.insertions.length).toBe(0);
    expect(plan.tNameByComponent.get(starts[0])).toBe("t");
  });

  it("uses an alternate identifier when the component subtree already binds t (no shadowing)", () => {
    const src = `function A(){ const items = []; return <ul>{items.map((t) => <li>Hello there</li>)}</ul>; }`;
    const starts = compPaths(src, ["Hello there"]);
    const plan = planHooks(src, starts, "next-intl");
    expect(plan.tNameByComponent.get(starts[0])).not.toBe("t");
    expect(plan.insertions[0].text).not.toMatch(/\bconst t\b/);
  });
});

describe("planImports", () => {
  it("inserts the import below a \"use client\" directive", () => {
    const src = `"use client";\nimport x from "y";\nfunction A(){ return <p>Hi there</p>; }`;
    const ins = planImports(src, [{ module: "next-intl", name: "useTranslations" }]);
    expect(ins.length).toBe(1);
    expect(src.slice(0, ins[0].pos)).toContain('"use client"');
  });
});
