/**
 * ITracer — platform port for performance tracing / spans.
 *
 * Domain libs (memory-curator, etc.) depend on this interface only and never
 * import `@sentry/*` directly. Adapters live in the platform/host layer:
 *   - `SentryTracerAdapter` (vscode-core) delegates to `SentryService`.
 *   - `NoopTracer` (vscode-core) is a dependency-free passthrough.
 */
export interface ITracer {
  startSpan<T>(
    name: string,
    attributes: Record<string, string | number | boolean>,
    fn: () => T,
  ): T;

  addBreadcrumb(
    category: string,
    message: string,
    data?: Record<string, unknown>,
  ): void;
}
