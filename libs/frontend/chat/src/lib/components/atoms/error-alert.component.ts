import { Component, input, ChangeDetectionStrategy } from '@angular/core';

/**
 * ErrorAlertComponent - Display error messages with alert styling
 *
 * Complexity Level: 1 (Simple atom)
 * Patterns: DaisyUI alert wrapper
 *
 * Features:
 * - Display error message with DaisyUI alert-error styling
 * - Small text (10px)
 * - Compact padding (py-1 px-2)
 */
@Component({
  selector: 'ptah-error-alert',
  standalone: true,
  template: `
    <div class="alert alert-error text-[10px] py-1 px-2 mt-1">
      <span>{{ errorMessage() }}</span>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ErrorAlertComponent {
  readonly errorMessage = input.required<string>();
}
