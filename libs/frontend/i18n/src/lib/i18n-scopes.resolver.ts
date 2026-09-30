import { inject } from '@angular/core';
import type { ResolveFn } from '@angular/router';
import { catchError, defer, from, map, of, switchMap } from 'rxjs';
import { I18nError } from './i18n.error';
import type { I18nScope } from './i18n-scope';
import { I18nService } from './i18n.service';

type ScopeOrScopes = I18nScope | readonly I18nScope[];

/**
 * Where a route's scopes come from: the scopes themselves, or, for a lazy
 * library, a function that imports them (`() => import('@ptah-web/pricing')
 * .then((m) => m.PRICING_I18N_SCOPE)`) so the scope chunk stays lazy.
 */
export type I18nScopesSource = ScopeOrScopes | (() => Promise<ScopeOrScopes>);

/**
 * Route resolver that loads a route's scopes, for the active language and
 * English, before navigation ends. The server's render and the first client
 * render therefore see resolved text.
 *
 * It never blocks navigation: on failure it logs and resolves `true`, and the
 * affected keys fall back to English (or '') through `I18nMissingHandler`.
 * A wiring mistake (an `I18nError`) is logged under its own `[i18n:wiring]`
 * tag so it is not mistaken for a transient load failure. A failed scope is
 * loaded afresh on the next visit.
 */
export function i18nScopesResolver(
  source: I18nScopesSource,
): ResolveFn<boolean> {
  return () => {
    const i18n = inject(I18nService);
    return defer(() =>
      typeof source === 'function' ? from(source()) : of(source),
    ).pipe(
      switchMap((scopes) => i18n.loadScopes(toList(scopes))),
      map(() => true),
      catchError((error: unknown) => {
        if (error instanceof I18nError) {
          // A mistake in how scopes are defined or registered (for example
          // two different scopes under one name), not a failed load.
          console.error('[i18n:wiring] Route scopes are misconfigured.', error);
        } else {
          console.error('[i18n] Could not load route scopes.', error);
        }
        return of(true);
      }),
    );
  };
}

function toList(scopes: ScopeOrScopes): readonly I18nScope[] {
  return isScopeList(scopes) ? scopes : [scopes];
}

function isScopeList(scopes: ScopeOrScopes): scopes is readonly I18nScope[] {
  return Array.isArray(scopes);
}
