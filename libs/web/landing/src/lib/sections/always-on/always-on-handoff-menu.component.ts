import { ChangeDetectionStrategy, Component, input } from '@angular/core';

interface PickerRow {
  readonly label: string;
  readonly offline: boolean;
}

/** Platform rows as the picker labels them (send-to-messaging bindingLabel). */
const PICKER_ROWS: readonly PickerRow[] = [
  { label: 'Telegram', offline: false },
  { label: 'Discord', offline: false },
  { label: 'Slack', offline: true },
];

/**
 * The session tile's "Session actions" menu (canvas-rail-card) with the
 * hand-off control (send-to-messaging) in its two real states:
 * - before: "Hand off session to…" opens the binding picker
 *   (handoff-binding-picker): heading, help line, one row per platform, a
 *   row disabled with its offline reason;
 * - after: "Resolve back to webview", "Driven from Telegram · read-only
 *   here", and the green "Attached to Telegram" outcome line.
 * Every string is the app's own. Decorative; sized in em by the desk.
 */
@Component({
  selector: 'ptah-always-on-handoff-menu',
  standalone: true,
  template: `
    <div class="ho-menu" data-glass-surface="overlay">
      <span class="ho-item">Open beside</span>
      <span class="ho-item">Rename</span>
      @if (handedOff()) {
        <span class="ho-item is-current">
          <span class="ho-line">
            <svg class="ho-icon" viewBox="0 0 24 24" fill="none">
              <path
                d="m18.84 12.25 1.72-1.71a5 5 0 0 0-7.07-7.07l-1.72 1.71M5.17 11.75l-1.71 1.71a5 5 0 0 0 7.07 7.07l1.71-1.71M8 2v3M2 8h3M16 22v-3M22 16h-3"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
              />
            </svg>
            Resolve back to webview
          </span>
          <span class="ho-sub">Driven from Telegram · read-only here</span>
        </span>
      } @else {
        <span class="ho-item is-current">Hand off session to…</span>
      }
    </div>

    @if (handedOff()) {
      <p class="result">Attached to Telegram</p>
    } @else {
      <div class="picker" data-glass-surface="overlay">
        <div class="picker-head">
          <span class="picker-title">Hand off session to…</span>
          <span class="picker-help">
            The platform you pick takes over this tab. It stays read-only here until you resolve it back.
          </span>
        </div>
        <div class="picker-rows">
          @for (row of rows; track row.label; let first = $first) {
            <span class="picker-row" [class.is-picked]="first" [class.is-off]="row.offline">
              <svg class="row-icon" viewBox="0 0 24 24" fill="none">
                <path
                  d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linejoin="round"
                />
              </svg>
              <span class="row-text">
                <span>{{ row.label }}</span>
                @if (row.offline) {
                  <span class="row-note">platform offline — start it in Gateway tab</span>
                }
              </span>
            </span>
          }
        </div>
      </div>
    }
  `,
  styleUrls: ['../shared/app-mock.css', './always-on-handoff-menu.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AlwaysOnHandoffMenuComponent {
  public readonly handedOff = input(false);
  protected readonly rows = PICKER_ROWS;
}
