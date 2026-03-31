import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import { TerminalComponent } from './terminal.component';
import { TerminalTabBarComponent } from './terminal-tab-bar.component';
import { TerminalService } from '../services/terminal.service';

/**
 * TerminalPanelComponent - Container wrapping the terminal tab bar and terminal instances.
 *
 * Complexity Level: 1 (Simple - composition of tab bar + terminal instances)
 * Patterns: Standalone, OnPush, hidden-tab preservation
 *
 * Key design decision: ALL terminal tabs are rendered simultaneously but hidden via
 * [class.hidden] instead of being conditionally destroyed with @if. This preserves
 * the xterm.js Terminal state (scrollback buffer, cursor position, WebGL context)
 * when switching between tabs. Only the active tab is visible.
 *
 * Empty state: When no terminals exist, shows a placeholder message instructing
 * the user to click "+" to create a terminal.
 */
@Component({
  selector: 'ptah-terminal-panel',
  standalone: true,
  imports: [TerminalComponent, TerminalTabBarComponent],
  template: `
    <div class="flex flex-col h-full">
      <ptah-terminal-tab-bar />
      <div class="flex-1 min-h-0 relative">
        @if (terminalService.hasTerminals()) {
          @for (tab of terminalService.tabs(); track tab.id) {
            <div
              class="h-full w-full absolute inset-0"
              [class.hidden]="tab.id !== terminalService.activeTabId()"
            >
              <ptah-terminal [terminalId]="tab.id" />
            </div>
          }
        } @else {
          <div
            class="h-full flex items-center justify-center text-sm opacity-40 select-none"
          >
            <span>Click + to open a terminal</span>
          </div>
        }
      </div>
    </div>
  `,
  styles: `
    :host {
      display: block;
      height: 100%;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TerminalPanelComponent {
  protected readonly terminalService = inject(TerminalService);
}
