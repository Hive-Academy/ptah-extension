import { Injectable, signal } from '@angular/core';

/** Root-tab voice sessions shared with completion notification policy. */
@Injectable({ providedIn: 'root' })
export class CommandCenterVoiceSessionService {
  private readonly activeRoots = signal<ReadonlySet<string>>(new Set());

  activate(rootTabId: string): void {
    if (!rootTabId) return;
    this.activeRoots.update((roots) => new Set(roots).add(rootTabId));
  }

  deactivate(rootTabId: string): void {
    this.activeRoots.update((roots) => {
      const next = new Set(roots);
      next.delete(rootTabId);
      return next;
    });
  }

  isActive(rootTabId: string): boolean {
    return this.activeRoots().has(rootTabId);
  }
}
