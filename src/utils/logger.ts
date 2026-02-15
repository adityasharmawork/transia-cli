type LogLevel = "error" | "warn" | "info" | "debug";

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

const SECRET_PATTERNS = [
  /sk-proj-[a-zA-Z0-9]{20,}/g,
  /sk-[a-zA-Z0-9]{20,}/g,
  /sk-ant-[a-zA-Z0-9-]{20,}/g,
  /xai-[a-zA-Z0-9]{20,}/g,
  /AIza[a-zA-Z0-9_-]{30,}/g,
  /AKIA[A-Z0-9]{16}/g,
  /Bearer\s+[a-zA-Z0-9._-]{20,}/g,
  /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+/g,
];

function redact(message: string): string {
  let result = message;
  for (const pattern of SECRET_PATTERNS) {
    result = result.replace(pattern, "[REDACTED]");
  }
  return result;
}

class Logger {
  private level: LogLevel = "info";

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  private shouldLog(level: LogLevel): boolean {
    return LEVEL_PRIORITY[level] <= LEVEL_PRIORITY[this.level];
  }

  error(msg: string): void {
    if (this.shouldLog("error")) {
      process.stderr.write(redact(`[ERROR] ${msg}`) + "\n");
    }
  }

  warn(msg: string): void {
    if (this.shouldLog("warn")) {
      process.stderr.write(redact(`[WARN] ${msg}`) + "\n");
    }
  }

  info(msg: string): void {
    if (this.shouldLog("info")) {
      process.stdout.write(redact(msg) + "\n");
    }
  }

  debug(msg: string): void {
    if (this.shouldLog("debug")) {
      process.stderr.write(redact(`[DEBUG] ${msg}`) + "\n");
    }
  }
}

export { redact };
export const logger = new Logger();
