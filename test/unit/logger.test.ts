import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createLoggerFactory } from '../../src/logger/factory.ts';
import { createConsoleTransport } from '../../src/logger/transports/console.ts';
import { createMemoryTransport } from '../../src/logger/transports/memory.ts';

function factory(level: 'debug' | 'info' = 'debug') {
  const memory = createMemoryTransport();
  const loggers = createLoggerFactory({
    level,
    environment: 'test',
    version: 'v-test',
    transports: [memory],
  });
  return { memory, logger: loggers.create(), loggers };
}

test('accepts message-first, meta-first, and error-first calls', () => {
  const { memory, logger } = factory();
  logger.info('hello', { requestId: '1' });
  logger.info({ requestId: '2' }, 'again');
  logger.error(new Error('boom'), { requestId: '3' });

  assert.equal(memory.records[0]?.message, 'hello');
  assert.equal(memory.records[0]?.meta.requestId, '1');
  assert.equal(memory.records[1]?.message, 'again');
  assert.equal(memory.records[1]?.meta.requestId, '2');
  assert.equal(memory.records[2]?.message, 'boom');
  assert.deepEqual(memory.records[2]?.meta.err, { name: 'Error', message: 'boom' });
  assert.equal(JSON.stringify(memory.records[2]?.meta).includes('stack'), false);
});

test('stamps service identity and merges child context', () => {
  const { memory, logger } = factory();
  logger.child({ requestId: 'req-1', service: 'worker' }).info('child');
  const meta = memory.records[0]?.meta;
  assert.equal(meta?.service, 'api');
  assert.equal(meta?.environment, 'test');
  assert.equal(meta?.version, 'v-test');
  assert.equal(meta?.requestId, 'req-1');
});

test('drops query text and redacts credentials before the transport', () => {
  const { memory, logger } = factory();
  logger.info('search', {
    q: 'milk',
    query: 'milk',
    nested: { authorization: 'Bearer secret', cookie: 'sid', password: 'pw', token: 't' },
    note: 'postgresql://user:secret@db.example/postgres',
  });
  const meta = memory.records[0]?.meta;
  assert.equal('q' in (meta ?? {}), false);
  assert.equal('query' in (meta ?? {}), false);
  assert.deepEqual(meta?.nested, {
    authorization: '[redacted]',
    cookie: '[redacted]',
    password: '[redacted]',
    token: '[redacted]',
  });
  assert.equal(meta?.note, 'postgresql://[redacted]@db.example/postgres');
});

test('filters records below the configured level', () => {
  const { memory, logger } = factory('info');
  logger.debug('hidden');
  logger.info('visible');
  assert.deepEqual(memory.records.map((record) => record.message), ['visible']);
});

test('fatal uses console.error and console flush is a no-op', async () => {
  const lines: string[] = [];
  const original = console.error;
  console.error = (line?: unknown) => {
    lines.push(String(line));
  };
  try {
    const transport = createConsoleTransport();
    const loggers = createLoggerFactory({
      level: 'debug',
      environment: 'test',
      version: 'v-test',
      transports: [transport],
    });
    loggers.create().fatal('down', { token: 'secret' });
    await transport.flush?.();
    await loggers.shutdown();
    await loggers.shutdown();
    assert.equal(lines.length, 1);
    const parsed = JSON.parse(lines[0] ?? '{}') as { level: string; token: string };
    assert.equal(parsed.level, 'fatal');
    assert.equal(parsed.token, '[redacted]');
  } finally {
    console.error = original;
  }
});
