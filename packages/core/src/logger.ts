import { Logger } from "./adapter.interface.js";

export class BasicLogger implements Logger {
  constructor(private context: string = "App") {}

  info(message: string, ...args: any[]): void {
    console.log(`[${this.context}] [INFO] ${message}`, ...args);
  }

  error(message: string, ...args: any[]): void {
    console.error(`[${this.context}] [ERROR] ${message}`, ...args);
  }

  warn(message: string, ...args: any[]): void {
    console.warn(`[${this.context}] [WARN] ${message}`, ...args);
  }

  debug(message: string, ...args: any[]): void {
    if (process.env.DEBUG) {
      console.debug(`[${this.context}] [DEBUG] ${message}`, ...args);
    }
  }
}
