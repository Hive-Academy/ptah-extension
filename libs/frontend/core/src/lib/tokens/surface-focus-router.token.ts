import { InjectionToken } from '@angular/core';
import { NotificationFocusResult } from './notification-focus-router.token';

export interface SurfaceFocusRouter {
  readonly kind: 'setup-wizard' | 'harness-builder' | 'mcp-apps';
  canFocus(sessionId: string): boolean;
  focus(sessionId: string): Promise<NotificationFocusResult>;
}

export const SURFACE_FOCUS_ROUTER = new InjectionToken<readonly SurfaceFocusRouter[]>('SURFACE_FOCUS_ROUTER');
