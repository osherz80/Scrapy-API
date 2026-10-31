import { pathToFileURL } from 'node:url';

import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';
import { createLoggerFactory } from './logger/factory.ts';
import { createConsoleTransport } from './logger/transports/console.ts';

export async function start(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const config = loadConfig(env);
  const factory = createLoggerFactory({
    level: config.logLevel,
    environment: config.logEnv,
    version: config.appVersion,
    transports: [createConsoleTransport()],
  });
  const logger = factory.create();
  const app = buildApp({ config, logger });
  let closing = false;
  const shutdown = async (): Promise<void> => {
    if (closing) return;
    closing = true;
    await app.close();
    await factory.shutdown();
  };
  process.once('SIGTERM', () => {
    void shutdown();
  });
  process.once('SIGINT', () => {
    void shutdown();
  });
  await app.listen({ port: config.port, host: config.host });
  logger.info('listening', { port: config.port });
}

function invokedDirectly(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(entry).href;
}

if (invokedDirectly()) {
  start().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Startup failed';
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
