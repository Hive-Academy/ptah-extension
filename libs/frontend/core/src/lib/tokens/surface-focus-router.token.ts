import { InjectionToken } from '@angular/core';
import { NotificationFocusResult } from './notification-focus-router.token';

export interface SurfaceFocusRouter {
  readonly kind: 'onboarding' | 'mcp-apps';
  canFocus(sessionId: string): boolean;
  focus(sessionId: string): Promise<NotificationFocusResult>;
}

/** Legacy notification wire values are handled by the merged onboarding router. */
export function focusRouterKindFor(
  surfaceKind: 'setup-wizard' | 'harness-builder' | 'mcp-apps',
): SurfaceFocusRouter['kind'] {
  return surfaceKind === 'mcp-apps' ? 'mcp-apps' : 'onboarding';
}

export const SURFACE_FOCUS_ROUTER = new InjectionToken<
  readonly SurfaceFocusRouter[]
>('SURFACE_FOCUS_ROUTER');
