import { describe, it, expect } from "vitest";
import { parse } from "@babel/parser";
import {
  cookieRequestConfig,
  localesModule,
  wrapLayoutForNextIntl,
  addNextIntlPlugin,
} from "../../src/setup/next-cookie";

const parseOk = (s: string) => {
  try {
    parse(s, { sourceType: "module", plugins: ["jsx", "typescript"] });
    return true;
  } catch {
    return false;
  }
};

const ASYNC_LAYOUT = `export default async function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html>
      <body>{children}</body>
    </html>
  );
}
`;

const SYNC_LAYOUT = `export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="app">{children}</body>
    </html>
  );
}
`;

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

describe("wrapLayoutForNextIntl", () => {
  it("wraps a standard async layout: provider, lang, server imports; output re-parses", () => {
    const r = wrapLayoutForNextIntl(ASYNC_LAYOUT);
    expect(r.wrapped).toBe(true);
    const out = (r as { output: string }).output;
    expect(out).toContain("NextIntlClientProvider");
    expect(out).toContain("getLocale");
    expect(out).toContain("getMessages");
    expect(out).toContain("lang={locale}");
    expect(parseOk(out)).toBe(true);
  });

  it("wraps a sync layout by making the component async", () => {
    const r = wrapLayoutForNextIntl(SYNC_LAYOUT);
    expect(r.wrapped).toBe(true);
    const out = (r as { output: string }).output;
    expect(out).toContain("async function RootLayout");
    expect(out).toContain("NextIntlClientProvider");
    expect(parseOk(out)).toBe(true);
  });

  it("leaves an already-wrapped layout untouched", () => {
    const already = ASYNC_LAYOUT.replace(
      "<body>{children}</body>",
      "<body><NextIntlClientProvider>{children}</NextIntlClientProvider></body>",
    );
    expect(wrapLayoutForNextIntl(already).wrapped).toBe(false);
  });

  it("refuses a non-standard layout (no <html>/<body>) with a reason", () => {
    const r = wrapLayoutForNextIntl(`export default function X() { return <div>hi there</div>; }`);
    expect(r.wrapped).toBe(false);
    expect((r as { reason: string }).reason).toBeTruthy();
  });
});

describe("addNextIntlPlugin", () => {
  const NEXT_TS = `import type { NextConfig } from "next";
const nextConfig: NextConfig = { reactStrictMode: true };
export default nextConfig;
`;
  const NEXT_OBJ = `export default { reactStrictMode: true };\n`;

  it("wraps `export default nextConfig` and imports the plugin", () => {
    const r = addNextIntlPlugin(NEXT_TS);
    expect(r.changed).toBe(true);
    expect(r.output).toContain("next-intl/plugin");
    expect(r.output).toContain("withNextIntl(nextConfig)");
    expect(parseOk(r.output)).toBe(true);
  });

  it("wraps an inline default-exported config object", () => {
    const r = addNextIntlPlugin(NEXT_OBJ);
    expect(r.changed).toBe(true);
    expect(r.output).toContain("withNextIntl(");
    expect(parseOk(r.output)).toBe(true);
  });

  it("is idempotent — a second run makes no change", () => {
    const once = addNextIntlPlugin(NEXT_TS).output;
    const twice = addNextIntlPlugin(once);
    expect(twice.changed).toBe(false);
    expect(twice.output).toBe(once);
  });

  it("returns changed:false for an unrecognized config shape", () => {
    expect(addNextIntlPlugin(`const x = 1;\n`).changed).toBe(false);
  });
});
