import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Validation Message Component - Angular 20+ Modernized
 * - Signal-based APIs (input())
 * - OnPush change detection
 * - Modern control flow (@if)
 * - Accessibility compliant
 */
@Component({
  selector: 'ptah-validation-message',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (message()) {
      <div
        class="vscode-validation-message"
        [class.vscode-validation-error]="type() === 'error'"
        [class.vscode-validation-helper]="type() === 'helper'"
        [attr.id]="messageId()"
        [attr.aria-live]="type() === 'error' ? 'assertive' : 'polite'"
        [attr.role]="type() === 'error' ? 'alert' : null"
      >
        {{ message() }}
      </div>
    }
  `,
  styles: [
    `
      .vscode-validation-message {
        margin-top: 4px;
        font-family: var(--vscode-font-family);
        font-size: 11px;
        line-height: 1.4;
      }

      .vscode-validation-helper {
        color: var(--vscode-descriptionForeground);
      }

      .vscode-validation-error {
        color: var(--vscode-errorForeground);
      }
    `,
  ],
})
export class ValidationMessageComponent {
  // Signal-based inputs (Angular 20+)
  message = input<string>('');
  type = input<'helper' | 'error'>('helper');
  messageId = input<string>('');
}
