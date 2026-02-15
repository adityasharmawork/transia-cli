export interface PromptContext {
  sourceLocale: string;
  targetLocale: string;
  strings: Array<{ key: string; original: string; context?: string | null }>;
}

export function buildTranslationPrompt(ctx: PromptContext): {
  system: string;
  user: string;
} {
  const contextEntries = ctx.strings.filter((s) => s.context);
  let contextSection = "";
  if (contextEntries.length > 0) {
    contextSection =
      "\nAdditional context for specific strings:\n" +
      contextEntries
        .map((s) => `- "${s.key}": ${s.context}`)
        .join("\n");
  }

  const system = `You are a professional translator specializing in UI/UX content. Translate the following strings from ${ctx.sourceLocale} to ${ctx.targetLocale}.

Rules:
- Preserve all placeholders exactly as-is: {name}, {count}, etc.
- Preserve HTML tags exactly as-is
- Maintain the same tone and formality level as the original
- Do NOT translate brand names, technical terms, or proper nouns
- Keep translations natural and culturally appropriate for the target locale
- Return ONLY a valid JSON object mapping each key to its translated string
- Do NOT include any explanation or markdown, only the JSON object
${contextSection}`;

  const input: Record<string, string> = {};
  for (const s of ctx.strings) {
    input[s.key] = s.original;
  }

  const user = `Translate these strings:\n\n${JSON.stringify(input, null, 2)}`;

  return { system, user };
}
