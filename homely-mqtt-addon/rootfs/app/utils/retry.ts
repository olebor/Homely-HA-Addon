import { logger } from './logger';

export interface RetryOptions {
  label: string;
  initialDelayMs?: number;
  maxDelayMs?: number;
  maxAttempts?: number;
  factor?: number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  opts: RetryOptions
): Promise<T> {
  const initialDelayMs = opts.initialDelayMs ?? 2_000;
  const maxDelayMs = opts.maxDelayMs ?? 300_000;
  const maxAttempts = opts.maxAttempts ?? Infinity;
  const factor = opts.factor ?? 2;

  let attempt = 0;
  let delay = initialDelayMs;

  while (true) {
    attempt++;
    try {
      return await fn();
    } catch (err) {
      if (attempt >= maxAttempts) {
        logger.error(
          `[${opts.label}] giving up after ${attempt} attempts: ${err}`
        );
        throw err;
      }
      const jitter = 1 + (Math.random() * 0.4 - 0.2);
      const waitMs = Math.min(Math.round(delay * jitter), maxDelayMs);
      logger.warn(
        `[${opts.label}] attempt ${attempt} failed: ${err}. Retrying in ${waitMs}ms.`
      );
      await sleep(waitMs);
      delay = Math.min(delay * factor, maxDelayMs);
    }
  }
}
