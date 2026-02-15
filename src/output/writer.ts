import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import writeFileAtomic from "write-file-atomic";
import type { OutputFile } from "./formats.js";
import { logger } from "../utils/logger.js";

export function writeOutputFiles(files: OutputFile[]): void {
  for (const file of files) {
    const dir = dirname(file.path);
    mkdirSync(dir, { recursive: true });
    writeFileAtomic.sync(file.path, file.content);
    logger.debug(`Written: ${file.path}`);
  }
}
