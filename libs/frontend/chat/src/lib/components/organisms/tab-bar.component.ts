import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { TabItemComponent } from '../molecules/tab-item.component';
import { TabManagerService } from '../../services/tab-manager.service';

/**
 * TabBarComponent - Container for displaying open tabs
 *
 * Complexity Level: 1 (Simple container)
 * Patterns: Service injection, DaisyUI styling
 *
 * Displays all open tabs in a horizontal scrollable bar.
 * Delegates all state management to TabManagerService.
 *
 * Note: New sessions are created from the sidebar, not the tab bar.
 * Use Ctrl+T keyboard shortcut for quick session creation.
 */
@Component({
  selector: 'ptah-tab-bar',
  standalone: true,
  imports: [TabItemComponent],
  template: `
    <div class="flex items-center h-full px-1 overflow-x-auto gap-1">
      @for (tab of tabs(); track tab.id) {
      <ptah-tab-item
        [tab]="tab"
        [isActive]="tab.id === activeTabId()"
        (tabSelect)="onSelectTab($event)"
        (tabClose)="onCloseTab($event)"
      />
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TabBarComponent {
  private readonly tabManager = inject(TabManagerService);

  readonly tabs = this.tabManager.tabs;
  readonly activeTabId = this.tabManager.activeTabId;

  protected onSelectTab(tabId: string): void {
    this.tabManager.switchTab(tabId);
  }

  protected onCloseTab(tabId: string): void {
    this.tabManager.closeTab(tabId);
  }
}
