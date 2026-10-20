import { Injectable, inject } from '@angular/core';
import { SurfaceRouterService, surfaceNavigationLanded, type SurfaceFocusRouter, type NotificationFocusResult } from '@ptah-extension/core';
import { AppsFocusTarget } from './apps-focus-target';

@Injectable({ providedIn: 'root' })
export class AppsFocusRouter implements SurfaceFocusRouter {
  readonly kind = 'mcp-apps' as const;
  private readonly target = inject(AppsFocusTarget);
  private readonly router = inject(SurfaceRouterService);

  canFocus(sessionId: string): boolean {
    return !!sessionId && this.target.currentSessionId() === sessionId;
  }

  async focus(sessionId: string): Promise<NotificationFocusResult> {
    if (!this.canFocus(sessionId)) return { success: false, outcome: 'missing' };
    const result = await this.router.navigateToSurface('apps');
    return surfaceNavigationLanded(result)
      ? { success: true, outcome: 'focused' }
      : { success: false, outcome: 'missing' };
  }
}
