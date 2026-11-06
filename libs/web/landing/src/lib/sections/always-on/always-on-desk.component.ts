import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { AlwaysOnHandoffMenuComponent } from './always-on-handoff-menu.component';

/** Title-bar tabs of the Electron shell, as the app clips on this page show them. */
const SHELL_TABS = ['Chat', 'Voice', 'Apps', 'Tasks', 'Analytics', 'Setup'] as const;

/** Abstract transcript lines in the chat pane, as shares of its width. */
const CHAT_LINES = [0.62, 0.84, 0.48, 0.74, 0.56] as const;

/**
 * The desktop half of S7, drawn as the Electron app: the shell title bar and
 * its tabs (electron-shell), the Sessions rail with tiles (canvas-rail-card),
 * the chat pane and its composer (chat-input). The active tile's Session
 * actions menu hands the session off; once handed off, the composer shows
 * the app's read-only placeholder and a lock. Decorative; em-sized so it
 * scales with the desk.
 */
@Component({
  selector: 'ptah-always-on-desk',
  standalone: true,
  imports: [AlwaysOnHandoffMenuComponent],
  template: `
    <div class="shell-bar">
      <span class="shell-name">PtahCode</span>
      <span class="shell-tabs">
        @for (tab of tabs; track tab; let first = $first) {
          <span class="shell-tab" [class.is-active]="first">{{ tab }}</span>
        }
      </span>
    </div>

    <div class="shell-main">
      <div class="rail app-card">
        <span class="rail-title">Sessions</span>
        @for (tile of tiles; track $index; let first = $first) {
          <span class="rail-tile" [class.is-active]="first">
            <span class="app-dot" [class.is-ok]="first"></span>
            <span class="tile-line" [style.width.%]="tile"></span>
            @if (first) {
              <span class="tile-actions">⋮</span>
            }
          </span>
        }
      </div>

      <div class="desk-chat app-card">
        <div class="desk-lines">
          @for (line of lines; track $index; let odd = $odd) {
            <span class="desk-line" [class.is-reply]="odd" [style.width.%]="line * 100"></span>
          }
        </div>
        <div class="composer" [class.is-locked]="handedOff()">
          @if (handedOff()) {
            <svg class="composer-lock" viewBox="0 0 16 16" fill="none">
              <rect x="3" y="7" width="10" height="7" rx="1.5" stroke="currentColor" stroke-width="1.5" />
              <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" stroke="currentColor" stroke-width="1.5" />
            </svg>
            <span class="composer-text">Session is attached to messaging — read-only</span>
          } @else {
            <span class="composer-caret"></span>
          }
        </div>
      </div>
    </div>

    <ptah-always-on-handoff-menu class="handoff" [handedOff]="handedOff()" />
  `,
  styleUrls: ['../shared/app-mock.css', './always-on-desk.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AlwaysOnDeskComponent {
  public readonly handedOff = input(false);

  protected readonly tabs = SHELL_TABS;
  protected readonly lines = CHAT_LINES;
  protected readonly tiles = [68, 54, 76] as const;
}
