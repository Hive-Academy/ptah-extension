/**
 * McpOAuthService — interactive OAuth 2.0 authorization-code + PKCE flow for
 * connecting remote MCP servers in-app.
 *
 * Flow (connect):
 *   1. Discover the authorization server (RFC 9728) + its metadata (RFC 8414).
 *   2. Arm an `IOAuthCallbackListener` for the redirect (loopback by default,
 *      or a host-native listener such as the VS Code URI handler when injected).
 *   3. Dynamically register a public client (RFC 7591) for the redirect URI.
 *   4. Generate PKCE (S256) + open the authorize URL in the system browser.
 *   5. Catch the `?code=&state=` redirect, validate `state`, exchange the code
 *      (+ verifier) for tokens, and store them encrypted.
 *
 * Tokens are never written to disk config — only non-secret metadata goes to
 * the plaintext manifest. Errors are sanitized by the caller before crossing
 * the RPC boundary; this service never logs a token.
 */

import type {
  IHttpServerProvider,
  IOAuthCallbackListener,
} from '@ptah-extension/platform-core';
import type { McpOAuthConnectionState } from '@ptah-extension/shared';
import { LoopbackOAuthCallbackListener } from './loopback-oauth-callback-listener';
import { generatePkceChallenge } from './pkce';
import {
  discoverAuthorizationServer,
  discoverAuthServerMetadata,
  registerClient,
  type FetchLike,
} from './mcp-oauth-metadata';
import type {
  McpOAuthTokenRecord,
  McpOAuthTokenStore,
} from './mcp-oauth-token-store';
import type { McpOAuthInstalledManifestStore } from './mcp-oauth-installed-manifest';

/** Refresh the access token when it expires within this window. */
const EXPIRY_SKEW_MS = 60_000;
/** Give the user this long to complete the browser authorization. */
const DEFAULT_CALLBACK_TIMEOUT_MS = 5 * 60 * 1000;

export interface McpOAuthLogger {
  debug(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
}

export interface McpOAuthServiceDeps {
  /**
   * Loopback HTTP provider backing the default redirect capture. Required by
   * `connect()` UNLESS a `callbackListener` is supplied (a host-native listener
   * such as the VS Code URI handler). The query-time token paths
   * (`getFreshAccessToken`, `refresh`, `status`) do not use it, so resolver-only
   * callers may omit it.
   */
  httpServerProvider?: IHttpServerProvider;
  /**
   * Optional host-native redirect capture (e.g. the VS Code URI handler,
   * injected via `PLATFORM_TOKENS.OAUTH_CALLBACK_LISTENER`). When present it
   * replaces the loopback for `connect()`; when absent `connect()` builds a
   * `LoopbackOAuthCallbackListener` from `httpServerProvider`.
   */
  callbackListener?: IOAuthCallbackListener;
  /**
   * Open a URL in the user's browser (from `IUserInteraction.openExternal`).
   * Required by `connect()` only.
   */
  openExternal?(url: string): Promise<boolean>;
  tokenStore: McpOAuthTokenStore;
  manifest: McpOAuthInstalledManifestStore;
  fetchImpl?: FetchLike;
  logger?: McpOAuthLogger;
  /** Injectable clock for tests. */
  now?: () => number;
  callbackTimeoutMs?: number;
}

export interface ConnectOptions {
  serverUrl: string;
  name?: string;
  serverKey?: string;
  scope?: string;
  /**
   * Pre-registered OAuth client id, used when the authorization server does not
   * support dynamic client registration (no `registration_endpoint`).
   */
  clientId?: string;
  /**
   * Optional pre-registered client secret for confidential clients. Kept
   * in-memory during the flow and persisted only in the encrypted token record.
   */
  clientSecret?: string;
}

/** Build a stable, filesystem/config-safe key from a server URL. */
export function deriveMcpOAuthServerKey(serverUrl: string): string {
  const u = new URL(serverUrl);
  const raw = `${u.host}${u.pathname}`.replace(/\/+$/, '');
  const slug = raw
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
  return `oauth-${slug}`;
}

export class McpOAuthService {
  private readonly httpServerProvider?: IHttpServerProvider;
  private readonly callbackListener?: IOAuthCallbackListener;
  private readonly openExternal?: (url: string) => Promise<boolean>;
  private readonly tokenStore: McpOAuthTokenStore;
  private readonly manifest: McpOAuthInstalledManifestStore;
  private readonly fetchImpl: FetchLike;
  private readonly logger?: McpOAuthLogger;
  private readonly now: () => number;
  private readonly callbackTimeoutMs: number;

