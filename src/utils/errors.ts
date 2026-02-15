export enum ExitCode {
  SUCCESS = 0,
  GENERAL_ERROR = 1,
  AUTH_ERROR = 2,
  CONFIG_ERROR = 3,
  STATE_ERROR = 4,
  PARSE_ERROR = 5,
  NETWORK_ERROR = 6,
  PARTIAL_ERROR = 7,
}

export class TransiaError extends Error {
  constructor(
    public code: ExitCode,
    message: string,
    public details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "TransiaError";
  }
}
