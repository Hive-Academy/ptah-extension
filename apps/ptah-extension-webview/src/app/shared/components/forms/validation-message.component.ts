import { Component, Input } from '@angular/core';

/**
 * Pure Validation Message Component
 * - Shows helper text or error messages
 * - Accessibility compliant
 * - Pure VS Code styling
 */
@Component({
  selector: 'vscode-validation-message',
  standalone: true,
  template: `
    @if (message) {
      <div
        class="vscode-validation-message"
        [class.vscode-validation-error]="type === 'error'"
        [class.vscode-validation-helper]="type === 'helper'"
        [attr.id]="messageId"
        [attr.aria-live]="type === 'error' ? 'assertive' : 'polite'"
        [attr.role]="type === 'error' ? 'alert' : null"
      >
        {{ message }}
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
export class VSCodeValidationMessageComponent {
  @Input() message = '';
  @Input() type: 'helper' | 'error' = 'helper';
  @Input() messageId = '';
}
