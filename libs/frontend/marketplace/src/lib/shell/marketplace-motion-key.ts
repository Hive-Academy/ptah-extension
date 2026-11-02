import { InjectionToken } from '@angular/core';
import type { Router } from '@angular/router';
import type { MotionRouteKeyFn } from '@ptah-extension/ui';
import { marketplaceRouteOfUrl } from './marketplace-route-url';

/** Override this token in a test to exercise the G1 fallback. */
export const MARKETPLACE_LEAVE_CLONE = new InjectionToken<boolean>('MARKETPLACE_LEAVE_CLONE', {
  providedIn: 'root',
  factory: () => MARKETPLACE_LEAVE_CLONE_DEFAULT,
});

/** Flip this single default if Electron G1 shows that router host leave does not run. */
export const MARKETPLACE_LEAVE_CLONE_DEFAULT = false;

const SERVER_SOURCES = ['smithery', 'registry', 'custom-url'] as const;
const SKILL_SOURCES = ['ptah-plugins', 'community', 'marketplaces'] as const;

/** Page and source order for the pending route, before component activation. */
export function marketplacePageKey(router: Router): MotionRouteKeyFn {
  return (target) => {
    const route = marketplaceRouteOfUrl(router, target.url);
    if (!route) return null;
    const pageIndex = ['overview', 'connectors', 'servers', 'skills'].indexOf(route.page);
    const sourceIndex = route.page === 'servers'
      ? SERVER_SOURCES.findIndex((source) => source === route.source)
      : route.page === 'skills'
        ? SKILL_SOURCES.findIndex((source) => source === route.source)
        : -1;
    return {
      key: route.page + (route.page === 'servers' || route.page === 'skills'
        ? `:${route.source ?? ''}` : ''),
      index: pageIndex * 10 + sourceIndex + 1,
    };
  };
}
