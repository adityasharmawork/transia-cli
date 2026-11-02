import { describe, it, expect } from "vitest";
import { recordCandidates, type Candidate } from "../../src/parser/candidates";

const find = (cands: Candidate[], sanitized: string) =>
  cands.find((c) => c.sanitized === sanitized);

describe("recordCandidates", () => {
  it("records JSX text with byte offsets that slice to the trimmed text", () => {
    const src = `function A() { return <p>  Hello world  </p>; }`;
    const cands = recordCandidates(src, "A.tsx");
    const c = find(cands, "Hello world");
    expect(c).toBeDefined();
    expect(c!.role).toBe("jsx-text");
    expect(src.slice(c!.start, c!.end)).toBe("Hello world");
    expect(c!.componentPath).not.toBe("");
  });

  it("records a JSX attribute candidate carrying its attribute name", () => {
    const src = `function A() { return <img alt="Company logo" />; }`;
    const cands = recordCandidates(src, "A.tsx");
    const c = find(cands, "Company logo");
    expect(c).toBeDefined();
    expect(c!.role).toBe("jsx-attr");
    expect(c!.attribute).toBe("alt");
  });

  it("flags insideComparison for a literal compared with === but not for sibling copy", () => {
    const src = `function A(){ return <div>{status === "active" ? "On" : "Off"}</div>; }`;
    const cands = recordCandidates(src, "A.tsx");
    expect(find(cands, "active")?.insideComparison).toBe(true);
    expect(find(cands, "On")?.insideComparison).toBe(false);
  });

  it("records the enclosing call name for a string inside cn()", () => {
    const src = `function A(){ return <div>{cn("Save now")}</div>; }`;
    const cands = recordCandidates(src, "A.tsx");
    expect(find(cands, "Save now")?.insideCall).toBe("cn");
  });

  it("records template interpolation expression offsets", () => {
    const src = "function A(){ const name='x'; return <p>{`Hi ${name}!`}</p>; }";
    const cands = recordCandidates(src, "A.tsx");
    const c = find(cands, "Hi {name}!");
    expect(c).toBeDefined();
    expect(c!.role).toBe("template");
    expect(c!.interpolations?.[0].name).toBe("name");
    expect(src.slice(c!.interpolations![0].exprStart, c!.interpolations![0].exprEnd)).toBe("name");
  });
});
