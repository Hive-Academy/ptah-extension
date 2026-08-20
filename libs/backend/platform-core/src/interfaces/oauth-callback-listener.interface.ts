/**
 * IOAuthCallbackListener — platform-agnostic OAuth redirect-capture port.
 *
 * The interactive MCP OAuth flow needs to catch the authorization server's
 * `?code=&state=` redirect. Two mechanisms satisfy this contract:
 *
 *   1. A loopback HTTP listener on `127.0.0.1:0` (the default, works on every
 *      host — `LoopbackOAuthCallbackListener` in `cli-agent-runtime`).
 *   2. A VS Code native URI handler (`vscode://publisher.name/oauth-callback`)
 *      registered only in the extension host and resolvable through
 *      `asExternalUri` for Remote-SSH / Codespaces
 *      (`VscodeUriOAuthCallbackListener` in `platform-vscode`).
 *
 * Selection is purely DI: the VS Code host registers
 * `PLATFORM_TOKENS.OAUTH_CALLBACK_LISTENER`; Electron and CLI do not, so
 * `McpOAuthService` falls back to the loopback. Nothing branches on the host.
 *
 * Implementations MUST NOT log the authorization code or the `state` value.
 */

/**
 * A single armed callback awaiting one authorization redirect for a specific
 * `state`. Obtained from {@link IOAuthCallbackListener.start}. The caller
 * always invokes `close()` (in a `finally`) once the flow settles.
 */
export interface OAuthCallbackHandle {
  /**
   * The redirect URI to hand to the authorization server. For the loopback
   * this is `http://127.0.0.1:<port>/callback`; for the VS Code URI handler
   * it is the `asExternalUri`-resolved `vscode://…/oauth-callback`.
   */
  readonly redirectUri: string;
  /**
   * Resolve with the authorization code once the matching redirect arrives.
   * Rejects on `state` mismatch, an `error` param, a missing code, or after
   * `timeoutMs` elapses.
   */
  waitForCode(timeoutMs: number): Promise<string>;
  /**
   * Release the resources for this flow (stop the loopback server / drop the
   * waiter). Idempotent. MUST NOT tear down any long-lived shared registration.
   */
  close(): Promise<void>;
}

/**
 * IOAuthCallbackListener — starts one redirect capture per `connect()` flow.
 */
export interface IOAuthCallbackListener {
  /**
   * Arm a capture keyed by the PKCE `state`. Returns a handle carrying the
   * `redirectUri` to send to the authorization server.
   */
  start(expectedState: string): Promise<OAuthCallbackHandle>;
}