  constructor(deps: McpOAuthServiceDeps) {
    this.httpServerProvider = deps.httpServerProvider;
    this.callbackListener = deps.callbackListener;
    this.openExternal = deps.openExternal;
    this.tokenStore = deps.tokenStore;
    this.manifest = deps.manifest;
    this.fetchImpl =
      deps.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
    this.logger = deps.logger;
    this.now = deps.now ?? (() => Date.now());
    this.callbackTimeoutMs =
      deps.callbackTimeoutMs ?? DEFAULT_CALLBACK_TIMEOUT_MS;
  }

  /**
   * Run the full interactive connect flow. Resolves with the serverKey once the
   * token is stored; rejects on any failure (caller maps to an error envelope).
   */
  async connect(options: ConnectOptions): Promise<{ serverKey: string }> {
    const openExternal = this.openExternal;
    // A host-native callbackListener (e.g. the VS Code URI handler) makes the
    // loopback httpServerProvider unnecessary; otherwise it is required.
    if (!this.callbackListener && !this.httpServerProvider) {
      throw new Error(
        'McpOAuthService.connect requires a callbackListener or an httpServerProvider (interactive host only).',
      );
    }
    if (!openExternal) {
      throw new Error(
        'McpOAuthService.connect requires openExternal (interactive host only).',
      );
    }
    const serverUrl = options.serverUrl;
    const serverKey =
      options.serverKey?.trim() || deriveMcpOAuthServerKey(serverUrl);
    const name = options.name?.trim() || new URL(serverUrl).host;

    const authServer = await discoverAuthorizationServer(
      serverUrl,
      this.fetchImpl,
    );
    const meta = await discoverAuthServerMetadata(authServer, this.fetchImpl);

    const pkce = generatePkceChallenge();

    // Arm the redirect capture BEFORE building the redirect URI. Prefer an
    // injected host-native listener; otherwise fall back to the loopback.
    const listener =
      this.callbackListener ??
      new LoopbackOAuthCallbackListener(
        this.httpServerProvider as IHttpServerProvider,
      );
    const callback = await listener.start(pkce.state);
    try {
      const redirectUri = callback.redirectUri;

      let clientId: string;
      let clientSecret: string | undefined;
      const preRegisteredClientId = options.clientId?.trim();
      if (meta.registrationEndpoint) {
        const registered = await registerClient(
          meta.registrationEndpoint,
          redirectUri,
          this.fetchImpl,
        );
        clientId = registered.clientId;
        clientSecret = registered.clientSecret;
      } else if (preRegisteredClientId) {
        // Pre-registered client path (RFC 7591 not supported by this server).
        clientId = preRegisteredClientId;
        clientSecret = options.clientSecret;
      } else {
        throw new Error(
          'This authorization server requires a pre-registered client ID (it does not support dynamic client registration). Provide a Client ID to continue.',
        );
      }

      const scope = options.scope ?? meta.scopesSupported?.join(' ');
      const authorizeUrl = this.buildAuthorizeUrl(meta.authorizationEndpoint, {
        clientId,
        redirectUri,
        codeChallenge: pkce.codeChallenge,
        state: pkce.state,
        scope,
        resource: serverUrl,
      });

      await openExternal(authorizeUrl);
      this.logger?.debug('MCP OAuth: awaiting authorization callback', {
        serverKey,
      });

      const code = await callback.waitForCode(this.callbackTimeoutMs);

      const token = await this.exchangeCode({
        tokenEndpoint: meta.tokenEndpoint,
        code,
        redirectUri,
        codeVerifier: pkce.codeVerifier,
        clientId,
        clientSecret,
        scope,
        resource: serverUrl,
      });

      await this.tokenStore.setToken(serverKey, token);
      this.manifest.record({ serverKey, name, serverUrl });
      this.logger?.debug('MCP OAuth: connected', { serverKey });
      return { serverKey };
    } finally {
      await callback.close();
    }
  }

