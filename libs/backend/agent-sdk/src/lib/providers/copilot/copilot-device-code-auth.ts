/**
 * Copilot Device Code Auth - GitHub Device Code Flow (RFC 8628)
 *
 * For Electron and other non-VS Code environments where the user
 * doesn't have a pre-existing GitHub token file.
 *
 * Flow:
 * 1. POST /login/device/code -> get user_code, verification_uri, device_code, interval
 * 2. Display user_code + verification_uri to user (via IUserInteraction)
 * 3. Poll POST /login/oauth/access_token with device_code until user completes browser auth
 * 4. Return access_token (GitHub OAuth token)
 *
 * The caller then exchanges this token for a Copilot bearer token
 * via the existing exchangeToken() method.
 *
 * TASK_2026_104 B8a: Split into `requestDeviceCode` + `pollForAccessToken`
 * to support the headless CLI's non-blocking begin/poll/cancel API.
 * `executeDeviceCodeFlow` is preserved as a thin wrapper composing both,
 * so existing callers (CopilotAuthService.login) see no behavior change.
 */
import axios from 'axios';
import type { Logger } from '@ptah-extension/vscode-core';

/** Device code endpoint */
const DEVICE_CODE_URL = 'https://github.com/login/device/code';

/** Token polling endpoint */
const TOKEN_URL = 'https://github.com/login/oauth/access_token';

/** Maximum polling time before giving up (5 minutes) */
const MAX_POLL_TIME_MS = 5 * 60 * 1000;

/** Minimum polling interval per RFC 8628 / GitHub docs */
const MIN_POLL_INTERVAL_MS = 5_000;

/** RFC 8628 slow_down increment */
const SLOW_DOWN_INCREMENT_MS = 5_000;

export interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

export interface DeviceCodeCallbacks {
  /** Called with the user code and verification URL for display to the user */
  onUserCode: (userCode: string, verificationUri: string) => void;
  /** Called when the user should open a URL in their browser */
  openBrowser?: (url: string) => Promise<void>;
}

/**
 * Options for the access-token polling loop.
 *
 * - `intervalMs`: starting poll interval. Floored to {@link MIN_POLL_INTERVAL_MS}.
 *   `slow_down` responses add {@link SLOW_DOWN_INCREMENT_MS} to the running interval.
 * - `timeoutMs`: hard cap for the entire polling loop. Defaults to 5 minutes.
 * - `signal`: optional `AbortSignal`. Aborting causes `pollForAccessToken` to
 *   resolve with `null` (treated like a user cancel) without throwing.
 * - `logger`: optional `Logger`. When provided, the polling loop emits the
 *   same diagnostic messages the legacy `executeDeviceCodeFlow` always has
 *   (`Device code expired`, `User denied access`, `Poll request failed`,
 *   unknown error description). Headless CLI callers omit this so they can
 *   route diagnostics through structured JSON-RPC notifications instead.
 */
export interface PollForAccessTokenOptions {
  intervalMs?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  logger?: Logger;
}

/**
 * Step 1 of the device-code flow: request a fresh device code from GitHub.
 *
 * This performs only the initial POST to `/login/device/code`. The caller is
 * responsible for surfacing the user code + verification URI to the end user
 * and then driving {@link pollForAccessToken} until the user completes the
 * browser authorization (or the flow times out).
 *
 * @param clientId - GitHub OAuth App client ID for the device code request.
 * @returns The full device-code response payload (device_code, user_code,
 *          verification_uri, interval, expires_in). Throws on network failure
 *          so callers can apply their own logging / retry policy.
 */
export async function requestDeviceCode(
  clientId: string,
): Promise<DeviceCodeResponse> {
  const { data } = await axios.post<DeviceCodeResponse>(
    DEVICE_CODE_URL,
    new URLSearchParams({
      client_id: clientId,
      scope: 'copilot',
    }),
    {
      headers: { Accept: 'application/json' },
      timeout: 15_000,
    },
  );
  return data;
}

/**
 * Step 2 of the device-code flow: poll GitHub for the access token.
 *
 * Implements RFC 8628 polling semantics:
 *   - `authorization_pending`  → continue polling silently.
 *   - `slow_down`              → add 5s to the polling interval.
 *   - `expired_token`          → resolve `null` (caller surfaces the failure).
 *   - `access_denied`          → resolve `null` (user denied access).
 *   - any other error code     → resolve `null` (defensive: never invent a token).
 *   - transient network errors → continue polling.
 *
 * The minimum effective polling interval is {@link MIN_POLL_INTERVAL_MS} (5s)
 * regardless of any smaller value passed via `opts.intervalMs`. This matches
 * GitHub's published guidance and protects against accidental rate-limiting.
 *
 * @param deviceCode - The `device_code` returned by {@link requestDeviceCode}.
 * @param clientId   - The same GitHub OAuth App client ID used for the request.
 * @param opts       - See {@link PollForAccessTokenOptions}.
 * @returns The GitHub OAuth access token on success, or `null` if the flow
 *          was cancelled, expired, denied, aborted, or timed out.
 */
