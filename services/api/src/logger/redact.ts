import type { LogMeta } from './types.ts';

const SENSITIVE_KEY = /authorization|cookie|password|token|secret/i;
const CREDENTIAL_IN_TEXT = /:\/\/[^\s/@]+(?::[^\s/@]*)?@/g;

export function sanitizeMeta(meta: LogMeta): LogMeta {
  const copy: LogMeta = { ...meta };
  delete copy.q;
  delete copy.query;
  return redactValue(copy, 0) as LogMeta;
}

export function scrubText(value: string): string {
  return value.replace(CREDENTIAL_IN_TEXT, '://[redacted]@');
}

function redactValue(value: unknown, depth: number): unknown {
  if (depth > 12) return '[truncated]';
  if (value instanceof Error) {
    return { name: value.name, message: scrubText(value.message) };
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactValue(entry, depth + 1));
  }
  if (value !== null && typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (key === 'q' || key === 'query') continue;
      output[key] = SENSITIVE_KEY.test(key) ? '[redacted]' : redactValue(entry, depth + 1);
    }
    return output;
  }
  if (typeof value === 'string') return scrubText(value);
  return value;
}
