import { Injectable, inject, DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { fromEvent } from 'rxjs';
import { TabManagerService } from './tab-manager.service';

/**
 * KeyboardShortcutsService - Global keyboard shortcuts for tab operations
 *
 * Shortcuts:
 * - Ctrl+T / Cmd+T: Create new tab
 * - Ctrl+W / Cmd+W: Close active tab
 * - Ctrl+Tab / Cmd+Tab: Next tab
 * - Ctrl+Shift+Tab / Cmd+Shift+Tab: Previous tab
 *
 * Architecture:
 * - Uses RxJS fromEvent for keyboard event handling
 * - Uses takeUntilDestroyed for automatic cleanup
 * - Prevents default browser behavior for captured shortcuts
 * - Handles both Ctrl (Windows/Linux) and Cmd (Mac)
 */
@Injectable({ providedIn: 'root' })
export class KeyboardShortcutsService {
  private readonly tabManager = inject(TabManagerService);
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    this.setupShortcuts();
  }

  /**
   * Setup global keyboard shortcuts
   * Automatically cleaned up when service is destroyed
   */
  private setupShortcuts(): void {
    fromEvent<KeyboardEvent>(window, 'keydown')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((event) => {
        // Check for Ctrl (Windows/Linux) or Meta (Mac)
        const isModifierKey = event.ctrlKey || event.metaKey;

        if (!isModifierKey) return;

        switch (event.key) {
          case 't':
          case 'T':
            event.preventDefault();
            this.createNewTab();
            break;

          case 'w':
          case 'W':
            event.preventDefault();
            this.closeActiveTab();
            break;

          case 'Tab':
            event.preventDefault();
            this.cycleTab(event.shiftKey ? -1 : 1);
            break;
        }
      });
  }

  /**
   * Create new tab (Ctrl+T / Cmd+T)
   */
  private createNewTab(): void {
    const newTabId = this.tabManager.createTab();
    this.tabManager.switchTab(newTabId);
  }

  /**
   * Close active tab (Ctrl+W / Cmd+W)
   */
  private closeActiveTab(): void {
    const activeId = this.tabManager.activeTabId();
    if (activeId) {
      this.tabManager.closeTab(activeId);
    }
  }

  /**
   * Cycle through tabs (Ctrl+Tab / Ctrl+Shift+Tab)
   * @param direction - 1 for next tab, -1 for previous tab
   */
  private cycleTab(direction: 1 | -1): void {
    const tabs = this.tabManager.tabs();
    if (tabs.length <= 1) return;

    const activeId = this.tabManager.activeTabId();
    const currentIndex = tabs.findIndex((t) => t.id === activeId);

    if (currentIndex === -1) return;

    // Wrap around using modulo
    const nextIndex = (currentIndex + direction + tabs.length) % tabs.length;
    this.tabManager.switchTab(tabs[nextIndex].id);
  }
}
