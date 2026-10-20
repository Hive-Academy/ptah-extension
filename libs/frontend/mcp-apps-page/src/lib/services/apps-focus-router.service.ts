import { Injectable, inject } from '@angular/core';
import { SurfaceRouterService, surfaceNavigationLanded, type SurfaceFocusRouter, type NotificationFocusResult } from '@ptah-extension/core';
import { AppsSessionService } from './apps-session.service';

@Injectable({ providedIn: 'root' })
export class AppsFocusRouter implements SurfaceFocusRouter {
  readonly kind = 'mcp-apps' as const;
  private readonly sessions = inject(AppsSessionService);
  private readonly router = inject(SurfaceRouterService);

  canFocus(sessionId: string): boolean {
    return !!sessionId && this.sessions.sessionId() === sessionId;
  }

  async focus(sessionId: string): Promise<NotificationFocusResult> {
    if (!this.canFocus(sessionId)) return { success: false, outcome: 'missing' };
    const result = await this.router.navigateToSurface('apps');
    return surfaceNavigationLanded(result)
      ? { success: true, outcome: 'focused' }
      : { success: false, outcome: 'missing' };
  }
}
