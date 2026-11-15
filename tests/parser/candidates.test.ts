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

describe("recordCandidates — per-string transia-context comments", () => {
  it("applies the nearest preceding transia-context comment, not just the first", () => {
    const src = `function A(){
      return (<div>
        {/* transia-context: hero section */}
        <h1>Welcome</h1>
        {/* transia-context: footer section */}
        <p>Goodbye</p>
      </div>);
    }`;
    const cands = recordCandidates(src, "A.tsx");
    expect(find(cands, "Welcome")?.context).toBe("hero section");
    expect(find(cands, "Goodbye")?.context).toBe("footer section");
  });

  it("still applies a single top-of-file comment to every string (back-compat)", () => {
    const src = `// transia-context: marketing page
      function A(){ return (<div><p>One</p><p>Two</p></div>); }`;
    const cands = recordCandidates(src, "A.tsx");
    expect(find(cands, "One")?.context).toBe("marketing page");
    expect(find(cands, "Two")?.context).toBe("marketing page");
  });

  it("leaves context null for strings before any comment", () => {
    const src = `function A(){ return (<div>
      <p>Early</p>
      {/* transia-context: later */}
      <p>Late</p>
    </div>); }`;
    const cands = recordCandidates(src, "A.tsx");
    expect(find(cands, "Early")?.context).toBeNull();
    expect(find(cands, "Late")?.context).toBe("later");
  });

  it("does not apply a comment that sits to the right of a string on the same line", () => {
    const src = `function A(){ return (<div>
      <h1>Title</h1>{/* transia-context: footer */}
      <p>Body</p>
    </div>); }`;
    const cands = recordCandidates(src, "A.tsx");
    expect(find(cands, "Title")?.context).toBeNull();
    expect(find(cands, "Body")?.context).toBe("footer");
  });
});

describe("recordCandidates — auto role/attribute context", () => {
  const ac = (src: string, s: string) =>
    find(recordCandidates(src, "A.tsx"), s)?.autoContext;

  it("labels button text as a button label", () => {
    expect(ac(`function A(){ return <button>Submit order</button>; }`, "Submit order")).toBe(
      "button label",
    );
  });

  it("labels image alt text", () => {
    expect(ac(`function A(){ return <img alt="Team photo" />; }`, "Team photo")).toBe(
      "image alt text",
    );
  });

  it("labels any heading h1-h6 as a heading", () => {
    expect(ac(`function A(){ return <h2>Our mission</h2>; }`, "Our mission")).toBe("heading");
  });

  it("labels aria-label as a screen-reader accessibility label", () => {
    expect(
      ac(`function A(){ return <button aria-label="Close the dialog">Dismiss</button>; }`, "Close the dialog"),
    ).toMatch(/accessibility/i);
  });

  it("records the nearest enclosing element name", () => {
    const c = find(
      recordCandidates(`function A(){ return <a href="/x">Learn more</a>; }`, "A.tsx"),
      "Learn more",
    );
    expect(c?.elementName).toBe("a");
    expect(c?.autoContext).toBe("link text");
  });

  it("gives no auto context for generic body text or custom components", () => {
    expect(ac(`function A(){ return <p>Just a paragraph here</p>; }`, "Just a paragraph here")).toBeUndefined();
    expect(ac(`function A(){ return <Card>Custom body text here</Card>; }`, "Custom body text here")).toBeUndefined();
  });
});
