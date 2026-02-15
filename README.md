# Transia

Enterprise-grade BYOK (Bring Your Own Key) AI translation CLI for React and Next.js applications.

Transia extracts user-facing strings from your TSX/JSX source files, translates them using your AI provider of choice, and generates locale files compatible with next-intl or i18next.

## Features

- **BYOK** - Uses your own API keys. Keys are loaded from `.env` files, never stored or transmitted.
- **Intelligent AST Parsing** - Babel-powered extraction of translatable strings from JSX/TSX, including JSX text, string literals, template literals, and translatable attributes.
- **Delta Translation** - SHA-256 fingerprinting detects new and changed strings so you only pay to translate what changed.
- **Multiple AI Providers** - OpenAI, Anthropic, Google Gemini, and xAI Grok.
- **Multiple Output Formats** - next-intl (flat JSON) and i18next (namespaced JSON).
- **Security First** - API keys are scrubbed from memory after use, secrets are redacted from logs and AI prompts, atomic file writes prevent corruption.

## Installation

```bash
npm install -g transia
```

Or use it directly with npx:

```bash
npx transia init
```

Requires Node.js 20 or later.

## Quick Start

### 1. Initialize

```bash
cd your-react-project
transia init
```

This creates a `transia.config.json` in your project root with sensible defaults.

### 2. Add your API key

Add the API key for your chosen provider to your `.env` or `.env.local`:

```env
# OpenAI
OPENAI_API_KEY=sk-...

# Anthropic
ANTHROPIC_API_KEY=sk-ant-...

# Google Gemini
GEMINI_API_KEY=AIza...

# xAI Grok
XAI_API_KEY=xai-...
```

### 3. Configure target locales

Edit `transia.config.json` and set your target locales:

```json
{
  "targetLocales": ["es", "fr", "de", "ja"]
}
```

### 4. Translate

```bash
transia translate
```

Preview what will be translated without making API calls:

```bash
transia translate --dry-run
```

### 5. Check coverage

```bash
transia status
```

## Configuration

`transia.config.json` reference:

```json
{
  "version": 1,
  "sourceLocale": "en",
  "targetLocales": ["es", "fr"],
  "provider": {
    "name": "openai",
    "model": "gpt-4o-mini",
    "apiKeyEnv": "MY_CUSTOM_KEY_VAR"
  },
  "include": ["src/**/*.{tsx,jsx}", "app/**/*.{tsx,jsx}"],
  "exclude": ["**/*.test.*", "**/*.spec.*", "**/node_modules/**"],
  "output": {
    "format": "next-intl",
    "path": "locales"
  }
}
```

| Field | Description |
|---|---|
| `sourceLocale` | Source language code (e.g. `"en"`) |
| `targetLocales` | Array of target locale codes (e.g. `["es", "fr-FR"]`) |
| `provider.name` | AI provider: `"openai"`, `"anthropic"`, `"gemini"`, or `"grok"` |
| `provider.model` | Optional model override (uses provider default if omitted) |
| `provider.apiKeyEnv` | Optional custom env variable name for the API key |
| `include` | Glob patterns for source files to scan |
| `exclude` | Glob patterns for files to skip |
| `output.format` | `"next-intl"` (flat JSON) or `"i18next"` (namespaced JSON) |
| `output.path` | Output directory for generated locale files |

## CLI Commands

### `transia init`

Initialize Transia in your project. Auto-detects framework (Next.js, Remix, Gatsby) and source directories.

### `transia translate`

Extract strings and translate them.

| Flag | Description |
|---|---|
| `--target <locales>` | Override target locales (comma-separated) |
| `--provider <name>` | Override AI provider |
| `--force` | Re-translate all strings (ignore cache) |
| `--dry-run` | Preview strings without calling the API |
| `--verbose` | Enable debug logging |

### `transia status`

Display translation coverage per locale.

### `transia reset --confirm`

Delete translation state. Use `--include-output` to also delete generated locale files.

## Inline Hints

Add context for the translator with comments:

```tsx
{/* transia-context: This is a greeting shown on the dashboard */}
<h1>Welcome back!</h1>
```

## Security

- API keys are loaded from `.env` files and cleared from memory after each run.
- Source code is sanitized before being sent to AI providers - secrets, tokens, and connection strings are automatically redacted.
- All log output is scrubbed of API keys and tokens.
- State files are written atomically with backup to prevent corruption.
- Auth errors (401/403) abort immediately without retry to avoid key lockout.

## License

MIT
