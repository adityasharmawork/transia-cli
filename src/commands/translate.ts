import { readFileSync } from "node:fs";
import { resolve, relative } from "node:path";
import { glob } from "glob";
import ora from "ora";
import chalk from "chalk";
import pLimit from "p-limit";
import {
  loadConfig,
  loadState,
  saveState,
  detectDelta,
  mergeTranslations,
  type ExtractedString as StateExtractedString,
} from "../state/manager.js";
import { extractStringsFromSource } from "../parser/extractor.js";
import { createProvider } from "../ai/provider.js";
import type { AIProvider, TranslationRequest } from "../ai/provider.js";
import { generateOutputFiles } from "../output/formats.js";
import { writeOutputFiles } from "../output/writer.js";
import { validateTranslation } from "../output/validator.js";
import { loadApiKey, clearKeys } from "../utils/keys.js";
import { logger } from "../utils/logger.js";
import { TransiaError, ExitCode } from "../utils/errors.js";

interface TranslateOptions {
  target?: string;
  provider?: string;
  force?: boolean;
  dryRun?: boolean;
  verbose?: boolean;
}

const BATCH_SIZE = 50;

export async function translateCommand(
  projectRoot: string,
  options: TranslateOptions,
): Promise<void> {
  // Set log level
  if (options.verbose) {
    logger.setLevel("debug");
  }

  // Load config
  const config = loadConfig(projectRoot);
  const targetLocales = options.target
    ? options.target.split(",").map((l) => l.trim())
    : config.targetLocales;
  const providerName = options.provider ?? config.provider.name;

  // Load API key (skip for dry-run since we won't call any API)
  let apiKey = "";
  if (!options.dryRun) {
    apiKey = loadApiKey(projectRoot, providerName, config.provider.apiKeyEnv);
  }

  let provider: AIProvider | null = null;

  try {
    // Step 1: Discover files
    const spinner = ora("Discovering source files...").start();

    const files: string[] = [];
    for (const pattern of config.include) {
      const matched = await glob(pattern, {
        cwd: projectRoot,
        ignore: config.exclude,
        absolute: true,
      });
      files.push(...matched);
    }
    // Deduplicate
    const uniqueFiles = [...new Set(files)];

    spinner.succeed(`Found ${uniqueFiles.length} source files`);

    if (uniqueFiles.length === 0) {
      logger.warn(
        "No source files found. Check the 'include' patterns in transia.config.json",
      );
      return;
    }

    // Step 2: Extract strings
    const extractSpinner = ora("Extracting translatable strings...").start();

    const allExtracted = new Map<string, StateExtractedString>();
    let parseErrors = 0;

    for (const file of uniqueFiles) {
      const source = readFileSync(file, "utf-8");
      const relativePath = relative(projectRoot, file);
      const result = extractStringsFromSource(source, relativePath);

      if (result.errors.length > 0) {
        parseErrors += result.errors.length;
      }

      for (const str of result.strings) {
        allExtracted.set(str.hash, {
          original: str.original,
          context: str.context,
          source: str.source,
        });
      }
    }

    extractSpinner.succeed(
      `Extracted ${allExtracted.size} unique translatable strings` +
        (parseErrors > 0
          ? chalk.yellow(` (${parseErrors} parse warnings)`)
          : ""),
    );

    if (allExtracted.size === 0) {
      logger.info("No translatable strings found in source files.");
      return;
    }

    // Step 3: Delta detection
    const state = options.force
      ? { version: 1, lastRun: new Date().toISOString(), strings: {} as any }
      : loadState(projectRoot);

    const delta = detectDelta(allExtracted, state);

    const stringsToTranslate = new Map([...delta.newStrings]);

    // For each target locale, also check for missing translations
    for (const locale of targetLocales) {
      for (const [hash, _entry] of allExtracted) {
        if (stringsToTranslate.has(hash)) continue;
        const existing = state.strings[hash];
        if (existing && !existing.translations[locale]) {
          stringsToTranslate.set(hash, allExtracted.get(hash)!);
        }
      }
    }

    if (stringsToTranslate.size === 0) {
      logger.info(
        chalk.green("All strings are already translated. Nothing to do."),
      );
      // Still generate output files in case format changed
      const outputFiles = generateOutputFiles(
        state,
        resolve(projectRoot, config.output.path),
        config.output.format,
        targetLocales,
        config.sourceLocale,
      );
      writeOutputFiles(outputFiles);
      logger.info(
        chalk.green(
          `Generated ${outputFiles.length} translation files in ${config.output.path}/`,
        ),
      );
      return;
    }

    // Dry run
    if (options.dryRun) {
      console.log("");
      console.log(chalk.bold("Dry run — strings to translate:"));
      console.log("");
      let count = 0;
      for (const [hash, str] of stringsToTranslate) {
        count++;
        if (count > 20) {
          console.log(
            chalk.dim(`  ... and ${stringsToTranslate.size - 20} more`),
          );
          break;
        }
        console.log(`  ${chalk.cyan(str.source)}: "${str.original}"`);
      }
      console.log("");
      console.log(
        `Total: ${stringsToTranslate.size} strings × ${targetLocales.length} locales = ${stringsToTranslate.size * targetLocales.length} translations`,
      );
      console.log(
        `Provider: ${providerName} (${config.provider.model ?? "default model"})`,
      );
      return;
    }

    // Step 4: Translate
    const p = createProvider(
      providerName,
      apiKey,
      config.provider.model,
    );
    provider = p;

    // Prepare batches
    const stringsList = Array.from(stringsToTranslate.entries());
    const batches: Array<
      Array<[string, StateExtractedString]>
    > = [];
    for (let i = 0; i < stringsList.length; i += BATCH_SIZE) {
      batches.push(stringsList.slice(i, i + BATCH_SIZE));
    }

    let totalTranslated = 0;
    let totalTokens = 0;
    let failedBatches = 0;

    const limit = pLimit(3);

    for (const locale of targetLocales) {
      const localeSpinner = ora(
        `Translating to ${chalk.bold(locale)}... [0/${batches.length} batches]`,
      ).start();

      let batchesDone = 0;

      const batchPromises = batches.map((batch, batchIndex) =>
        limit(async () => {
          const request: TranslationRequest = {
            strings: batch.map(([hash, str]) => ({
              key: hash,
              original: str.original,
              context: str.context,
            })),
            sourceLocale: config.sourceLocale,
            targetLocale: locale,
          };

          try {
            const result = await p.translate(request);

            // Validate and merge translations
            for (const [hash, str] of batch) {
              const translated = result.translations.get(hash);
              if (translated) {
                const validation = validateTranslation(
                  hash,
                  str.original,
                  translated,
                );
                if (validation.valid) {
                  mergeTranslations(
                    state,
                    hash,
                    str,
                    locale,
                    translated,
                    p.name,
                  );
                  totalTranslated++;
                }
              }
            }

            totalTokens += result.tokensUsed;
          } catch (error) {
            failedBatches++;
            const msg =
              error instanceof Error ? error.message : String(error);
            logger.debug(
              `Batch ${batchIndex + 1} failed for ${locale}: ${msg}`,
            );

            // Re-throw auth errors
            if (error instanceof TransiaError && error.code === ExitCode.AUTH_ERROR) {
              throw error;
            }
          }

          batchesDone++;
          localeSpinner.text = `Translating to ${chalk.bold(locale)}... [${batchesDone}/${batches.length} batches]`;

          // Checkpoint: save state periodically
          if (batchesDone % 5 === 0) {
            saveState(projectRoot, state);
          }
        }),
      );

      await Promise.all(batchPromises);

      // Save state after each locale
      saveState(projectRoot, state);

      localeSpinner.succeed(
        `Translated to ${chalk.bold(locale)} [${batches.length} batches]`,
      );
    }

    // Step 5: Generate output files
    const outputSpinner = ora("Generating translation files...").start();

    const outputFiles = generateOutputFiles(
      state,
      resolve(projectRoot, config.output.path),
      config.output.format,
      targetLocales,
      config.sourceLocale,
    );
    writeOutputFiles(outputFiles);

    outputSpinner.succeed(
      `Generated ${outputFiles.length} translation files in ${config.output.path}/`,
    );

    // Summary
    console.log("");
    console.log(chalk.green.bold("  Translation complete!"));
    console.log("");
    console.log(
      `  ${chalk.dim("Strings translated:")} ${totalTranslated}`,
    );
    console.log(
      `  ${chalk.dim("Target locales:")}     ${targetLocales.join(", ")}`,
    );
    console.log(
      `  ${chalk.dim("Provider:")}           ${providerName}`,
    );
    console.log(
      `  ${chalk.dim("Tokens used:")}        ${totalTokens.toLocaleString()}`,
    );
    if (failedBatches > 0) {
      console.log(
        chalk.yellow(
          `  ${failedBatches} batch(es) failed. Run again to retry.`,
        ),
      );
    }
    console.log("");

    if (failedBatches > 0) {
      process.exitCode = ExitCode.PARTIAL_ERROR;
    }
  } finally {
    provider?.destroy();
    clearKeys();
  }
}
