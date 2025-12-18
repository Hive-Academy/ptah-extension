import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  effect,
  ViewChild,
  ElementRef,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule, Plus, Check, X } from 'lucide-angular';
import { PopoverComponent } from '@ptah-extension/ui';
import { TabItemComponent } from '../molecules/tab-item.component';
import { TabManagerService } from '../../services/tab-manager.service';
import { ChatStore } from '../../services/chat.store';

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
  imports: [
    TabItemComponent,
    LucideAngularModule,
    PopoverComponent,
    FormsModule,
  ],
  template: `
    <div class="flex items-center h-full px-1 overflow-x-auto gap-1">
      <!-- Tab items -->
      @for (tab of tabs(); track tab.id) {
      <ptah-tab-item
        [tab]="tab"
        [isActive]="tab.id === activeTabId()"
        (tabSelect)="onSelectTab($event)"
        (tabClose)="onCloseTab($event)"
      />
      }

      <!-- New tab button with popover -->
      <ptah-popover
        [isOpen]="popoverOpen()"
        [position]="'below'"
        [hasBackdrop]="true"
        [backdropClass]="'cdk-overlay-transparent-backdrop'"
        (closed)="handleCancelSession()"
      >
        <!-- Trigger: New tab button -->
        <button
          trigger
          class="btn btn-ghost btn-sm btn-square flex-shrink-0"
          (click)="openPopover()"
          [title]="'New chat (Ctrl+T)'"
        >
          <lucide-angular [img]="PlusIcon" class="w-4 h-4" />
        </button>

        <!-- Popover content -->
        <div content class="p-4 w-80">
          <h3 class="text-sm font-semibold mb-3">New Session</h3>

          <!-- Input field with Enter/ESC keyboard support -->
          <input
            #sessionNameInputRef
            type="text"
            class="input input-bordered input-sm w-full mb-3"
            placeholder="Enter session name (optional)"
            [(ngModel)]="sessionNameInput"
            (keydown.enter)="handleCreateSession()"
            (keydown.escape)="handleCancelSession()"
          />

          <!-- Action buttons -->
          <div class="flex gap-2">
            <button
              class="btn btn-sm btn-ghost flex-1 gap-1.5"
              (click)="handleCancelSession()"
            >
              <lucide-angular [img]="XIcon" class="w-3 h-3" />
              Cancel
            </button>
            <button
              class="btn btn-sm btn-primary flex-1 gap-1.5"
              (click)="handleCreateSession()"
            >
              <lucide-angular [img]="CheckIcon" class="w-3 h-3" />
              Create
            </button>
          </div>
        </div>
      </ptah-popover>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TabBarComponent {
  private readonly tabManager = inject(TabManagerService);
  private readonly chatStore = inject(ChatStore);

  readonly tabs = this.tabManager.tabs;
  readonly activeTabId = this.tabManager.activeTabId;

  readonly PlusIcon = Plus;
  readonly CheckIcon = Check;
  readonly XIcon = X;

  // Popover state
  private readonly _popoverOpen = signal(false);
  readonly popoverOpen = this._popoverOpen.asReadonly();
  readonly sessionNameInput = signal('');

  @ViewChild('sessionNameInputRef')
  sessionNameInputRef?: ElementRef<HTMLInputElement>;

  constructor() {
    // Focus input when popover opens
    effect(() => {
      if (this.popoverOpen()) {
        setTimeout(() => {
          this.sessionNameInputRef?.nativeElement.focus();
        }, 0);
      }
    });
  }

  protected onSelectTab(tabId: string): void {
    this.tabManager.switchTab(tabId);
  }

  protected onCloseTab(tabId: string): void {
    this.tabManager.closeTab(tabId);
  }

  protected openPopover(): void {
    this.sessionNameInput.set('');
    this._popoverOpen.set(true);
  }

  protected handleCreateSession(): void {
    const name = this.sessionNameInput().trim();
    const sessionName = name || this.generateDefaultSessionName();

    // Create new tab with name
    this.tabManager.createTab(sessionName);

    // Clear current session (activates new tab)
    this.chatStore.clearCurrentSession();

    // Refresh sessions list
    this.chatStore.loadSessions();

    // Close popover
    this._popoverOpen.set(false);
  }

  protected handleCancelSession(): void {
    this._popoverOpen.set(false);
    this.sessionNameInput.set('');
  }

  private generateDefaultSessionName(): string {
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    return `session-${month}-${day}-${hours}-${minutes}`;
  }
}
