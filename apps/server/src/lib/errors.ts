import type { ApiError } from '@siege/shared';

const STATUS_BY_CODE: Record<ApiError['code'], number> = {
  INSUFFICIENT_RESOURCES: 409,
  UNMET_PREREQUISITE: 409,
  QUEUE_FULL: 409,
  INVALID_STATE: 409,
  CONFLICT: 409,
  PERMISSION_DENIED: 403,
  VALIDATION_FAILED: 400,
  RATE_LIMITED: 429,
  NOT_FOUND: 404,
  UNAUTHENTICATED: 401,
  INTERNAL: 500
};

/** Domain error that maps 1:1 to the structured ApiError contract. */
export class AppError extends Error {
  readonly code: ApiError['code'];
  readonly details: Record<string, unknown> | undefined;

  constructor(code: ApiError['code'], message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.details = details;
  }

  get statusCode(): number {
    return STATUS_BY_CODE[this.code];
  }

  toApiError(): ApiError {
    return this.details !== undefined
      ? { code: this.code, message: this.message, details: this.details }
      : { code: this.code, message: this.message };
  }
}
