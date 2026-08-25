/**
 * LoopbackOAuthCallbackListener — the default `IOAuthCallbackListener`.
 *
 * Binds a `127.0.0.1:0` HTTP listener (via the platform `IHttpServerProvider`)
 * to catch the authorization server's `?code=&state=` redirect. Works on every
 * host; it is the fallback when no host-native listener (e.g. the VS Code URI
 * handler) is registered under `PLATFORM_TOKENS.OAUTH_CALLBACK_LISTENER`.
 *
 * The redirect URI is `http://127.0.0.1:<port>/callback`. State-mismatch /
 * error-param / missing-code semantics and the browser-facing HTML are
 * preserved verbatim from the original in-service implementation. This never
 * logs the authorization code or the `state` value.
 */

import type { IncomingMessage, ServerResponse } from 'http';
import type {
  IHttpServerProvider,
  IOAuthCallbackListener,
  OAuthCallbackHandle,
} from '@ptah-extension/platform-core';

export class LoopbackOAuthCallbackListener implements IOAuthCallbackListener {
  constructor(private readonly httpServerProvider: IHttpServerProvider) {}

  /**
   * Bind a loopback listener that resolves with the authorization code once a
   * request carrying the matching `state` arrives.
   */
  async start(expectedState: string): Promise<OAuthCallbackHandle> {
    let resolveCode: (code: string) => void;
    let rejectCode: (err: Error) => void;
    const codePromise = new Promise<string>((resolve, reject) => {
      resolveCode = resolve;
      rejectCode = reject;
    });

    const handle = await this.httpServerProvider.listen(
      '127.0.0.1',
      0,
      (request, response) => {
        const req = request as IncomingMessage;
        const res = response as ServerResponse;
        const query = new URL(req.url ?? '/', 'http://127.0.0.1').searchParams;
        const state = query.get('state');
        const error = query.get('error');
        const code = query.get('code');

        // Ignore stray requests (favicon, etc.) that carry no OAuth params.
        if (!state && !error && !code) {
          res.writeHead(404).end();
          return;
        }
        if (state !== expectedState) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end(HTML_ERROR('Authorization state mismatch.'));
          rejectCode(new Error('OAuth state mismatch on callback.'));
          return;
        }
        if (error) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end(HTML_ERROR(`Authorization failed: ${error}`));
          rejectCode(new Error(`Authorization denied: ${error}`));
          return;
        }
        if (!code) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end(HTML_ERROR('No authorization code returned.'));
          rejectCode(new Error('No authorization code returned.'));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(HTML_SUCCESS);
        resolveCode(code);
      },
    );

    const waitForCode = (timeoutMs: number): Promise<string> => {
      return new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error('Timed out waiting for OAuth authorization.'));
        }, timeoutMs);
        codePromise.then(
          (code) => {
            clearTimeout(timer);
            resolve(code);
          },
          (err) => {
            clearTimeout(timer);
            reject(err);
          },
        );
      });
    };

    return {
      redirectUri: `http://127.0.0.1:${handle.port}/callback`,
      waitForCode,
      close: () => handle.close(),
    };
  }
}

const HTML_SUCCESS =
  '<!doctype html><html><body style="font-family:system-ui;padding:2rem">' +
  '<h2>Connected to Ptah</h2><p>You can close this window and return to Ptah.</p>' +
  '</body></html>';

function HTML_ERROR(message: string): string {
  const safe = message.replace(/[<>&]/g, '');
  return (
    '<!doctype html><html><body style="font-family:system-ui;padding:2rem">' +
    `<h2>Connection failed</h2><p>${safe}</p><p>You can close this window.</p>` +
    '</body></html>'
  );
}
