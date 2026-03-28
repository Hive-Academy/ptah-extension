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
 */
import axios from 'axios';
import type { Logger } from '@ptah-extension/vscode-core';

/** GitHub's OAuth App client ID for Copilot (used by VS Code, opencode, etc.) */
const GITHUB_COPILOT_CLIENT_ID = 'Iv1.b507a08c87ecfe98';

/** Device code endpoint */
const DEVICE_CODE_URL = 'https://github.com/login/device/code';

/** Token polling endpoint */
const TOKEN_URL = 'https://github.com/login/oauth/access_token';

/** Maximum polling time before giving up (5 minutes) */
const MAX_POLL_TIME_MS = 5 * 60 * 1000;

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
 * Execute the GitHub Device Code OAuth flow.
 *
 * @param logger - Logger for diagnostic output
 * @param callbacks - Callbacks for user interaction (display code, open browser)
 * @returns GitHub OAuth access token, or null if flow was cancelled/timed out
 */
export async function executeDeviceCodeFlow(
  logger: Logger,
  callbacks: DeviceCodeCallbacks,
): Promise<string | null> {
  // Step 1: Request device code
  logger.info('[CopilotDeviceAuth] Starting GitHub device code flow...');

  const { data: deviceCodeResponse } = await axios.post<DeviceCodeResponse>(
    DEVICE_CODE_URL,
    new URLSearchParams({
      client_id: GITHUB_COPILOT_CLIENT_ID,
      scope: 'copilot',
    }),
    {
      headers: { Accept: 'application/json' },
      timeout: 15_000,
    },
  );

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

  // Step 3: Poll for access token
  let pollInterval = Math.max(deviceCodeResponse.interval, 5) * 1000; // minimum 5s
  const startTime = Date.now();

  while (Date.now() - startTime < MAX_POLL_TIME_MS) {
    await new Promise((resolve) => setTimeout(resolve, pollInterval));

    try {
      const { data: tokenResponse } = await axios.post<{
        access_token?: string;
        error?: string;
        error_description?: string;
      }>(
        TOKEN_URL,
        new URLSearchParams({
          client_id: GITHUB_COPILOT_CLIENT_ID,
          device_code: deviceCodeResponse.device_code,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        }),
        {
          headers: { Accept: 'application/json' },
          timeout: 15_000,
        },
      );

      if (tokenResponse.access_token) {
        logger.info(
          '[CopilotDeviceAuth] Device code flow completed successfully',
        );
        return tokenResponse.access_token;
      }

      if (tokenResponse.error === 'authorization_pending') {
        // User hasn't completed auth yet, continue polling
        continue;
      }

      if (tokenResponse.error === 'slow_down') {
        // Increase polling interval per RFC 8628
        pollInterval += 5000;
        continue;
      }

      if (tokenResponse.error === 'expired_token') {
        logger.warn('[CopilotDeviceAuth] Device code expired');
        return null;
      }

      if (tokenResponse.error === 'access_denied') {
        logger.warn('[CopilotDeviceAuth] User denied access');
        return null;
      }

      // Unknown error
      logger.warn(
        `[CopilotDeviceAuth] Unexpected error: ${tokenResponse.error} - ${tokenResponse.error_description}`,
      );
      return null;
    } catch (error) {
      logger.warn(
        `[CopilotDeviceAuth] Poll request failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      // Continue polling on network errors
    }
  }

  logger.warn('[CopilotDeviceAuth] Device code flow timed out');
  return null;
}
