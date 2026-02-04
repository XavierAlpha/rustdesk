export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export class Logger {
  private readonly scope: string;
  private readonly debugEnabled: boolean;

  constructor(scope: string, debugEnabled = false) {
    this.scope = scope;
    this.debugEnabled = debugEnabled;
  }

  debug(message: string, ...args: unknown[]): void {
    if (!this.debugEnabled) {
      return;
    }
    console.debug(`[${this.scope}] ${message}`, ...args);
  }

  info(message: string, ...args: unknown[]): void {
    console.info(`[${this.scope}] ${message}`, ...args);
  }

  warn(message: string, ...args: unknown[]): void {
    console.warn(`[${this.scope}] ${message}`, ...args);
  }

  error(message: string, ...args: unknown[]): void {
    console.error(`[${this.scope}] ${message}`, ...args);
  }
}
