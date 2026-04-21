import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildConfigMock } from '../__test__/mock-config';

const fetchMock = vi.fn();
const loggerMocks = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: vi.fn(),
};

vi.mock('node-fetch', () => ({ default: fetchMock }));
vi.mock('config', () => buildConfigMock());
vi.mock('../utils/logger', () => ({ logger: loggerMocks }));

type TokenPayload = Partial<{
  access_token: string;
  refresh_token: string;
  expires_in: number;
  refresh_expires_in: number;
  token_type: string;
  scope: string;
  session_state: string;
  'not-before-policy': number;
}>;

const jsonResponse = (status: number, body: unknown) => ({
  status,
  statusText: status >= 400 ? 'Error' : 'OK',
  headers: {
    get: (name: string) => (name.toLowerCase() === 'content-type' ? 'application/json' : null),
  },
  json: async () => body,
  text: async () => JSON.stringify(body),
});

const textResponse = (status: number, body: string) => ({
  status,
  statusText: status >= 400 ? 'Error' : 'OK',
  headers: {
    get: () => 'text/plain',
  },
  json: async () => ({}),
  text: async () => body,
});

const validToken = (override: TokenPayload = {}): TokenPayload => ({
  access_token: 'access-1',
  refresh_token: 'refresh-1',
  expires_in: 3600,
  refresh_expires_in: 7200,
  token_type: 'Bearer',
  scope: 'read',
  session_state: 'state',
  'not-before-policy': 0,
  ...override,
});

// Auth keeps module-level singleton state; reset modules per test to get a clean instance.
const loadAuth = async () => {
  vi.resetModules();
  return await import('./auth');
};

describe('Authentication.getToken', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    fetchMock.mockReset();
    Object.values(loggerMocks).forEach((m) => m.mockReset());
    process.env.HOMELY_USER = 'user';
    process.env.HOMELY_PASSWORD = 'pass';
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('authenticates on first call and stores the token with computed exp', async () => {
    const { authenticator } = await loadAuth();
    fetchMock.mockResolvedValueOnce(jsonResponse(200, validToken({ expires_in: 3600 })));

    const token = await authenticator.getToken();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toContain('/oauth/token');
    expect(token.access_token).toBe('access-1');
    // exp = now + expires_in * 1000
    expect(token.exp).toBe(Date.parse('2026-01-01T00:00:00Z') + 3600 * 1000);
  });

  it('returns the cached token on the second call without hitting the network', async () => {
    const { authenticator } = await loadAuth();
    fetchMock.mockResolvedValueOnce(jsonResponse(200, validToken({ expires_in: 3600 })));
    await authenticator.getToken();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Advance less than expires_in
    vi.advanceTimersByTime(60_000);
    const cached = await authenticator.getToken();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(cached.access_token).toBe('access-1');
  });

  it('calls the refresh-token endpoint once the cached token has expired', async () => {
    const { authenticator } = await loadAuth();
    fetchMock.mockResolvedValueOnce(jsonResponse(200, validToken({ expires_in: 10 })));
    await authenticator.getToken();

    // Move past expiry
    vi.advanceTimersByTime(11_000);
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, validToken({ access_token: 'access-2', refresh_token: 'refresh-2' }))
    );

    const refreshed = await authenticator.getToken();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const refreshCall = (fetchMock.mock.calls[1] as unknown as [string])[0];
    expect(refreshCall).toContain('/oauth/refresh-token');
    expect(refreshed.access_token).toBe('access-2');
  });

  it('falls back to full re-auth when refresh-token fails', async () => {
    const { authenticator } = await loadAuth();
    fetchMock.mockResolvedValueOnce(jsonResponse(200, validToken({ expires_in: 10 })));
    await authenticator.getToken();

    vi.advanceTimersByTime(11_000);
    fetchMock.mockResolvedValueOnce(textResponse(500, 'refresh down'));
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, validToken({ access_token: 'access-3', refresh_token: 'refresh-3' }))
    );

    const token = await authenticator.getToken();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const urls = (fetchMock.mock.calls as unknown as [string][]).map((c) => c[0]);
    expect(urls[1]).toContain('/oauth/refresh-token');
    expect(urls[2]).toContain('/oauth/token');
    expect(token.access_token).toBe('access-3');
    expect(loggerMocks.warn).toHaveBeenCalled();
  });

  it.each([400, 401, 403])('throws PermanentError on %s from /oauth/token', async (status) => {
    const { authenticator } = await loadAuth();
    const { PermanentError } = await import('../utils/retry');
    fetchMock.mockResolvedValueOnce(jsonResponse(status, { error: 'bad' }));
    await expect(authenticator.getToken()).rejects.toBeInstanceOf(PermanentError);
  });

  it('throws a retryable Error on 500 from /oauth/token', async () => {
    const { authenticator } = await loadAuth();
    const { PermanentError } = await import('../utils/retry');
    fetchMock.mockResolvedValueOnce(textResponse(500, 'boom'));
    const err = await authenticator.getToken().catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(PermanentError);
  });

  it('throws PermanentError and redacts secrets when the payload is malformed', async () => {
    const { authenticator } = await loadAuth();
    const { PermanentError } = await import('../utils/retry');
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        // missing access_token
        refresh_token: 'r',
        expires_in: 3600,
      })
    );

    await expect(authenticator.getToken()).rejects.toBeInstanceOf(PermanentError);

    const logCall = loggerMocks.error.mock.calls.find(
      (call) => typeof call[0] === 'object' && call[0] && 'object' in call[0]
    );
    expect(logCall).toBeDefined();
    const logged = (logCall as unknown as [{ object: Record<string, unknown> }])[0].object;
    expect(logged).not.toHaveProperty('access_token');
    expect(logged).not.toHaveProperty('refresh_token');
  });

  it('refresh-token returning a malformed payload throws and triggers full re-auth next call', async () => {
    const { authenticator } = await loadAuth();
    fetchMock.mockResolvedValueOnce(jsonResponse(200, validToken({ expires_in: 10 })));
    await authenticator.getToken();

    vi.advanceTimersByTime(11_000);
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { access_token: 'only-access', expires_in: 3600 })
    );
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, validToken({ access_token: 'recovered', refresh_token: 'r2' }))
    );

    const token = await authenticator.getToken();
    expect(token.access_token).toBe('recovered');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

