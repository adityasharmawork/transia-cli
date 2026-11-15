import { describe, it, expect } from "vitest";
import { cookieRequestConfig, localesModule } from "../../src/setup/next-cookie";

describe("cookie-mode next-intl generators", () => {
  it("request config reads the NEXT_LOCALE cookie and falls back to the default locale", () => {
    const src = cookieRequestConfig("en", ["en", "es"], "locales");
    expect(src).toContain("cookies(");
    expect(src).toContain('"NEXT_LOCALE"');
    expect(src).toContain("defaultLocale");
    expect(src).toContain("getRequestConfig");
    expect(src).not.toContain("requestLocale"); // cookie mode, not routing mode
  });

  it("request config imports messages from the configured output dir", () => {
    expect(cookieRequestConfig("en", ["en", "es"], "locales")).toContain("../locales/");
    expect(cookieRequestConfig("en", ["en"], "src/messages")).toContain("../src/messages/");
  });

  it("locales module exports the locale list and default locale", () => {
    const src = localesModule("en", ["en", "es", "fr"]);
    expect(src).toContain('"es"');
    expect(src).toContain('"fr"');
    expect(src).toContain('defaultLocale = "en"');
  });
});
