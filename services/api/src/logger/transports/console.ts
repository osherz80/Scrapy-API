import type { LogLevel, LogMeta, Transport } from '../types.ts';

const CONSOLE_METHOD = {
  debug: 'debug',
  info: 'info',
  warn: 'warn',
  error: 'error',
  fatal: 'error',
} as const satisfies Record<LogLevel, 'debug' | 'info' | 'warn' | 'error'>;

export function createConsoleTransport(): Transport {
  return {
    write(level: LogLevel, message: string | undefined, meta: LogMeta): void {
      const line = JSON.stringify({
        level,
        message,
        time: new Date().toISOString(),
        ...meta,
      });
      console[CONSOLE_METHOD[level]](line);
    },
    flush(): void {},
  };
}
