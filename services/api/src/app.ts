import { randomUUID } from 'node:crypto';

import Fastify, { LogController, type FastifyInstance } from 'fastify';

import type { AppConfig } from './config.ts';
import { BODY_LIMIT_BYTES, errorBody, HttpError, mapError } from './http/errors.ts';
import type { Logger } from './logger/types.ts';

export interface BuildAppOptions {
  config: AppConfig;
  logger: Logger;
}

declare module 'fastify' {
  interface FastifyRequest {
    observation: {
      queryType: string | null;
      resultCount: number | null;
    };
  }
}

export function buildApp(options: BuildAppOptions): FastifyInstance {
  const { logger } = options;
  const observations = new WeakMap<
    object,
    { queryType: string | null; resultCount: number | null }
  >();
  const app = Fastify({
    bodyLimit: BODY_LIMIT_BYTES,
    logger: false,
    logController: new LogController({ disableRequestLogging: true }),
    genReqId: () => randomUUID(),
    ajv: {
      customOptions: {
        allErrors: true,
        coerceTypes: false,
        removeAdditional: false,
      },
    },
  });

  app.decorateRequest('observation', {
    getter(this: object) {
      const current = observations.get(this);
      if (current) return current;
      const created = { queryType: null, resultCount: null };
      observations.set(this, created);
      return created;
    },
    setter(this: object, value: { queryType: string | null; resultCount: number | null }) {
      observations.set(this, value);
    },
  });

  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });

  app.addHook('onResponse', async (request, reply) => {
    logger.info('request', {
      requestId: request.id,
      endpoint: `${request.method} ${request.routeOptions.url ?? request.url}`,
      durationMs: reply.elapsedTime,
      status: reply.statusCode,
      queryType: request.observation.queryType,
      resultCount: request.observation.resultCount,
    });
  });

  app.setNotFoundHandler((request, reply) => {
    const mapped = mapError(new HttpError(404, 'NOT_FOUND', 'Not found'));
    return reply.code(mapped.statusCode).send(errorBody(mapped, request.id));
  });

  app.setErrorHandler((error, request, reply) => {
    const mapped = mapError(error);
    const logged = error instanceof Error ? error : new Error('Unexpected failure');
    logger.error(logged, { requestId: request.id, status: mapped.statusCode, code: mapped.code });
    if (mapped.retryAfterSeconds !== undefined) {
      reply.header('retry-after', String(mapped.retryAfterSeconds));
    }
    return reply.code(mapped.statusCode).send(errorBody(mapped, request.id));
  });

  app.get('/health/live', {
    schema: {
      response: {
        200: {
          type: 'object',
          additionalProperties: false,
          required: ['status'],
          properties: { status: { const: 'ok' } },
        },
      },
    },
  }, async () => ({ status: 'ok' as const }));

  return app;
}
