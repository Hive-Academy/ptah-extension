import { InjectionToken, Provider } from '@angular/core';

/**
 * Base URL of the license-server API.
 *
 * Everything that needs to reach the backend reads this token instead of the
 * app's `environments/environment` file. That is what lets the HTTP plumbing
 * live in a lib: `environments/` stays in the app (it is swapped at build time
 * by the `fileReplacements` in the app's build target), and the app hands the
 * value over at bootstrap.
 *
 * Values in practice:
 * - development / checkout builds: `''` (same origin, the CLI proxy forwards)
 * - production build: `'https://api.ptah.live'` (no trailing slash)
 *
 * The default factory returns `''` so unit tests and SSR render passes that
 * never call {@link provideApiBaseUrl} fall back to same-origin behaviour
 * rather than blowing up with a NullInjectorError.
 */
export const API_BASE_URL = new InjectionToken<string>('WEB_API_BASE_URL', {
  providedIn: 'root',
  factory: () => '',
});

/**
 * Provider factory for {@link API_BASE_URL}.
 *
 * @param baseUrl - absolute API origin, or `''` for same origin. Must NOT have
 *   a trailing slash — consumers concatenate paths that already start with `/`.
 *
 * @example
 * ```typescript
 * // In app.config.ts
 * import { provideApiBaseUrl } from '@ptah-web/core';
 * import { environment } from '../environments/environment';
 *
 * export const appConfig: ApplicationConfig = {
 *   providers: [provideApiBaseUrl(environment.apiBaseUrl)],
 * };
 * ```
 */
export function provideApiBaseUrl(baseUrl: string): Provider {
  return {
    provide: API_BASE_URL,
    useValue: baseUrl,
  };
}
