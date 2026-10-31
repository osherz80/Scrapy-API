import type { FastifyInstance } from 'fastify';

import { HttpError } from '../http/errors.ts';

export function registerReady(app: FastifyInstance, readyCheck: () => Promise<boolean>): void {
  app.get('/health/ready', async () => {
    const ready = await readyCheck().catch(() => false);
    if (!ready) throw new HttpError(503, 'UNAVAILABLE', 'Database unavailable', undefined, 5);
    return { status: 'ok' as const };
  });
}
