/**
 * One OAuth refresh against the Kimi Code token endpoint.
 *
 * Protocol (MoonshotAI/kimi-cli `src/kimi_cli/auth/oauth.py`):
 * `POST {oauth_host}/api/oauth/token`, form body `client_id`, `grant_type =
 * refresh_token`, `refresh_token`. 401/403 (and a 4xx `invalid_grant`) means
 * the login is dead; 429 and
 * 5xx are retried up to three times with exponential backoff, like the CLI.
 * Every other failure is reported as transient without a retry.
 *
 * The whole refresh (every attempt, its timeout and the backoff between
 * attempts) ends within {@link KIMI_CODE_REFRESH_DEADLINE_MS}, which is below
 * the refresh lock's stale age: another Ptah process never takes over the
 * lock of a refresh that is still running.
 *
 * SECURITY: never logs the token, the response body or the device id.
 */
import { hostname, release, version as osVersion } from 'node:os';
import axios from 'axios';
import type { Logger } from '@ptah-extension/vscode-core';
import {
  kimiCodeOAuthErrorSchema,
  kimiCodeRefreshResponseSchema,
  type KimiCodeRefreshResponse,
} from './kimi-code-credential.schemas';
import { KIMI_CODE_LOCK_STALE_MS } from './kimi-code-credential-store';

/** OAuth client id of the Kimi Code CLI. */
export const KIMI_CODE_OAUTH_CLIENT_ID = '17e5f671-d194-4dfb-9706-5516cb48c098';
/**
 * Client version announced as `X-Msh-Version`. The CLI sends its own version;
 * this is the CLI release the refresh flow was verified against.
 */
export const KIMI_CODE_CLIENT_VERSION = '2.3.1';
const REFRESH_TIMEOUT_MS = 30_000;
const RETRYABLE_STATUSES: ReadonlySet<number> = new Set([429, 500, 502, 503, 504]);
const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 500;
/** An attempt with less time left than this is not started. */
const MIN_ATTEMPT_MS = 1_000;
/**
 * Upper bound for one `refresh()` call. 20 s below the lock's stale age
 * leaves room for the config reads and the token write under the same lock.
 */
export const KIMI_CODE_REFRESH_DEADLINE_MS = KIMI_CODE_LOCK_STALE_MS - 20_000;

export type KimiCodeRefreshOutcome =
  | { readonly kind: 'ok'; readonly tokens: KimiCodeRefreshResponse }
  | { readonly kind: 'rejected'; readonly status: number }
  | { readonly kind: 'transient'; readonly status?: number };

export interface KimiCodeOAuthRefresherOptions {
  readonly sleep?: (ms: number) => Promise<void>;
  readonly now?: () => number;
}

export class KimiCodeOAuthRefresher {
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;

  constructor(
    private readonly logger: Logger,
    options: KimiCodeOAuthRefresherOptions = {},
  ) {
    this.sleep =
      options.sleep ??
      ((ms) => new Promise<void>((done) => setTimeout(done, ms)));
    this.now = options.now ?? Date.now;
  }

  async refresh(
    refreshToken: string,
    oauthHost: string,
    deviceId: string | undefined,
  ): Promise<KimiCodeRefreshOutcome> {
    const url = `${oauthHost.replace(/\/+$/, '')}/api/oauth/token`;
    const body = new URLSearchParams({
      client_id: KIMI_CODE_OAUTH_CLIENT_ID,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }).toString();
    const headers = {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      ...commonHeaders(deviceId),
    };

    const deadline = this.now() + KIMI_CODE_REFRESH_DEADLINE_MS;
    for (let attempt = 0; ; attempt += 1) {
      const timeoutMs = Math.min(REFRESH_TIMEOUT_MS, deadline - this.now());
      const outcome = await this.attempt(url, body, headers, timeoutMs);
      const retryable =
        outcome.kind === 'transient' &&
        outcome.status !== undefined &&
        RETRYABLE_STATUSES.has(outcome.status);
      const backoffMs = BASE_BACKOFF_MS * 2 ** attempt;
      const outOfTime = deadline - this.now() < backoffMs + MIN_ATTEMPT_MS;
      if (retryable && attempt < MAX_RETRIES && outOfTime) {
        this.logger.info('[KimiCodeAuth] Refresh deadline reached; not retrying');
      }
      if (!retryable || attempt >= MAX_RETRIES || outOfTime) {
        this.logger.info(
          `[KimiCodeAuth] Refresh outcome: ${outcome.kind}${
            outcome.kind !== 'ok' && outcome.status !== undefined
              ? ` (HTTP ${outcome.status})`
              : ''
          }`,
        );
        return outcome;
      }
      await this.sleep(backoffMs);
    }
  }

