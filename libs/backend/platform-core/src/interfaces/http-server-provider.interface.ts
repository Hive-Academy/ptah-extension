/**
 * IHttpServerProvider — platform-agnostic HTTP server interface.
 *
 * Pure interface: no Node `http` imports, no platform coupling. The CLI
 * implementation (`CliHttpServerProvider`) wraps `node:http`, while VS Code /
 * Electron / browser environments may register stubs that throw or no-op (the
 * proxy command is CLI-only today).
 *
 * The provider is intentionally minimal — `listen` returns a handle with a
 * `close()` method and nothing else. Per-request mechanics (headers, body,
 * SSE framing) are handled by the consumer using the platform-native request
 * / response objects, which the consumer obtains via the provider-specific
 * `RequestHandler` signature.
 *
 * Why this lives in `platform-core` rather than the proxy service:
 *   1. Keeps `proxy/anthropic-proxy.service.ts` test-mockable without
 *      stubbing `node:http`.
 *   2. Lets future platforms (e.g. an Electron-backed proxy) bind the same
 *      contract without touching the proxy service.
 *
 * The `request` / `response` types are intentionally `unknown` at the
 * interface boundary — the consumer narrows to `node:http.IncomingMessage` /
 * `node:http.ServerResponse` after registration. This keeps the interface
 * dependency-free for the WebView / Angular layer that re-exports
 * `platform-core`.
 */

/**
 * Per-request handler callback. The provider invokes this on every inbound
 * HTTP request. The consumer is responsible for writing the response.
 *
 * Implementations MUST treat thrown errors as 500 Internal Server Error and
 * log them — they MUST NOT propagate to the listener loop.
 */
export type HttpServerRequestHandler = (
  request: unknown,
  response: unknown,
) => void | Promise<void>;

/**
 * Active HTTP server handle returned by `listen`. The consumer calls
 * `close()` to stop accepting new connections and drain in-flight responses.
 *
 * `close()` MUST be idempotent — calling it twice resolves on the second
 * call without throwing. The provider is free to drop already-established
 * keep-alive connections after a short grace period.
 */
export interface IHttpServerHandle {
  /** Resolved port the server is actually bound to (useful when port is 0). */
  readonly port: number;
  /** Bound host. */
  readonly host: string;
  /** Stop accepting new connections and drain. Idempotent. */
  close(): Promise<void>;
}

/**
 * IHttpServerProvider — platform-agnostic HTTP server abstraction.
 */
export interface IHttpServerProvider {
  /**
   * Bind a TCP listener on `host:port` and route every request through
   * `handler`. Pass `port: 0` to let the OS assign a free port — the
   * actual bound port is returned via `IHttpServerHandle.port`.
   *
   * Throws on bind failure (`EADDRINUSE`, `EACCES`, etc.) — callers should
   * map these to the `proxy_bind_failed` PtahErrorCode.
   */
  listen(
    host: string,
    port: number,
    handler: HttpServerRequestHandler,
  ): Promise<IHttpServerHandle>;
}
