import { describe, it, expect } from "vitest";
import { isInsideProject } from "../src/utils/paths";

describe("isInsideProject", () => {
  const root = "/tmp/proj";
  it("accepts a normal subdirectory", () => {
    expect(isInsideProject(root, "locales")).toBe(true);
    expect(isInsideProject(root, "src/messages")).toBe(true);
  });
  it("rejects the project root itself", () => {
    expect(isInsideProject(root, ".")).toBe(false);
    expect(isInsideProject(root, "")).toBe(false);
    expect(isInsideProject(root, "locales/..")).toBe(false);
  });
  it("rejects escaping the project", () => {
    expect(isInsideProject(root, "..")).toBe(false);
    expect(isInsideProject(root, "../sibling")).toBe(false);
    expect(isInsideProject(root, "../../etc")).toBe(false);
  });
  it("rejects absolute paths outside the project", () => {
    expect(isInsideProject(root, "/etc")).toBe(false);
    expect(isInsideProject(root, "/tmp/other")).toBe(false);
  });
  it("accepts an absolute path that is inside", () => {
    expect(isInsideProject(root, "/tmp/proj/locales")).toBe(true);
  });
});
