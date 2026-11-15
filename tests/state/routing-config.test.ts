import { describe, it, expect } from "vitest";
import { TransiaConfigSchema } from "../../src/state/schema";

const base = {
  version: 1,
  sourceLocale: "en",
  targetLocales: ["es"],
  provider: { name: "auto" },
  include: ["app/**/*.{tsx,jsx}"],
  output: { format: "next-intl", path: "locales" },
};

describe("TransiaConfig.routing", () => {
  it("defaults to cookie when omitted (back-compat with existing configs)", () => {
    const parsed = TransiaConfigSchema.parse(base);
    expect(parsed.routing).toBe("cookie");
  });

  it("accepts prefix (SEO mode)", () => {
    const parsed = TransiaConfigSchema.parse({ ...base, routing: "prefix" });
    expect(parsed.routing).toBe("prefix");
  });

  it("rejects an unknown routing value", () => {
    expect(() => TransiaConfigSchema.parse({ ...base, routing: "subdomain" })).toThrow();
  });
});
