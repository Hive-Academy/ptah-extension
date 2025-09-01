import { Component, Input, Output, EventEmitter, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule, ChevronDown } from 'lucide-angular';
import { DropdownOption } from '@ptah-extension/shared';

/**
 * VS Code Dropdown Trigger - Pure Button Component
 * - Displays selected option or placeholder
 * - Handles trigger interactions
 * - No business logic
 */
@Component({
  selector: 'vscode-dropdown-trigger',
  standalone: true,
  imports: [CommonModule, LucideAngularModule],

  template: `
    <button
      type="button"
      class="vscode-dropdown-trigger"
      [class.vscode-dropdown-open]="isOpen"
      [disabled]="disabled"
      (click)="triggerClick.emit()"
      (keydown)="keyDown.emit($event)"
      [attr.aria-expanded]="isOpen"
      [attr.aria-haspopup]="'listbox'"
      [attr.aria-label]="ariaLabel || placeholder"
      [attr.aria-describedby]="ariaDescribedBy"
      [attr.id]="triggerId"
      cdkMonitorElementFocus
    >
      <div class="vscode-trigger-content">
        @if (selectedOption) {
          <div class="vscode-selected-option">
            @if (selectedOption.icon) {
              <span class="vscode-option-icon">{{ selectedOption.icon }}</span>
            }
            <span class="vscode-option-label">{{ selectedOption.label }}</span>
            @if (showDescription && selectedOption.description) {
              <span class="vscode-option-description">{{ selectedOption.description }}</span>
            }
          </div>
        } @else {
          <span class="vscode-placeholder">{{ placeholder }}</span>
        }
      </div>

      <lucide-angular
        [img]="ChevronDown"
        class="vscode-dropdown-chevron"
        [class.vscode-chevron-open]="isOpen"
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
export class VSCodeDropdownTriggerComponent {
  @Input() selectedOption: DropdownOption | null = null;
  @Input() placeholder: string = 'Select an option';
  @Input() disabled: boolean = false;
  @Input() isOpen: boolean = false;
  @Input() showDescription: boolean = true;
  @Input() ariaLabel: string = '';
  @Input() ariaDescribedBy: string = '';
  @Input() triggerId: string = '';

  @Output() triggerClick = new EventEmitter<void>();
  @Output() keyDown = new EventEmitter<KeyboardEvent>();

  readonly ChevronDown = ChevronDown;
}
