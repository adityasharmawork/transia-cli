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

  it("refuses a \"use client\" layout (server APIs can't go in a client component)", () => {
    const r = wrapLayoutForNextIntl(`"use client";\n${ASYNC_LAYOUT}`);
    expect(r.wrapped).toBe(false);
    expect((r as { reason: string }).reason).toMatch(/client/i);
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

describe("addNextIntlPlugin — function-form configs (review #3)", () => {
  // next-intl's withNextIntl(nextConfig) reads nextConfig as an OBJECT
  // (getNextConfig looks at nextConfig?.i18n; no typeof === 'function' branch).
  // Wrapping a function-form config would silently drop the user's config factory,
  // so these shapes must be refused (changed:false) and left for a manual snippet.
  it("refuses a function-declaration default export", () => {
    const src = `export default function (phase) {\n  return { reactStrictMode: true };\n}\n`;
    const r = addNextIntlPlugin(src);
    expect(r.changed).toBe(false);
    expect(r.output).toBe(src);
  });

  it("refuses an arrow-function default export", () => {
    const src = `export default (phase) => ({ reactStrictMode: true });\n`;
    expect(addNextIntlPlugin(src).changed).toBe(false);
  });

  it("refuses a default export that resolves to a function via an identifier", () => {
    const src = `const nextConfig = (phase) => ({ reactStrictMode: true });\nexport default nextConfig;\n`;
    expect(addNextIntlPlugin(src).changed).toBe(false);
  });

  it("refuses a CJS function config (module.exports = () => ({...}))", () => {
    const src = `module.exports = () => ({ reactStrictMode: true });\n`;
    expect(addNextIntlPlugin(src).changed).toBe(false);
  });

  it("still wraps a composed plugin CALL (withSentry(...)) — not a function config", () => {
    const src = `import { withSentry } from "@sentry/nextjs";\nexport default withSentry({ reactStrictMode: true });\n`;
    const r = addNextIntlPlugin(src);
    expect(r.changed).toBe(true);
    expect(r.output).toContain("withNextIntl(withSentry(");
    expect(parseOk(r.output)).toBe(true);
  });
});

describe("addNextIntlPlugin — AST idempotency (review #4)", () => {
  it("does NOT treat a comment mentioning next-intl/plugin as an existing install", () => {
    const src = `// we deliberately don't use next-intl/plugin here\nexport default { reactStrictMode: true };\n`;
    const r = addNextIntlPlugin(src);
    expect(r.changed).toBe(true);
    expect(r.output).toContain('createNextIntlPlugin("./i18n/request.ts")');
    expect(parseOk(r.output)).toBe(true);
  });

  it("still skips when the plugin is actually imported (real prior run)", () => {
    const src = `import createNextIntlPlugin from "next-intl/plugin";\nconst withNextIntl = createNextIntlPlugin("./i18n/request.ts");\nexport default withNextIntl({ reactStrictMode: true });\n`;
    expect(addNextIntlPlugin(src).changed).toBe(false);
  });
});

describe("addNextIntlPlugin — TS-wrapped function configs (review #3 follow-up)", () => {
  // `satisfies`/`as`/`!` wrap the config in a TS expression node; the function
  // hides one `.expression` below, so the guard must unwrap before classifying.
  it("refuses a function config reached through an identifier + `satisfies`", () => {
    const src = `const nextConfig = (phase) => ({ reactStrictMode: true });\nexport default nextConfig satisfies unknown;\n`;
    expect(addNextIntlPlugin(src).changed).toBe(false);
  });

  it("refuses an inline arrow config wrapped in `satisfies`", () => {
    const src = `export default ((phase) => ({ reactStrictMode: true })) satisfies unknown;\n`;
    expect(addNextIntlPlugin(src).changed).toBe(false);
  });

  it("refuses an inline arrow config wrapped in `as`", () => {
    const src = `export default ((phase) => ({ reactStrictMode: true })) as any;\n`;
    expect(addNextIntlPlugin(src).changed).toBe(false);
  });

  it("still wraps an OBJECT config wrapped in `satisfies` (not a function)", () => {
    const src = `const nextConfig = { reactStrictMode: true };\nexport default nextConfig satisfies unknown;\n`;
    const r = addNextIntlPlugin(src);
    expect(r.changed).toBe(true);
    expect(parseOk(r.output)).toBe(true);
  });
});

describe("addNextIntlPlugin — distinguishes 'already installed' from 'refused' (review #4 follow-up)", () => {
  it("reports alreadyInstalled:true only for a real prior run", () => {
    const installed = `import createNextIntlPlugin from "next-intl/plugin";\nconst withNextIntl = createNextIntlPlugin("./i18n/request.ts");\nexport default withNextIntl({ reactStrictMode: true });\n`;
    expect(addNextIntlPlugin(installed).alreadyInstalled).toBe(true);
  });

  it("reports alreadyInstalled:false when it REFUSES a function-form config (caller must still print guidance)", () => {
    const fn = `export default (phase) => ({ reactStrictMode: true });\n`;
    const r = addNextIntlPlugin(fn);
    expect(r.changed).toBe(false);
    expect(r.alreadyInstalled).toBe(false);
  });

  it("reports alreadyInstalled:false when the module name appears only in a comment", () => {
    const commented = `// not using next-intl/plugin\nexport default (phase) => ({ reactStrictMode: true });\n`;
    expect(addNextIntlPlugin(commented).alreadyInstalled).toBe(false);
  });
});

describe("wrapLayoutForNextIntl — multiple <html> (review #5)", () => {
  it("refuses a layout that renders two conditional <html> branches", () => {
    const src = `export default function RootLayout({ children }: { children: React.ReactNode }) {
  if (process.env.MAINTENANCE) {
    return (
      <html>
        <body>{children}</body>
      </html>
    );
  }
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
`;
    const r = wrapLayoutForNextIntl(src);
    expect(r.wrapped).toBe(false);
    expect((r as { reason: string }).reason).toMatch(/multiple|conditional/i);
  });
});
