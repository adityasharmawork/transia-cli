import { describe, it, expect } from "vitest";
import { mergeCatalogs } from "../../src/output/merge";

type Cat = Map<string, Record<string, string>>;
const cat = (obj: Record<string, Record<string, string>>): Cat =>
  new Map(Object.entries(obj));

describe("mergeCatalogs", () => {
  it("keeps every existing value when nothing is generated (fresh clone, empty state)", () => {
    const existing = cat({ es: { a: "hola", b: "mundo" } });
    const generated = cat({ es: {} });
    const merged = mergeCatalogs(existing, generated, { force: false, prune: false });
    expect(merged.get("es")).toEqual({ a: "hola", b: "mundo" });
  });

  it("does not shrink a file when a run returns only some keys (partial failure)", () => {
    const existing = cat({ es: { a: "A", b: "B", c: "C" } });
    const generated = cat({ es: { a: "A" } });
    const merged = mergeCatalogs(existing, generated, { force: false, prune: false });
    expect(Object.keys(merged.get("es")!).sort()).toEqual(["a", "b", "c"]);
  });

  it("keeps a hand-edited value over a regeneration unless force", () => {
    const existing = cat({ es: { greeting: "HAND-EDITED" } });
    const generated = cat({ es: { greeting: "auto" } });
    const merged = mergeCatalogs(existing, generated, { force: false, prune: false });
    expect(merged.get("es")!.greeting).toBe("HAND-EDITED");
  });

  it("overwrites existing values with generated ones when force is set", () => {
    const existing = cat({ es: { greeting: "HAND-EDITED" } });
    const generated = cat({ es: { greeting: "auto" } });
    const merged = mergeCatalogs(existing, generated, { force: true, prune: false });
    expect(merged.get("es")!.greeting).toBe("auto");
  });

  it("keeps an orphan key by default and removes it only when prune is set", () => {
    const existing = cat({ es: { a: "A", orphan: "O" } });
    const generated = cat({ es: { a: "A" } });

    const kept = mergeCatalogs(existing, generated, { force: false, prune: false });
    expect(kept.get("es")).toHaveProperty("orphan", "O");

    const pruned = mergeCatalogs(existing, generated, { force: false, prune: true });
    expect(pruned.get("es")).not.toHaveProperty("orphan");
    expect(pruned.get("es")).toHaveProperty("a", "A");
  });
});
