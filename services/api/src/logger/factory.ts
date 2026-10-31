import { createLogger } from './logger.ts';
import type { LogContext, LogLevel, Logger, LoggerFactory, Transport } from './types.ts';

export interface LoggerFactoryOptions {
  level: LogLevel;
  environment: string;
  version: string;
  transports: readonly Transport[];
}

export function createLoggerFactory(options: LoggerFactoryOptions): LoggerFactory {
  const state = { min: options.level };
  const stamp = { environment: options.environment, version: options.version };
  let closed = false;
  return {
    create(context: LogContext = {}): Logger {
      return createLogger(options.transports, context, state, stamp);
    },
    async shutdown(): Promise<void> {
      if (closed) return;
      closed = true;
      for (const transport of options.transports) {
        await transport.flush?.();
      }
    },
  };
}
