/**
 * Logger Module
 * Provides structured logging with levels
 */

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

const LOG_LEVEL = (process.env.LOG_LEVEL?.toUpperCase() as keyof typeof LogLevel) || "INFO";
const currentLevel = LogLevel[LOG_LEVEL] ?? LogLevel.INFO;

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  // Authorization headers
  [/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1[redacted]"],
  // Server-issued tokens
  [/mcp1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[redacted-token]"],
  // OAuth / Google credential fields, either JSON or query-string shaped
  [
    /("?(?:access_token|refresh_token|id_token|client_secret|code_verifier)"?\s*[:=]\s*"?)([^"\s,}&]+)/gi,
    "$1[redacted]",
  ],
];

/** Strip credentials from anything that is about to be logged. */
export function redact(value: string): string {
  let result = value;
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

function formatMessage(level: string, message: string, meta?: Record<string, unknown>): string {
  const timestamp = new Date().toISOString();
  const metaStr = meta ? ` ${redact(JSON.stringify(meta))}` : "";
  return `[${timestamp}] [${level}] ${redact(message)}${metaStr}`;
}

export const logger = {
  debug(message: string, meta?: Record<string, unknown>): void {
    if (currentLevel <= LogLevel.DEBUG) {
      console.error(formatMessage("DEBUG", message, meta));
    }
  },

  info(message: string, meta?: Record<string, unknown>): void {
    if (currentLevel <= LogLevel.INFO) {
      console.error(formatMessage("INFO", message, meta));
    }
  },

  warn(message: string, meta?: Record<string, unknown>): void {
    if (currentLevel <= LogLevel.WARN) {
      console.error(formatMessage("WARN", message, meta));
    }
  },

  error(message: string, error?: Error | unknown, meta?: Record<string, unknown>): void {
    if (currentLevel <= LogLevel.ERROR) {
      const errorMeta = error instanceof Error 
        ? { ...meta, error: error.message, stack: error.stack }
        : { ...meta, error: String(error) };
      console.error(formatMessage("ERROR", message, errorMeta));
    }
  },
};

export type Logger = typeof logger;