export async function pollForAccessToken(
  deviceCode: string,
  clientId: string,
  opts: PollForAccessTokenOptions = {},
): Promise<string | null> {
  const timeoutMs = opts.timeoutMs ?? MAX_POLL_TIME_MS;
  let pollInterval = Math.max(
    opts.intervalMs ?? MIN_POLL_INTERVAL_MS,
    MIN_POLL_INTERVAL_MS,
  );
  const startTime = Date.now();
  const signal = opts.signal;
  const logger = opts.logger;

  while (Date.now() - startTime < timeoutMs) {
    if (signal?.aborted) {
      return null;
    }

    // Wait for the polling interval, but bail early if the abort signal fires.
    const aborted = await waitOrAbort(pollInterval, signal);
    if (aborted) {
      return null;
    }

    try {
      const { data: tokenResponse } = await axios.post<{
        access_token?: string;
        error?: string;
        error_description?: string;
      }>(
        TOKEN_URL,
        new URLSearchParams({
          client_id: clientId,
          device_code: deviceCode,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        }),
        {
          headers: { Accept: 'application/json' },
          timeout: 15_000,
        },
      );

      if (tokenResponse.access_token) {
        return tokenResponse.access_token;
      }

      if (tokenResponse.error === 'authorization_pending') {
        continue;
      }

      if (tokenResponse.error === 'slow_down') {
        pollInterval += SLOW_DOWN_INCREMENT_MS;
        continue;
      }

      if (tokenResponse.error === 'expired_token') {
        logger?.warn('[CopilotDeviceAuth] Device code expired');
        return null;
      }

      if (tokenResponse.error === 'access_denied') {
        logger?.warn('[CopilotDeviceAuth] User denied access');
        return null;
      }

      logger?.warn(
        `[CopilotDeviceAuth] Unexpected error: ${tokenResponse.error} - ${tokenResponse.error_description}`,
      );
      return null;
    } catch (error) {
      logger?.warn(
        `[CopilotDeviceAuth] Poll request failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      // Continue polling on network errors — GitHub may be transiently flaky.
    }
  }

  return null;
}

/**
 * Wait for `ms` milliseconds OR until the provided AbortSignal fires.
 *
 * Returns `true` if the wait was aborted, `false` if it completed normally.
 * Used by {@link pollForAccessToken} so the polling loop can respond to
 * `cancelLogin` without waiting out the full polling interval.
 */
function waitOrAbort(
  ms: number,
  signal: AbortSignal | undefined,
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    if (signal?.aborted) {
      resolve(true);
      return;
    }
    const timer = setTimeout(() => {
      if (signal) {
        signal.removeEventListener('abort', onAbort);
      }
      resolve(false);
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      resolve(true);
    };
    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

/**
 * Execute the GitHub Device Code OAuth flow end-to-end.
 *
 * This is now a thin wrapper around {@link requestDeviceCode} and
 * {@link pollForAccessToken}, preserved so existing callers
 * (CopilotAuthService.login, callers in tests) continue to work unchanged
 * after the B8a split.
 *
 * @param logger - Logger for diagnostic output
 * @param callbacks - Callbacks for user interaction (display code, open browser)
 * @param clientId - GitHub OAuth App client ID for the device code request
 * @returns GitHub OAuth access token, or null if flow was cancelled/timed out
 */
export async function executeDeviceCodeFlow(
  logger: Logger,
  callbacks: DeviceCodeCallbacks,
  clientId: string,
): Promise<string | null> {
  // Step 1: Request device code
  logger.info('[CopilotDeviceAuth] Starting GitHub device code flow...');
  const deviceCodeResponse = await requestDeviceCode(clientId);

  // Step 2: Display code to user
  callbacks.onUserCode(
    deviceCodeResponse.user_code,
    deviceCodeResponse.verification_uri,
  );

  // Optionally open browser
  if (callbacks.openBrowser) {
    try {
      await callbacks.openBrowser(deviceCodeResponse.verification_uri);
    } catch {
      // Browser open is best-effort
    }
  }

  // Step 3: Poll for access token. Pass logger through so the legacy log
  // surface (Device code expired / User denied access / Poll request failed)
  // is preserved for existing spec assertions and webview UX diagnostics.
  const intervalMs = Math.max(deviceCodeResponse.interval, 5) * 1000;
  const startTime = Date.now();
  const result = await pollForAccessToken(
    deviceCodeResponse.device_code,
    clientId,
    {
      intervalMs,
      timeoutMs: MAX_POLL_TIME_MS,
      logger,
    },
  );

  if (result === null) {
    // Only emit the "timed out" warn when polling actually exhausted its
    // budget — terminal errors (expired_token / access_denied / unknown) have
    // already been logged inside pollForAccessToken and should not surface
    // a misleading "timed out" message on top.
    if (Date.now() - startTime >= MAX_POLL_TIME_MS) {
      logger.warn('[CopilotDeviceAuth] Device code flow timed out');
    }
    return null;
  }

  logger.info('[CopilotDeviceAuth] Device code flow completed successfully');
  return result;
}
