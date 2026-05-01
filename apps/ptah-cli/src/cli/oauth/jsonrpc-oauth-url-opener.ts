/**
 * JsonRpcOAuthUrlOpener — IOAuthUrlOpener implementation that routes to the
 * connected JSON-RPC client via an outbound `oauth.url.open` request.
 *
 * Used by `ptah interact` (where stdio is attached to a JSON-RPC peer) and by
 * `ptah auth login` when a JSON-RPC peer is detected.
 *
 * Hard 5-second timeout — if the client does not respond, returns
 * `{ opened: false }` so the caller can fall back to its own messaging
 * strategy (typically a stderr URL print).
 *
 * TASK_2026_104 Batch 8c.
 */

import type { IOAuthUrlOpener } from '@ptah-extension/platform-cli';
import type { JsonRpcServer } from '../jsonrpc/server.js';

/** Hard cap for the JSON-RPC `oauth.url.open` round-trip. */
const OAUTH_URL_OPEN_TIMEOUT_MS = 5_000;

interface OAuthUrlOpenResponse {
  opened: boolean;
  code?: string;
}

export class JsonRpcOAuthUrlOpener implements IOAuthUrlOpener {
  constructor(private readonly jsonRpcServer: JsonRpcServer) {}

  async openOAuthUrl(params: {
    provider: string;
    verificationUri: string;
    userCode?: string;
  }): Promise<{ opened: boolean; code?: string }> {
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<OAuthUrlOpenResponse>((_, reject) => {
      timeoutHandle = setTimeout(
        () => reject(new Error('oauth.url.open timeout')),
        OAUTH_URL_OPEN_TIMEOUT_MS,
      );
    });

    try {
      const response = await Promise.race([
        this.jsonRpcServer.request<OAuthUrlOpenResponse>(
          'oauth.url.open',
          params,
        ),
        timeout,
      ]);
      return {
        opened: Boolean(response.opened),
        code: response.code,
      };
    } catch {
      // Timeout, transport error, or client rejected — caller will fall back.
      return { opened: false };
    } finally {
      if (timeoutHandle !== undefined) {
        clearTimeout(timeoutHandle);
      }
    }
  }
}
