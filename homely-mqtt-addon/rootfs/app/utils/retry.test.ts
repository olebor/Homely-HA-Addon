import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PermanentError, retryWithBackoff, STARTUP_RETRY, WS_RETRY } from './retry';

vi.mock('./logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
  },
}));

describe('retryWithBackoff', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.5); // jitter factor = 1.0
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('returns immediately when fn resolves on the first attempt', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    await expect(retryWithBackoff(fn, { label: 'first-try' })).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries transient failures and returns the eventual success', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue('ok');

    const promise = retryWithBackoff(fn, {
      label: 'transient',
      initialDelayMs: 100,
      factor: 2,
    });

    // First attempt happens synchronously; drive timers for the next two.
    await vi.advanceTimersByTimeAsync(100); // wait before attempt 2
    await vi.advanceTimersByTimeAsync(200); // wait before attempt 3
    await expect(promise).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('fast-fails on PermanentError without retrying', async () => {
    const fn = vi.fn().mockRejectedValue(new PermanentError('nope'));
    await expect(retryWithBackoff(fn, { label: 'perm' })).rejects.toBeInstanceOf(PermanentError);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('respects a custom isRetryable that rejects everything', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('x'));
    await expect(
      retryWithBackoff(fn, { label: 'custom-perm', isRetryable: () => false })
    ).rejects.toThrow('x');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('gives up after maxAttempts', async () => {
    const err = new Error('always fails');
    const fn = vi.fn().mockRejectedValue(err);

    const promise = retryWithBackoff(fn, {
      label: 'max-attempts',
      initialDelayMs: 10,
      factor: 2,
      maxAttempts: 3,
    });
    // Swallow the eventual rejection so Node doesn't flag it before we assert.
    const settled = promise.catch((e) => e);

    await vi.advanceTimersByTimeAsync(10); // wait before attempt 2
    await vi.advanceTimersByTimeAsync(20); // wait before attempt 3
    await expect(settled).resolves.toBe(err);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('grows the delay exponentially by factor', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('x'));
    const setTimeoutSpy = vi.spyOn(global, 'setTimeout');

    const settled = retryWithBackoff(fn, {
      label: 'exp',
      initialDelayMs: 100,
      factor: 3,
      maxAttempts: 4,
    }).catch((e) => e);

    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(300);
    await vi.advanceTimersByTimeAsync(900);
    await settled;

    const delays = setTimeoutSpy.mock.calls.map(([, ms]) => ms);
    expect(delays).toEqual([100, 300, 900]);
  });

  it('caps the wait at maxDelayMs', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('x'));
    const setTimeoutSpy = vi.spyOn(global, 'setTimeout');

    const settled = retryWithBackoff(fn, {
      label: 'cap',
      initialDelayMs: 1_000,
      factor: 10,
      maxDelayMs: 2_500,
      maxAttempts: 4,
    }).catch((e) => e);

    await vi.advanceTimersByTimeAsync(1_000);
    await vi.advanceTimersByTimeAsync(2_500);
    await vi.advanceTimersByTimeAsync(2_500);
    await settled;

    const delays = setTimeoutSpy.mock.calls.map(([, ms]) => ms);
    expect(delays).toEqual([1_000, 2_500, 2_500]);
  });

  it('keeps jitter within ±20% of the current delay', async () => {
    // Drop our default stub so we can set per-call jitter values.
    vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0) // lowest jitter → 0.8
      .mockReturnValueOnce(1); // highest jitter → 1.2

    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('x'))
      .mockRejectedValueOnce(new Error('x'))
      .mockResolvedValue('ok');

    const setTimeoutSpy = vi.spyOn(global, 'setTimeout');

    const promise = retryWithBackoff(fn, {
      label: 'jitter',
      initialDelayMs: 1_000,
      factor: 1, // hold delay constant so jitter is visible
    });

    await vi.advanceTimersByTimeAsync(1_000);
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(promise).resolves.toBe('ok');

    const delays = setTimeoutSpy.mock.calls.map(([, ms]) => ms);
    expect(delays[0]).toBe(800);
    expect(delays[1]).toBe(1_200);
  });
});

describe('retry tuning constants', () => {
  it('exposes websocket-retry defaults', () => {
    expect(WS_RETRY.initialDelayMs).toBeGreaterThan(0);
    expect(WS_RETRY.maxDelayMs).toBeGreaterThanOrEqual(WS_RETRY.initialDelayMs);
  });

  it('exposes startup-retry defaults', () => {
    expect(STARTUP_RETRY.initialDelayMs).toBeGreaterThan(0);
    expect(STARTUP_RETRY.maxDelayMs).toBeGreaterThanOrEqual(STARTUP_RETRY.initialDelayMs);
  });
});

describe('PermanentError', () => {
  it('has the expected name and extends Error', () => {
    const err = new PermanentError('boom');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('PermanentError');
    expect(err.message).toBe('boom');
  });
});
