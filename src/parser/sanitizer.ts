import { logger } from "../utils/logger.js";

interface SanitizeResult {
  sanitized: string;
  hadSecrets: boolean;
  redactedCount: number;
}

const SECRET_FILTERS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /sk-[a-zA-Z0-9]{20,}/g, label: "OPENAI_KEY" },
  { pattern: /sk-proj-[a-zA-Z0-9]{20,}/g, label: "OPENAI_PROJECT_KEY" },
  { pattern: /sk-ant-[a-zA-Z0-9-]{20,}/g, label: "ANTHROPIC_KEY" },
  { pattern: /xai-[a-zA-Z0-9]{20,}/g, label: "XAI_KEY" },
  { pattern: /AIza[a-zA-Z0-9_-]{30,}/g, label: "GOOGLE_KEY" },
  { pattern: /AKIA[A-Z0-9]{16}/g, label: "AWS_KEY" },
  // Stripe keys (live and test)
  { pattern: /sk_(?:live|test)_[a-zA-Z0-9]{20,}/g, label: "STRIPE_KEY" },
  { pattern: /rk_(?:live|test)_[a-zA-Z0-9]{20,}/g, label: "STRIPE_RESTRICTED_KEY" },
  { pattern: /pk_(?:live|test)_[a-zA-Z0-9]{20,}/g, label: "STRIPE_PUBLISHABLE_KEY" },
  { pattern: /whsec_[a-zA-Z0-9]{20,}/g, label: "WEBHOOK_SECRET" },
  // GitHub and GitLab tokens
  { pattern: /gh[pousr]_[A-Za-z0-9_]{36,}/g, label: "GITHUB_TOKEN" },
  { pattern: /glpat-[A-Za-z0-9_-]{20,}/g, label: "GITLAB_TOKEN" },
  // Azure
  { pattern: /DefaultEndpointsProtocol=https;AccountName=[^\s"';]+/g, label: "AZURE_CONNECTION" },
  {
    pattern: /Bearer\s+[a-zA-Z0-9._-]{20,}/g,
    label: "BEARER_TOKEN",
  },
  {
    pattern:
      /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+/g,
    label: "JWT",
  },
  {
    pattern: /(?:mongodb|postgres(?:ql)?|mysql|redis|amqp):\/\/[^\s"']+/g,
    label: "CONNECTION_STRING",
  },
  {
    pattern: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/g,
    label: "PRIVATE_KEY",
  },
  {
    pattern:
      /(?:password|secret|token|api_key|apikey)\s*[:=]\s*["'][^"']{8,}["']/gi,
    label: "SECRET",
  },
  { pattern: /[0-9a-fA-F]{40,}/g, label: "HEX_TOKEN" },
];

export function sanitizeForPrompt(
  text: string,
  source?: string,
): SanitizeResult {
  let sanitized = text;
  let redactedCount = 0;

  for (const { pattern, label } of SECRET_FILTERS) {
    // Reset regex lastIndex since we're reusing patterns
    pattern.lastIndex = 0;
    sanitized = sanitized.replace(pattern, () => {
      redactedCount++;
      return `[${label}_REDACTED]`;
    });
  }

  if (redactedCount > 0 && source) {
    logger.warn(
      `Detected ${redactedCount} potential secret(s) in ${source}. Redacted before sending to AI.`,
    );
  }

  return { sanitized, hadSecrets: redactedCount > 0, redactedCount };
}
