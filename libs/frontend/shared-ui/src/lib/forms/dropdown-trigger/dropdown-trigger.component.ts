import { Component, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule, ChevronDown } from 'lucide-angular';
import { DropdownOption } from '@ptah-extension/shared';

/**
 * Dropdown Trigger Component - Angular 20+ Modernized
 * - Signal-based APIs (input(), output())
 * - OnPush change detection
 * - Pure presentation component
 */
@Component({
  selector: 'ptah-dropdown-trigger',
  standalone: true,
  imports: [CommonModule, LucideAngularModule],

  template: `
    <button
      type="button"
      class="vscode-dropdown-trigger"
      [class.vscode-dropdown-open]="isOpen()"
      [disabled]="disabled()"
      (click)="triggerClick.emit()"
      (keydown)="keyDown.emit($event)"
      [attr.aria-expanded]="isOpen()"
      [attr.aria-haspopup]="'listbox'"
      [attr.aria-label]="ariaLabel() || placeholder()"
      [attr.aria-describedby]="ariaDescribedBy()"
      [attr.id]="triggerId()"
      cdkMonitorElementFocus
    >
      <div class="vscode-trigger-content">
        @if (selectedOption()) {
        <div class="vscode-selected-option">
          @if (selectedOption()!.icon) {
          <span class="vscode-option-icon">{{ selectedOption()!.icon }}</span>
          }
          <span class="vscode-option-label">{{ selectedOption()!.label }}</span>
          @if (showDescription() && selectedOption()!.description) {
          <span class="vscode-option-description">{{
            selectedOption()!.description
          }}</span>
          }
        </div>
        } @else {
        <span class="vscode-placeholder">{{ placeholder() }}</span>
        }
      </div>

      <lucide-angular
        [img]="ChevronDown"
        class="vscode-dropdown-chevron"
        [class.vscode-chevron-open]="isOpen()"
      ></lucide-angular>
    </button>
  `,
  styles: [
    `
      .vscode-dropdown-trigger {
        display: flex;
        align-items: center;
        width: 100%;
        height: 35px;
        padding: 0 8px;
        background-color: var(--vscode-dropdown-background);
        border: 1px solid var(--vscode-dropdown-border);
        color: var(--vscode-dropdown-foreground);
        cursor: pointer;
        border-radius: 2px;
        transition: background-color 0.1s ease;
        font-size: 13px;
        font-family: var(--vscode-font-family);
      }

      .vscode-dropdown-trigger:hover:not(:disabled) {
        background-color: var(--vscode-dropdown-listBackground);
      }

      .vscode-dropdown-trigger:focus:not(:disabled) {
        outline: 1px solid var(--vscode-focusBorder);
        outline-offset: -1px;
      }

      .vscode-dropdown-trigger:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }

      .vscode-dropdown-trigger.vscode-dropdown-open {
        border-color: var(--vscode-focusBorder);
      }

      .vscode-trigger-content {
        flex: 1;
        display: flex;
        align-items: center;
        min-width: 0;
      }

      .vscode-selected-option {
        display: flex;
        align-items: center;
        min-width: 0;
        flex: 1;
      }

      .vscode-placeholder {
        color: var(--vscode-input-placeholderForeground);
      }

      .vscode-option-icon {
        margin-right: 4px;
        font-size: 12px;
        flex-shrink: 0;
      }

      .vscode-option-label {
        font-weight: 500;
        font-size: 11px;
      }

      .vscode-option-description {
        margin-left: 4px;
        color: var(--vscode-descriptionForeground);
        font-size: 10px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .vscode-dropdown-chevron {
        width: 12px;
        height: auto;
        margin-left: 4px;
        transition: transform 0.2s ease;
        flex-shrink: 0;
        display: flex;
      }

      .vscode-dropdown-chevron.vscode-chevron-open {
        transform: rotate(180deg);
      }

      /* High Contrast Mode Support */
      @media (prefers-contrast: high) {
        .vscode-dropdown-trigger {
          border-width: 2px;
        }
      }
    `,
  ],
})
export class DropdownTriggerComponent {
  // Signal-based inputs (Angular 20+)
  selectedOption = input<DropdownOption | null>(null);
  placeholder = input<string>('Select an option');
  disabled = input<boolean>(false);
  isOpen = input<boolean>(false);
  showDescription = input<boolean>(true);
  ariaLabel = input<string>('');
  ariaDescribedBy = input<string>('');
  triggerId = input<string>('');

  // Signal-based outputs (Angular 20+)
  triggerClick = output<void>();
  keyDown = output<KeyboardEvent>();

  readonly ChevronDown = ChevronDown;
}
