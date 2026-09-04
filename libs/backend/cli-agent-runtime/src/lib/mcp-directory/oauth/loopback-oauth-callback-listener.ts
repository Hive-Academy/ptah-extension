/**
 * LoopbackOAuthCallbackListener — the default `IOAuthCallbackListener`.
 *
 * Binds a `127.0.0.1` HTTP listener (via the platform `IHttpServerProvider`) on
 * the fixed {@link MCP_OAUTH_LOOPBACK_PORT} to catch the authorization server's
 * `?code=&state=` redirect. Works on every host; it is the fallback when no
 * host-native listener (e.g. the VS Code URI handler) is registered under
 * `PLATFORM_TOKENS.OAUTH_CALLBACK_LISTENER`.
 *
 * The redirect URI is `http://127.0.0.1:<port>/callback`. State-mismatch /
 * error-param / missing-code semantics and the browser-facing HTML are
 * preserved verbatim from the original in-service implementation. This never
 * logs the authorization code or the `state` value.
 */

import type { IncomingMessage, ServerResponse } from 'http';
import type {
  HttpServerRequestHandler,
  IHttpServerHandle,
  IHttpServerProvider,
  IOAuthCallbackListener,
  OAuthCallbackHandle,
} from '@ptah-extension/platform-core';

/**
 * The loopback port Ptah asks for first.
 *
 * It is FIXED, not ephemeral, because an authorization server that does not
 * implement RFC 7591 (dynamic client registration) only accepts a redirect URL
 * the user registered with the provider ahead of time — HubSpot is the
 * canonical example. A port chosen at bind time can never match a URL written
 * down in advance, so `127.0.0.1:0` made the pre-registered-client path
 * impossible on every non-VS-Code host. The value is above the ephemeral range
 * on Windows and Linux and is not assigned to a known service.
 */
export const MCP_OAUTH_LOOPBACK_PORT = 41739;

export class LoopbackOAuthCallbackListener implements IOAuthCallbackListener {
  constructor(
    private readonly httpServerProvider: IHttpServerProvider,
    private readonly port: number = MCP_OAUTH_LOOPBACK_PORT,
  ) {}

  /**
   * The redirect URI a `start()` on the fixed port produces. Binds nothing, so
   * the UI can show it while no flow is running. When the fixed port turns out
   * to be busy, `start()` falls back to an ephemeral one and the armed handle's
   * `redirectUri` differs from this — `McpOAuthService` compares the two and
   * refuses the pre-registered-client flow rather than sending a URL the
   * provider will reject.
   */
  async describeRedirectUri(): Promise<string> {
    return `http://127.0.0.1:${this.port}/callback`;
  }

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

    const onRequest: HttpServerRequestHandler = (request, response) => {
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
    };

    // The fixed port is what makes a pre-registered redirect URL possible, but
    // it is not guaranteed free. Fall back to an ephemeral port so the
    // dynamic-registration flows — which register whatever URL they are given —
    // keep working when something else holds it. No logger reaches this class;
    // the mismatch is surfaced by `McpOAuthService`, which can compare the
    // armed URI against `describeRedirectUri()`.
    const handle = await this.listenOrFallback(onRequest);

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

  /**
   * Bind the fixed port, or an OS-assigned one when it is taken. The bind
   * failure is deliberately swallowed rather than logged: this class takes no
   * logger, and the only consequence a caller cares about — the armed URI no
   * longer matching the one the user registered — is observable by comparing
   * the handle against `describeRedirectUri()`.
   */
  private async listenOrFallback(
    handler: HttpServerRequestHandler,
  ): Promise<IHttpServerHandle> {
    try {
      return await this.httpServerProvider.listen(
        '127.0.0.1',
        this.port,
        handler,
      );
    } catch {
      return await this.httpServerProvider.listen('127.0.0.1', 0, handler);
    }
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
