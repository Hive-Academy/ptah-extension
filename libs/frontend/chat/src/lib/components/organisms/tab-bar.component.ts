import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { LucideAngularModule, Plus } from 'lucide-angular';
import { TabItemComponent } from '../molecules/tab-item.component';
import { TabManagerService } from '../../services/tab-manager.service';

/**
 * TabBarComponent - Container for all tabs with new tab button
 *
 * Complexity Level: 1 (Simple container)
 * Patterns: Service injection, DaisyUI styling
 *
 * Displays all open tabs in a horizontal scrollable bar.
 * Allows creating new tabs and switching between existing ones.
 * Delegates all state management to TabManagerService.
 */
@Component({
  selector: 'ptah-tab-bar',
  standalone: true,
  imports: [TabItemComponent, LucideAngularModule],
  template: `
    <div
      class="flex items-center bg-base-200 border-b border-base-300 h-10 px-1 overflow-x-auto"
    >
      <!-- Tab items -->
      @for (tab of tabs(); track tab.id) {
      <ptah-tab-item
        [tab]="tab"
        [isActive]="tab.id === activeTabId()"
        (tabSelect)="onSelectTab($event)"
        (tabClose)="onCloseTab($event)"
      />
      }

      <!-- New tab button -->
      <button
        class="btn btn-ghost btn-sm btn-square ml-1 flex-shrink-0"
        (click)="onCreateTab()"
        [title]="'New chat (Ctrl+T)'"
      >
        <lucide-angular [img]="PlusIcon" class="w-4 h-4" />
      </button>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TabBarComponent {
  private readonly tabManager = inject(TabManagerService);

  readonly tabs = this.tabManager.tabs;
  readonly activeTabId = this.tabManager.activeTabId;

  readonly PlusIcon = Plus;

  protected onSelectTab(tabId: string): void {
    this.tabManager.switchTab(tabId);
  }

  protected onCloseTab(tabId: string): void {
    this.tabManager.closeTab(tabId);
  }

  protected onCreateTab(): void {
    const newTabId = this.tabManager.createTab();
    this.tabManager.switchTab(newTabId);
  }
}
