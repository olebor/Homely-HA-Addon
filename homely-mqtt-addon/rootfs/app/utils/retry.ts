import { logger } from './logger';

/**
 * Error that should bypass retry loops. Thrown for non-recoverable upstream
 * failures (bad credentials, malformed responses) so retry helpers fail fast
 * instead of spinning forever.
 */
export class PermanentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentError';
  }
}

export interface RetryOptions {
  label: string;
  initialDelayMs?: number;
  maxDelayMs?: number;
  maxAttempts?: number;
  factor?: number;
  isRetryable?: (err: unknown) => boolean;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const defaultIsRetryable = (err: unknown) => !(err instanceof PermanentError);

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  opts: RetryOptions
): Promise<T> {
  const initialDelayMs = opts.initialDelayMs ?? 2_000;
  const maxDelayMs = opts.maxDelayMs ?? 300_000;
  const maxAttempts = opts.maxAttempts ?? Infinity;
  const factor = opts.factor ?? 2;
  const isRetryable = opts.isRetryable ?? defaultIsRetryable;

  let attempt = 0;
  let delay = initialDelayMs;

  while (true) {
    attempt++;
    try {
      return await fn();
    } catch (err) {
      if (!isRetryable(err)) {
        logger.error(
          { err, label: opts.label, attempts: attempt },
          'permanent error; not retrying'
        );
        throw err;
      }
      if (attempt >= maxAttempts) {
        logger.error(
          { err, label: opts.label, attempts: attempt },
          'giving up after exhausting retries'
        );
        throw err;
      }
      const jitter = 1 + (Math.random() * 0.4 - 0.2);
      const waitMs = Math.min(Math.round(delay * jitter), maxDelayMs);
      logger.warn(
        { err, label: opts.label, attempt, waitMs },
        'retry attempt failed'
      );
      await sleep(waitMs);
      delay = Math.min(delay * factor, maxDelayMs);
    }
  }
}

/** Tuning for websocket connect / reconnect loops. */
export const WS_RETRY = {
  initialDelayMs: 2_000,
  maxDelayMs: 300_000,
} as const;

/** Tuning for startup HTTP calls to the Homely cloud. */
export const STARTUP_RETRY = {
  initialDelayMs: 5_000,
  maxDelayMs: 300_000,
} as const;