  private async attempt(
    url: string,
    body: string,
    headers: Record<string, string>,
    timeoutMs: number,
  ): Promise<KimiCodeRefreshOutcome> {
    try {
      const response = await axios.post<unknown>(url, body, {
        headers,
        timeout: timeoutMs,
        // `timeout` is reset by socket activity; the signal bounds the whole
        // request (a server dripping bytes cannot outlast the deadline).
        signal: AbortSignal.timeout(timeoutMs),
        // The body is opaque to logs; never let axios transform it.
        transformResponse: [(data: unknown) => parseJson(data)],
        validateStatus: () => true,
        // The body carries the refresh token: never re-send it to another
        // host. A 3xx then takes the non-200 transient branch below.
        maxRedirects: 0,
      });
      const status = response.status;
      if (status === 401 || status === 403) return { kind: 'rejected', status };
      if (status >= 400 && status < 500) {
        const error = kimiCodeOAuthErrorSchema.safeParse(response.data);
        if (error.success && error.data.error === 'invalid_grant')
          return { kind: 'rejected', status };
      }
      if (status !== 200) return { kind: 'transient', status };
      const parsed = kimiCodeRefreshResponseSchema.safeParse(response.data);
      if (!parsed.success) {
        this.logger.warn(
          '[KimiCodeAuth] Refresh response does not match the expected shape',
        );
        return { kind: 'transient', status };
      }
      return { kind: 'ok', tokens: parsed.data };
    } catch (error: unknown) {
      // degradation-audit: reported - network failures and timeouts become a
      // logged transient outcome; the caller keeps a still-valid token or
      // falls back to the stored key.
      this.logger.warn(
        `[KimiCodeAuth] Refresh request failed (${
          axios.isAxiosError(error) ? (error.code ?? 'network') : 'unknown'
        })`,
      );
      return { kind: 'transient' };
    }
  }
}

function parseJson(data: unknown): unknown {
  if (typeof data !== 'string') return data;
  try {
    return JSON.parse(data);
  } catch {
    // degradation-audit: optional-capability - a non-JSON body fails the
    // schema check that follows and becomes a transient outcome.
    return undefined;
  }
}

/** `X-Msh-*` headers as the Kimi Code CLI sends them, ASCII only. */
function commonHeaders(deviceId: string | undefined): Record<string, string> {
  const headers: Record<string, string> = {
    'X-Msh-Platform': 'kimi_cli',
    'X-Msh-Version': KIMI_CODE_CLIENT_VERSION,
    'X-Msh-Device-Name': asciiHeaderValue(hostname()),
    'X-Msh-Device-Model': asciiHeaderValue(deviceModel()),
    'X-Msh-Os-Version': asciiHeaderValue(osVersion()),
  };
  if (deviceId) headers['X-Msh-Device-Id'] = deviceId;
  return headers;
}

function deviceModel(): string {
  const arch = process.arch;
  if (process.platform === 'darwin') return `macOS ${release()} ${arch}`;
  if (process.platform === 'win32') return `Windows ${release()} ${arch}`;
  return `${process.platform} ${release()} ${arch}`;
}

function asciiHeaderValue(value: string): string {
  const ascii = value.replace(/[^\x20-\x7e]/g, '').trim();
  return ascii.length > 0 ? ascii : 'unknown';
}
