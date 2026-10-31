export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export type LogMeta = Record<string, unknown>;

export type LogContext = Record<string, unknown>;

export type LogFn = {
  (message: string, meta?: LogMeta): void;
  (meta: LogMeta, message?: string): void;
  (error: Error, meta?: LogMeta): void;
};

export interface Logger {
  debug: LogFn;
  info: LogFn;
  warn: LogFn;
  error: LogFn;
  fatal: LogFn;
  child(context: LogContext): Logger;
}

export interface Transport {
  write(level: LogLevel, message: string | undefined, meta: LogMeta): void;
  flush?(): void | Promise<void>;
}

export interface LoggerFactory {
  create(context?: LogContext): Logger;
  shutdown(): Promise<void>;
}
