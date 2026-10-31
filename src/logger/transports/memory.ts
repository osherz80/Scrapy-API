import type { LogLevel, LogMeta, Transport } from '../types.ts';

export interface LogRecord {
  level: LogLevel;
  message: string | undefined;
  meta: LogMeta;
}

export interface MemoryTransport extends Transport {
  records: LogRecord[];
}

export function createMemoryTransport(): MemoryTransport {
  const records: LogRecord[] = [];
  return {
    records,
    write(level: LogLevel, message: string | undefined, meta: LogMeta): void {
      records.push({ level, message, meta: { ...meta } });
    },
    flush(): void {},
  };
}
