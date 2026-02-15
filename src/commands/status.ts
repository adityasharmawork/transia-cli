import chalk from "chalk";
import { loadConfig, loadState } from "../state/manager.js";
import { logger } from "../utils/logger.js";

export async function statusCommand(projectRoot: string): Promise<void> {
  const config = loadConfig(projectRoot);
  const state = loadState(projectRoot);

  const totalStrings = Object.keys(state.strings).length;

  if (totalStrings === 0) {
    logger.info(
      'No translations found. Run "transia translate" first.',
    );
    return;
  }

  // Calculate coverage per locale
  const locales = config.targetLocales;

  // Table header
  const colWidths = { locale: 10, total: 8, translated: 12, missing: 9, coverage: 10 };
  const hr = "+" + "-".repeat(colWidths.locale + 2) +
    "+" + "-".repeat(colWidths.total + 2) +
    "+" + "-".repeat(colWidths.translated + 2) +
    "+" + "-".repeat(colWidths.missing + 2) +
    "+" + "-".repeat(colWidths.coverage + 2) + "+";

  console.log("");
  console.log(hr);
  console.log(
    `| ${"Locale".padEnd(colWidths.locale)} | ${"Total".padEnd(colWidths.total)} | ${"Translated".padEnd(colWidths.translated)} | ${"Missing".padEnd(colWidths.missing)} | ${"Coverage".padEnd(colWidths.coverage)} |`,
  );
  console.log(hr);

  for (const locale of locales) {
    let translated = 0;
    let missing = 0;

    for (const entry of Object.values(state.strings)) {
      if (entry.translations[locale]?.value) {
        translated++;
      } else {
        missing++;
      }
    }

    const coverage =
      totalStrings > 0
        ? Math.round((translated / totalStrings) * 100)
        : 0;

    const coverageStr =
      coverage === 100
        ? chalk.green(`${coverage}%`)
        : coverage >= 80
          ? chalk.yellow(`${coverage}%`)
          : chalk.red(`${coverage}%`);

    console.log(
      `| ${locale.padEnd(colWidths.locale)} | ${String(totalStrings).padEnd(colWidths.total)} | ${String(translated).padEnd(colWidths.translated)} | ${String(missing).padEnd(colWidths.missing)} | ${String(coverage + "%").padEnd(colWidths.coverage)} |`,
    );
  }

  console.log(hr);
  console.log("");
  console.log(
    chalk.dim(`  Source locale: ${config.sourceLocale}`),
  );
  console.log(
    chalk.dim(`  Provider: ${config.provider.name}`),
  );
  console.log(
    chalk.dim(`  Output: ${config.output.format} → ${config.output.path}/`),
  );
  console.log("");
}
