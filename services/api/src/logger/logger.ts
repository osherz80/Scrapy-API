import { sanitizeMeta } from './redact.ts';
import type { LogContext, LogFn, Logger, LogLevel, LogMeta, Transport } from './types.ts';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  fatal: 50,
};

interface LevelState {
  min: LogLevel;
}

interface Stamp {
  environment: string;
  version: string;
}

export function createLogger(
  transports: readonly Transport[],
  context: LogContext,
  state: LevelState,
  stamp: Stamp,
): Logger {
  const write = (level: LogLevel, first?: unknown, second?: unknown): void => {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[state.min]) return;
    const normalized = normalizeArgs(first, second);
    const meta = {
      ...sanitizeMeta({ ...context, ...normalized.meta }),
      service: 'api',
      environment: stamp.environment,
      version: stamp.version,
    };
    for (const transport of transports) {
      transport.write(level, normalized.message, meta);
    }
  };

  const logger: Logger = {
    debug: write.bind(undefined, 'debug') as LogFn,
    info: write.bind(undefined, 'info') as LogFn,
    warn: write.bind(undefined, 'warn') as LogFn,
    error: write.bind(undefined, 'error') as LogFn,
    fatal: write.bind(undefined, 'fatal') as LogFn,
    child(next: LogContext): Logger {
      return createLogger(transports, { ...context, ...next }, state, stamp);
    },
  };
  return logger;
}

export interface NormalizedArgs {
  message?: string;
  meta: LogMeta;
}

export function normalizeArgs(first: unknown, second: unknown): NormalizedArgs {
  if (first instanceof Error) {
    return {
      message: first.message,
      meta: { ...(isMeta(second) ? second : {}), err: first },
    };
  }
  return {
    message: typeof first === 'string' ? first : typeof second === 'string' ? second : undefined,
    meta: isMeta(first) ? first : isMeta(second) ? second : {},
  };
}

function isMeta(value: unknown): value is LogMeta {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Error);
}
