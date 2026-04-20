import fetch from 'node-fetch';
import { Token } from '../models/token';
import { logger } from '../utils/logger';
import { PermanentError } from '../utils/retry';
import config from 'config';

const PERMANENT_AUTH_STATUSES = new Set([400, 401, 403]);

const host = config.get<string>('homely.host');
const uri = `https://${host}/homely`;

class Authentication {
  private token!: Token;

  /**
   * Authenticate with homely and store the token
   * @private
   * @returns {Promise<Token>}
   */
  private async auth() {
    const res = await fetch(`${uri}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: process.env.HOMELY_USER,
        password: process.env.HOMELY_PASSWORD,
      }),
    });
    if (res.status >= 400) {
      let result;
      if (res.headers.get('Content-Type')?.includes('json')) {
        result = await res.json();
      } else {
        result = await res.text();
      }
      logger.error(
        { status: res.status, statusText: res.statusText, result },
        'Homely auth request rejected'
      );
      const message = `Homely auth failed with status ${res.status}: ${res.statusText}`;
      throw PERMANENT_AUTH_STATUSES.has(res.status)
        ? new PermanentError(message)
        : new Error(message);
    }
    const token: Token = await res.json();
    if (!token.expires_in || !token.access_token || !token.refresh_token) {
      const { access_token, refresh_token, ...rest } = token;
      logger.error(
        { object: rest }, // Don't log token out in cleartext
        'Token payload from Homely is missing required fields (access_token, expires_in, refresh_token)'
      );
      throw new PermanentError(
        'Homely auth returned malformed token payload'
      );
    }
    token.exp = Date.now() + token.expires_in * 1000;
    this.token = token;
    logger.info(
      `Authenticated. Token expires at ${new Date(token.exp).toISOString()}`
    );
    return this.token;
  }

  /**
   * Use the refresh token to get a new access token
   * @private
   * @returns {Promise<Token>}
   */
  private async refreshToken() {
    const res = await fetch(`${uri}/oauth/refresh-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        refresh_token: this.token.refresh_token,
      }),
    });
    if (res.status >= 400) {
      throw new Error(
        `Homely refresh-token failed with status ${res.status}: ${res.statusText}`
      );
    }
    const refreshed: Token = await res.json();
    if (
      !refreshed.expires_in ||
      !refreshed.access_token ||
      !refreshed.refresh_token
    ) {
      throw new Error('Homely refresh-token returned malformed token payload');
    }
    refreshed.exp = Date.now() + (refreshed.expires_in - 50) * 1000;
    this.token = refreshed;
    return this.token;
  }

  /**
   * Get the token, either from cache, by refresh-token or by authenticating
   * @returns {Promise<Token>}
   */
  public async getToken() {
    if (this.token && this.token.exp > Date.now()) {
      logger.debug('Using cached token');
      return this.token;
    }
    if (this.token) {
      logger.debug('Refreshing token');
      try {
        return await this.refreshToken();
      } catch (err) {
        logger.warn({ err }, 'Refresh token failed; falling back to full re-auth');
      }
    }
    logger.debug('Authenticating');
    return await this.auth();
  }
}

export const authenticator = new Authentication();
