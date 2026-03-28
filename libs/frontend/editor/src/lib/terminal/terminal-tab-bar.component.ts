import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import {
  LucideAngularModule,
  Plus,
  X,
  Terminal as TermIcon,
} from 'lucide-angular';
import { TerminalService } from '../services/terminal.service';

/**
 * TerminalTabBarComponent - Tab bar for multi-tab terminal panel.
 *
 * Complexity Level: 1 (Simple - pure UI delegation to TerminalService signals)
 * Patterns: Standalone, OnPush, Lucide icons, signal-based state from service
 *
 * Displays terminal tabs from TerminalService.tabs() with:
 * - Active tab highlighting (bg-base-100 vs bg-base-300)
 * - Exit state dimming (opacity-50 for exited terminals)
 * - Close button per tab (with stopPropagation to prevent tab switch)
 * - "New Terminal" button (+) for creating new terminal tabs
 */
@Component({
  selector: 'ptah-terminal-tab-bar',
  standalone: true,
  imports: [LucideAngularModule],
  template: `
    <div
      class="flex items-center bg-base-300 border-t border-base-content/10 h-8 flex-shrink-0"
      role="tablist"
      aria-label="Terminal tabs"
    >
      <span
        class="text-xs font-semibold tracking-wider opacity-60 uppercase px-2 select-none flex-shrink-0"
        >Terminal</span
      >
      <div class="flex items-center overflow-x-auto flex-1 scrollbar-thin">
        @for (tab of terminalService.tabs(); track tab.id) {
          <button
            class="group flex items-center gap-1 px-2 py-1 text-xs border-r border-base-content/5 whitespace-nowrap select-none transition-colors"
            [class.bg-base-100]="tab.id === terminalService.activeTabId()"
            [class.text-base-content]="tab.id === terminalService.activeTabId()"
            [class.bg-base-300]="tab.id !== terminalService.activeTabId()"
            [class.text-base-content/60]="
              tab.id !== terminalService.activeTabId()
            "
            [class.opacity-50]="tab.hasExited"
            role="tab"
            [attr.aria-selected]="tab.id === terminalService.activeTabId()"
            [attr.aria-label]="'Switch to ' + tab.name"
            (click)="terminalService.switchTab(tab.id)"
          >
            <lucide-angular [img]="TerminalIcon" class="w-3 h-3" />
            <span>{{ tab.name }}</span>
            @if (tab.hasExited) {
              <span
                class="text-[10px] opacity-60"
                [title]="'Exited with code ' + (tab.exitCode ?? 'unknown')"
                >(exited)</span
              >
            }
            <button
              class="ml-1 p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-base-content/10 transition-opacity"
              [attr.aria-label]="'Close ' + tab.name"
              (click)="closeTab($event, tab.id)"
            >
              <lucide-angular [img]="XIcon" class="w-3 h-3" />
            </button>
          </button>
        }
      </div>
      <button
        class="btn btn-ghost btn-xs mx-1 flex-shrink-0"
        title="New Terminal"
        aria-label="New Terminal"
        (click)="newTerminal()"
      >
        <lucide-angular [img]="PlusIcon" class="w-3.5 h-3.5" />
      </button>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TerminalTabBarComponent {
  protected readonly terminalService = inject(TerminalService);

  protected readonly PlusIcon = Plus;
  protected readonly XIcon = X;
  protected readonly TerminalIcon = TermIcon;

  protected async newTerminal(): Promise<void> {
    await this.terminalService.createTerminal();
  }

  protected async closeTab(event: MouseEvent, id: string): Promise<void> {
    event.stopPropagation();
    await this.terminalService.closeTab(id);
  }
}
