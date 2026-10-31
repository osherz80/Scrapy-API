export const BODY_LIMIT_BYTES = 64 * 1024;

export interface FieldDetail {
  path: string;
}

export interface ErrorResponseBody {
  error: {
    code: string;
    message: string;
    details?: FieldDetail[];
  };
  requestId: string;
}

export class HttpError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details: FieldDetail[] | undefined;
  readonly retryAfterSeconds: number | undefined;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    details?: FieldDetail[],
    retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

interface ValidationIssue {
  instancePath?: string;
  message?: string;
  params?: Record<string, unknown>;
}

interface ThrownHttpError {
  statusCode?: number;
  code?: string;
  message?: string;
  validation?: ValidationIssue[];
}

export interface MappedError {
  statusCode: number;
  code: string;
  message: string;
  details?: FieldDetail[];
  retryAfterSeconds?: number;
}

export function mapError(error: unknown): MappedError {
  if (error instanceof HttpError) {
    return {
      statusCode: error.statusCode,
      code: error.code,
      message: error.message,
      ...(error.details ? { details: error.details } : {}),
      ...(error.retryAfterSeconds !== undefined
        ? { retryAfterSeconds: error.retryAfterSeconds }
        : {}),
    };
  }

  const thrown = isRecord(error) ? (error as ThrownHttpError) : {};
  if (thrown.code === 'FST_ERR_CTP_BODY_TOO_LARGE' || thrown.statusCode === 413) {
    return {
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'request body exceeds 64 KiB',
    };
  }
  if (thrown.code === 'FST_ERR_CTP_INVALID_JSON' || thrown.code === 'FST_ERR_CTP_INVALID_JSON_BODY') {
    return {
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'request body must be valid JSON',
    };
  }
  if (Array.isArray(thrown.validation)) {
    const details = thrown.validation.map((issue) => ({ path: validationPath(issue) }));
    const first = thrown.validation[0]?.message;
    return {
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: first ? `Invalid request: ${first}` : 'Invalid request',
      details,
    };
  }

  const status = thrown.statusCode;
  if (status === 400) {
    return { statusCode: 400, code: 'VALIDATION_ERROR', message: 'Invalid request' };
  }
  if (status === 401) {
    return { statusCode: 401, code: 'UNAUTHORIZED', message: 'Missing or invalid credential' };
  }
  if (status === 403) {
    return { statusCode: 403, code: 'FORBIDDEN', message: 'Credential is not allowed for this route' };
  }
  if (status === 404) {
    return { statusCode: 404, code: 'NOT_FOUND', message: 'Not found' };
  }
  if (status === 409) {
    return { statusCode: 409, code: 'CONFLICT', message: 'Request conflicts with an active refresh' };
  }
  if (status === 429) {
    return { statusCode: 429, code: 'RATE_LIMITED', message: 'Rate limit exceeded' };
  }
  if (status === 503) {
    return { statusCode: 503, code: 'UNAVAILABLE', message: 'Service unavailable' };
  }
  return { statusCode: 500, code: 'INTERNAL_ERROR', message: 'Unexpected failure' };
}

export function errorBody(mapped: MappedError, requestId: string): ErrorResponseBody {
  return {
    error: {
      code: mapped.code,
      message: mapped.message,
      ...(mapped.details ? { details: mapped.details } : {}),
    },
    requestId,
  };
}

function validationPath(issue: ValidationIssue): string {
  const additional = issue.params?.additionalProperty;
  if (typeof additional === 'string') return additional;
  const missing = issue.params?.missingProperty;
  if (typeof missing === 'string') return missing;
  return (issue.instancePath ?? '').replace(/^\//, '').replaceAll('/', '.');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
