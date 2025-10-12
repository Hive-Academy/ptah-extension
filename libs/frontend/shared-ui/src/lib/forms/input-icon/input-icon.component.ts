import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { LucideAngularModule, LucideIconData } from 'lucide-angular';

/**
 * Input Icon Component - Angular 20+ Modernized
 * - Signal-based APIs (input(), output())
 * - OnPush change detection
 * - Modern control flow (@if)
 * - Pure presentation component
 */
@Component({
  selector: 'ptah-input-icon',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="vscode-input-icon" [class.vscode-input-icon-clickable]="clickable()">
      @if (clickable()) {
        <button
          class="vscode-input-icon-button"
          [attr.aria-label]="ariaLabel()"
          (click)="iconClick.emit()"
        >
          <lucide-angular [img]="icon()" class="vscode-input-icon-svg"></lucide-angular>
        </button>
      } @else {
        <lucide-angular [img]="icon()" class="vscode-input-icon-svg"></lucide-angular>
      }
    </div>
  `,
  styles: [
    `
      .vscode-input-icon {
        display: flex;
        align-items: center;
        padding: 8px;
        color: var(--vscode-input-placeholderForeground);
      }

      .vscode-input-icon-button {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 24px;
        height: 24px;
        background: none;
        border: none;
        border-radius: 2px;
        cursor: pointer;
        transition: background-color 0.15s ease;
        color: inherit;
      }

      .vscode-input-icon-button:hover {
        background-color: var(--vscode-list-hoverBackground);
        color: var(--vscode-foreground);
      }

      .vscode-input-icon-button:focus {
        outline: 1px solid var(--vscode-focusBorder);
        outline-offset: 2px;
      }

      .vscode-input-icon-svg {
        width: 16px;
        height: 16px;
      }
    `,
  ],
})
export class InputIconComponent {
  // Signal-based inputs (Angular 20+)
  icon = input.required<LucideIconData>();
  clickable = input<boolean>(false);
  ariaLabel = input<string>('');

  // Signal-based output (Angular 20+)
  iconClick = output<void>();
}
