export interface PromptContext {
  sourceLocale: string;
  targetLocale: string;
  strings: Array<{ key: string; original: string; context?: string | null }>;
  /** Preferred translations for specific source terms (brand/product vocab). */
  glossary?: Record<string, string>;
  /** Terms to keep verbatim in every locale (brand names, code tokens). */
  doNotTranslate?: string[];
  /** Tone/register for the translation. */
  formality?: "formal" | "informal" | "neutral";
}

const FORMALITY_INSTRUCTION: Record<NonNullable<PromptContext["formality"]>, string> = {
  formal:
    "Use a formal register throughout (e.g. usted in Spanish, Sie in German, vous in French).",
  informal:
    "Use an informal, friendly register throughout (e.g. tú in Spanish, du in German, tu in French).",
  neutral: "Use a neutral register that is neither overly formal nor casual.",
};

export function buildTranslationPrompt(ctx: PromptContext): {
  system: string;
  user: string;
} {
  const sections: string[] = [];

  const contextEntries = ctx.strings.filter((s) => s.context);
  if (contextEntries.length > 0) {
    sections.push(
      "Additional context for specific strings:\n" +
        contextEntries.map((s) => `- "${s.key}": ${s.context}`).join("\n"),
    );
  }

  const glossaryEntries = Object.entries(ctx.glossary ?? {});
  if (glossaryEntries.length > 0) {
    sections.push(
      "Glossary — use these EXACT translations for these terms, consistently wherever they appear:\n" +
        glossaryEntries.map(([from, to]) => `- "${from}" → "${to}"`).join("\n"),
    );
  }

  if (ctx.doNotTranslate && ctx.doNotTranslate.length > 0) {
    sections.push(
      "Do NOT translate these terms — keep them verbatim (unchanged) in every language:\n" +
        ctx.doNotTranslate.map((t) => `- ${t}`).join("\n"),
    );
  }

  if (ctx.formality) {
    sections.push(FORMALITY_INSTRUCTION[ctx.formality]);
  }

  const extras = sections.length > 0 ? "\n\n" + sections.join("\n\n") : "";

  const system = `You are a professional translator specializing in UI/UX content. Translate the following strings from ${ctx.sourceLocale} to ${ctx.targetLocale}.

Rules:
- Preserve all placeholders exactly as-is: {name}, {count}, etc.
- Preserve HTML tags exactly as-is
- Maintain the same tone and formality level as the original
- Do NOT translate brand names, technical terms, or proper nouns
- Keep translations natural and culturally appropriate for the target locale
- Return ONLY a valid JSON object mapping each key to its translated string
- Do NOT include any explanation or markdown, only the JSON object${extras}`;

  const input: Record<string, string> = {};
  for (const s of ctx.strings) {
    input[s.key] = s.original;
  }

  const user = `Translate these strings:\n\n${JSON.stringify(input, null, 2)}`;

  return { system, user };
}
