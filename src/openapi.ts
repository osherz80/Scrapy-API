export function openApiDocument(): Record<string, unknown> {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Supermarket API',
      version: '0.1.0',
      description:
        'Sampled retail price estimates for ten Israeli chains. This service has no HTTP credential. Search, refresh, and status are process-wide routes.',
    },
    paths: {
      '/health/live': { get: { operationId: 'live', responses: { '200': { description: 'Process is up' } } } },
      '/health/ready': { get: { operationId: 'ready', responses: { '200': { description: 'Database accepts a check' }, '503': { description: 'Database unavailable' } } } },
      '/v1/search': { get: { operationId: 'search', parameters: searchParameters, responses: okArray } },
      '/v1/search/batch': { post: { operationId: 'searchBatch', responses: { '200': { description: 'Results in request order' } } } },
      '/v1/refreshes': {
        post: {
          operationId: 'createRefresh',
          responses: {
            '202': { description: 'Run admitted. dispatchState is ACKNOWLEDGED or UNCERTAIN' },
            '409': { description: 'A requested chain already has an active run' },
            '503': { description: 'Dispatch is not configured or GitHub rejected it' },
          },
        },
      },
      '/v1/refreshes/{runId}': { get: { operationId: 'getRefresh', responses: { '200': { description: 'Run status' }, '404': { description: 'Unknown run' } } } },
      '/v1/chains': { get: { operationId: 'listChains', responses: { '200': { description: 'Chain publication status' } } } },
    },
    components: {
      schemas: {
        Error: {
          type: 'object',
          required: ['error', 'requestId'],
          properties: {
            error: {
              type: 'object',
              required: ['code', 'message'],
              properties: {
                code: { type: 'string' },
                message: { type: 'string' },
                details: { type: 'array', items: { type: 'object' } },
              },
            },
            requestId: { type: 'string' },
          },
        },
      },
    },
  };
}

const searchParameters = [
  { name: 'queryType', in: 'query', required: true, schema: { enum: ['name', 'sku'] } },
  { name: 'q', in: 'query', required: true, schema: { type: 'string', minLength: 1, maxLength: 200 } },
  { name: 'limitPerChain', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 10, default: 1 } },
];

const okArray = { '200': { description: 'Matching products, or an empty array' } };