  /** Report the connection state for a server (never returns a token). */
  async status(serverKey: string): Promise<McpOAuthConnectionState> {
    if (!this.manifest.has(serverKey)) return 'disconnected';
    const token = await this.tokenStore.getToken(serverKey);
    if (!token) return 'disconnected';
    if (
      token.expiresAt &&
      token.expiresAt <= this.now() &&
      !token.refreshToken
    ) {
      return 'expired';
    }
    return 'connected';
  }

  /** Delete the tokens and manifest record for a server. */
  async disconnect(serverKey: string): Promise<void> {
    this.manifest.remove(serverKey);
    await this.tokenStore.deleteToken(serverKey);
  }

  /**
   * Return a currently-valid access token for a server, refreshing it when it
   * is within the expiry skew. Returns null when disconnected or unrefreshable.
   * Used by the query-time override resolver.
   */
  async getFreshAccessToken(serverKey: string): Promise<string | null> {
    const token = await this.tokenStore.getToken(serverKey);
    if (!token) return null;
    if (token.expiresAt && token.expiresAt - this.now() < EXPIRY_SKEW_MS) {
      const refreshed = await this.refresh(serverKey);
      return refreshed?.accessToken ?? null;
    }
    return token.accessToken;
  }

  /** Exchange the stored refresh token for a new access token. */
  async refresh(serverKey: string): Promise<McpOAuthTokenRecord | null> {
    const token = await this.tokenStore.getToken(serverKey);
    if (!token?.refreshToken) return null;

    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: token.refreshToken,
      client_id: token.clientId,
    });
    if (token.clientSecret) body.set('client_secret', token.clientSecret);

    let resp: Awaited<ReturnType<FetchLike>>;
    try {
      resp = await this.fetchImpl(token.tokenEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: body.toString(),
      });
    } catch (error: unknown) {
      this.logger?.warn('MCP OAuth: refresh request failed', {
        serverKey,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
    if (!resp.ok) {
      this.logger?.warn('MCP OAuth: refresh rejected', {
        serverKey,
        status: resp.status,
      });
      return null;
    }

    const data = asRecord(await resp.json());
    const accessToken = str(data['access_token']);
    if (!accessToken) return null;
    const expiresIn = num(data['expires_in']);
    const updated: McpOAuthTokenRecord = {
      ...token,
      accessToken,
      refreshToken: str(data['refresh_token']) ?? token.refreshToken,
      expiresAt: expiresIn ? this.now() + expiresIn * 1000 : undefined,
      scope: str(data['scope']) ?? token.scope,
    };
    await this.tokenStore.setToken(serverKey, updated);
    return updated;
  }

  private buildAuthorizeUrl(
    endpoint: string,
    params: {
      clientId: string;
      redirectUri: string;
      codeChallenge: string;
      state: string;
      scope?: string;
      resource: string;
    },
  ): string {
    const url = new URL(endpoint);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', params.clientId);
    url.searchParams.set('redirect_uri', params.redirectUri);
    url.searchParams.set('code_challenge', params.codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('state', params.state);
    // RFC 8707 resource indicator — binds the token to this MCP server.
    url.searchParams.set('resource', params.resource);
    if (params.scope) url.searchParams.set('scope', params.scope);
    return url.toString();
  }

  private async exchangeCode(input: {
    tokenEndpoint: string;
    code: string;
    redirectUri: string;
    codeVerifier: string;
    clientId: string;
    clientSecret?: string;
    scope?: string;
    resource: string;
  }): Promise<McpOAuthTokenRecord> {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code: input.code,
      redirect_uri: input.redirectUri,
      client_id: input.clientId,
      code_verifier: input.codeVerifier,
      resource: input.resource,
    });
    if (input.clientSecret) body.set('client_secret', input.clientSecret);

    const resp = await this.fetchImpl(input.tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: body.toString(),
    });
    if (!resp.ok) {
      throw new Error(`Token exchange failed (HTTP ${resp.status}).`);
    }
    const data = asRecord(await resp.json());
    const accessToken = str(data['access_token']);
    if (!accessToken) {
      throw new Error('Token response did not include an access_token.');
    }
    const expiresIn = num(data['expires_in']);
    return {
      accessToken,
      refreshToken: str(data['refresh_token']),
      expiresAt: expiresIn ? this.now() + expiresIn * 1000 : undefined,
      tokenEndpoint: input.tokenEndpoint,
      clientId: input.clientId,
      clientSecret: input.clientSecret,
      scope: str(data['scope']) ?? input.scope,
    };
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}
