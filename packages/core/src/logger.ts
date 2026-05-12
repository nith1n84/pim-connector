import { Logger } from "./adapter.interface.js";

export enum LogLevel {
  ERROR = 0,
  WARN = 1,
  INFO = 2,
  DEBUG = 3,
}

export class BasicLogger implements Logger {
  private readonly logLevel: LogLevel;

  constructor(
    private context: string = "App",
    logLevel?: string,
  ) {
    const level = logLevel || process.env.LOG_LEVEL || "INFO";
    this.logLevel = LogLevel[level.toUpperCase() as keyof typeof LogLevel] ?? LogLevel.INFO;
  }

  private shouldLog(level: LogLevel): boolean {
    return level <= this.logLevel;
  }

  info(message: string, ...args: any[]): void {
    if (this.shouldLog(LogLevel.INFO)) {
      console.log(`[${this.context}] [INFO] ${message}`, ...args);
    }
  }

  error(message: string, ...args: any[]): void {
    if (this.shouldLog(LogLevel.ERROR)) {
      console.error(`[${this.context}] [ERROR] ${message}`, ...args);
    }
  }

  warn(message: string, ...args: any[]): void {
    if (this.shouldLog(LogLevel.WARN)) {
      console.warn(`[${this.context}] [WARN] ${message}`, ...args);
    }
  }

  debug(message: string, ...args: any[]): void {
    if (this.shouldLog(LogLevel.DEBUG)) {
      console.debug(`[${this.context}] [DEBUG] ${message}`, ...args);
    }
  }
}
