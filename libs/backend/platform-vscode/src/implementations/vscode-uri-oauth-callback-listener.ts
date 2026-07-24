/**
 * VscodeUriOAuthCallbackListener — VS Code native URI-handler implementation of
 * `IOAuthCallbackListener`.
 *
 * Instead of a loopback HTTP server, this captures the OAuth redirect through
 * VS Code's `window.registerUriHandler`, so the redirect target is a
 * `vscode://<publisher>.<name>/oauth-callback` deep link. `asExternalUri`
 * rewrites it for Remote-SSH / Codespaces / web hosts, which the loopback
 * cannot reach.
 *
 * This is a long-lived singleton: it registers ONE shared URI handler in its
 * constructor and multiplexes concurrent flows by PKCE `state`. Per-flow
 * `close()` only drops that flow's waiter; the shared handler is torn down when
 * the whole listener is disposed (extension deactivate).
 *
 * It is registered under `PLATFORM_TOKENS.OAUTH_CALLBACK_LISTENER` ONLY in the
 * VS Code host; Electron / CLI leave the token unregistered and fall back to the
 * loopback. This class never logs the authorization code or the `state` value.
 */

import * as vscode from 'vscode';
import type {
  IOAuthCallbackListener,
  OAuthCallbackHandle,
} from '@ptah-extension/platform-core';

/** `${publisher}.${name}` from `apps/ptah-extension-vscode/package.json`. */
const DEFAULT_AUTHORITY = 'ptah-extensions.ptah-coding-orchestra';
const CALLBACK_PATH = 'oauth-callback';

interface Waiter {
  resolve(code: string): void;
  reject(err: Error): void;
}

export class VscodeUriOAuthCallbackListener
  implements IOAuthCallbackListener, vscode.Disposable
{
  /** In-flight authorization waiters, keyed by PKCE `state`. */
  private readonly waiters = new Map<string, Waiter>();
  private readonly registration: vscode.Disposable;

  constructor(private readonly authority: string = DEFAULT_AUTHORITY) {
    this.registration = vscode.window.registerUriHandler({
      handleUri: (uri) => this.handleUri(uri),
    });
  }

  /**
   * Arm a capture for one flow. Builds the `vscode://…/oauth-callback` deep
   * link, resolves it through `asExternalUri` (remote-aware), and registers a
   * waiter under `expectedState`.
   */
  async start(expectedState: string): Promise<OAuthCallbackHandle> {
    const base = vscode.Uri.parse(
      `${vscode.env.uriScheme}://${this.authority}/${CALLBACK_PATH}`,
    );
    const redirectUri = (await vscode.env.asExternalUri(base)).toString();

    let resolveCode: (code: string) => void;
    let rejectCode: (err: Error) => void;
    const codePromise = new Promise<string>((resolve, reject) => {
      resolveCode = resolve;
      rejectCode = reject;
    });
    this.waiters.set(expectedState, {
      resolve: (code) => resolveCode(code),
      reject: (err) => rejectCode(err),
    });

    const waitForCode = (timeoutMs: number): Promise<string> =>
      new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => {
          this.waiters.delete(expectedState);
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

    // Per-flow cleanup only — never disposes the shared URI handler.
    const close = async (): Promise<void> => {
      this.waiters.delete(expectedState);
    };

    return { redirectUri, waitForCode, close };
  }

  /** Tear down the shared URI handler and abandon any pending waiters. */
  dispose(): void {
    this.registration.dispose();
    this.waiters.clear();
  }

  /**
   * Route an incoming `vscode://…/oauth-callback?state=&code=` deep link to its
   * waiter. No-ops when the `state` is absent or already settled.
   */
  private handleUri(uri: vscode.Uri): void {
    const params = new URLSearchParams(uri.query);
    const state = params.get('state');
    if (!state) return;
    const waiter = this.waiters.get(state);
    if (!waiter) return;
    this.waiters.delete(state);

    const error = params.get('error');
    if (error) {
      waiter.reject(new Error(`Authorization denied: ${error}`));
      return;
    }
    const code = params.get('code');
    if (!code) {
      waiter.reject(new Error('No authorization code returned.'));
      return;
    }
    waiter.resolve(code);
  }
}
