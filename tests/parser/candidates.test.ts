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

describe("recordCandidates — compound interpolation (F5)", () => {
  it("joins text + {expr} + text siblings into one ICU message", () => {
    const src = `function A(){ const userName='x'; return <p>Welcome back, {userName}!</p>; }`;
    const cands = recordCandidates(src, "A.tsx");
    const c = find(cands, "Welcome back, {userName}!");
    expect(c).toBeDefined();
    expect(c!.role).toBe("jsx-compound");
    expect(c!.interpolations?.map((i) => i.name)).toEqual(["userName"]);
    expect(src.slice(c!.interpolations![0].exprStart, c!.interpolations![0].exprEnd)).toBe(
      "userName",
    );
    expect(src.slice(c!.start, c!.end)).toBe("Welcome back, {userName}!");
    // must NOT also emit the truncated fragment
    expect(find(cands, "Welcome back,")).toBeUndefined();
  });

  it("handles an interpolation in the middle of the sentence", () => {
    const src = `function A(){ const count=3; return <p>You have {count} new messages</p>; }`;
    const c = find(recordCandidates(src, "A.tsx"), "You have {count} new messages");
    expect(c).toBeDefined();
    expect(c!.role).toBe("jsx-compound");
    expect(c!.interpolations?.[0].name).toBe("count");
  });

  it("uses the member-expression property as the placeholder name, value slices to the full expr", () => {
    const src = `function A(){ return <p>Hi {user.firstName}</p>; }`;
    const c = find(recordCandidates(src, "A.tsx"), "Hi {firstName}");
    expect(c).toBeDefined();
    expect(c!.role).toBe("jsx-compound");
    expect(c!.interpolations?.[0].name).toBe("firstName");
    expect(src.slice(c!.interpolations![0].exprStart, c!.interpolations![0].exprEnd)).toBe(
      "user.firstName",
    );
  });

  it("does NOT form a compound when a nested element is present (F4 territory) — falls back", () => {
    const src = `function A(){ const x=1; return <p>Agree to <a href="/t">Terms</a> {x}</p>; }`;
    const cands = recordCandidates(src, "A.tsx");
    expect(cands.find((c) => c.role === "jsx-compound")).toBeUndefined();
    expect(find(cands, "Agree to")).toBeDefined();
    expect(find(cands, "Terms")).toBeDefined();
  });

  it("does NOT form a compound when an expression is not a simple interpolation — falls back", () => {
    const src = `function A(){ const x=1; return <p>Total {format(x)}</p>; }`;
    const cands = recordCandidates(src, "A.tsx");
    expect(cands.find((c) => c.role === "jsx-compound")).toBeUndefined();
    expect(find(cands, "Total")).toBeDefined();
  });

  it("assembles a multi-line interpolated sentence and leaves surrounding indentation outside the span", () => {
    const src = [
      "function A(){ const userName='x'; return (",
      "  <p>",
      "    Welcome back, {userName}!",
      "  </p>",
      "); }",
    ].join("\n");
    const c = find(recordCandidates(src, "A.tsx"), "Welcome back, {userName}!");
    expect(c).toBeDefined();
    expect(c!.role).toBe("jsx-compound");
    expect(src.slice(c!.start, c!.end)).toBe("Welcome back, {userName}!");
  });

  it("handles an interpolation at the start of the message", () => {
    const c = find(
      recordCandidates(`function A(){ const count=3; return <p>{count} items left</p>; }`, "A.tsx"),
      "{count} items left",
    );
    expect(c).toBeDefined();
    expect(c!.role).toBe("jsx-compound");
  });

  it("keeps the element role hint for a compound message (button label)", () => {
    const c = find(
      recordCandidates(`function A(){ const label='x'; return <button>Save {label}</button>; }`, "A.tsx"),
      "Save {label}",
    );
    expect(c?.autoContext).toBe("button label");
  });

  it("disambiguates two DIFFERENT expressions that share a leaf name", () => {
    const src = `function A(){ const sender={name:'a'},receiver={name:'b'}; return <p>From {sender.name} to {receiver.name}</p>; }`;
    const c = find(recordCandidates(src, "A.tsx"), "From {name} to {name2}");
    expect(c).toBeDefined();
    expect(c!.role).toBe("jsx-compound");
    expect(c!.interpolations?.map((i) => i.name)).toEqual(["name", "name2"]);
    const [i0, i1] = c!.interpolations!;
    expect(src.slice(i0.exprStart, i0.exprEnd)).toBe("sender.name");
    expect(src.slice(i1.exprStart, i1.exprEnd)).toBe("receiver.name");
  });

  it("shares ONE placeholder when the same expression text repeats", () => {
    const src = `function A(){ const name='x'; return <p>{name} and {name} again</p>; }`;
    const c = find(recordCandidates(src, "A.tsx"), "{name} and {name} again");
    expect(c).toBeDefined();
    expect(c!.interpolations?.map((i) => i.name)).toEqual(["name"]);
  });

  it("drops newline-only whitespace at an interpolation boundary (matches React rendering)", () => {
    const src = [
      "function A(){ const count=3; return (",
      "  <p>",
      "    You have",
      "    {count}",
      "    new messages",
      "  </p>",
      "); }",
    ].join("\n");
    const c = find(recordCandidates(src, "A.tsx"), "You have{count}new messages");
    expect(c).toBeDefined();
    expect(c!.role).toBe("jsx-compound");
  });
});
