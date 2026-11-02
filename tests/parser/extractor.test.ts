import { describe, it, expect } from "vitest";
import { extractStringsFromSource } from "../../src/parser/extractor";

describe("extractStringsFromSource (recorder + classifier)", () => {
  const src = `function A(){
    return (
      <div data-x="skip-me">
        {status === "active" ? <p>Welcome back</p> : null}
        <img tooltip="Helpful hint" alt="Logo image" />
      </div>
    );
  }`;

  const originals = () =>
    extractStringsFromSource(src, "A.tsx").strings.map((s) => s.original);

  it("extracts plain JSX copy", () => {
    expect(originals()).toContain("Welcome back");
  });

  it("drops strings used in a comparison (no more logic-string extraction)", () => {
    expect(originals()).not.toContain("active");
  });

  it("gains custom attribute coverage under the deny-list (tooltip, alt)", () => {
    expect(originals()).toContain("Helpful hint");
    expect(originals()).toContain("Logo image");
  });

  it("still excludes deny-listed/data-* attribute values", () => {
    expect(originals()).not.toContain("skip-me");
  });

  it("honors excludeAttributes on the extract path (so extract and apply agree)", () => {
    const withExclude = extractStringsFromSource(src, "A.tsx", ["tooltip"]).strings.map(
      (s) => s.original,
    );
    expect(withExclude).not.toContain("Helpful hint"); // tooltip now excluded
    expect(withExclude).toContain("Logo image"); // alt still included
  });
});
