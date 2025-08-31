import { Component, Input, Output, EventEmitter, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule, Check } from 'lucide-angular';
import { DropdownOption } from '@ptah-extension/shared';

/**
 * VS Code Dropdown Options List - Pure Component
 * - Renders list of options with groups
 * - Handles option selection
 * - No business logic or state
 */
@Component({
  selector: 'vscode-dropdown-options-list',
  standalone: true,
  imports: [CommonModule, LucideAngularModule],

  template: `
    <div class="vscode-options-container" role="listbox" [attr.id]="listboxId">
      @if (options.length === 0) {
        <div class="vscode-no-options" role="status" aria-live="polite">
          @if (hasSearchTerm) {
            No matching options found
          } @else {
            No options available
          }
        </div>
      } @else {
        @for (option of options; track option.value; let i = $index) {
          @if (option.group && (i === 0 || options[i - 1].group !== option.group)) {
            <div class="vscode-option-group-label" role="group" [attr.aria-label]="option.group">
              {{ option.group }}
            </div>
          }

          <button
            type="button"
            class="vscode-dropdown-option"
            [class.vscode-option-selected]="option.value === selectedValue"
            [class.vscode-option-focused]="i === focusedIndex"
            [class.vscode-option-disabled]="option.disabled"
            [disabled]="option.disabled"
            role="option"
            [attr.aria-selected]="option.value === selectedValue"
            [attr.aria-describedby]="option.description ? 'desc-' + option.value : null"
            (click)="optionClick.emit(option)"
            (mouseenter)="optionHover.emit(i)"
            cdkMonitorElementFocus
          >
            <div class="vscode-option-content">
              @if (option.icon) {
                <span class="vscode-option-icon" aria-hidden="true">{{ option.icon }}</span>
              }
              <div class="vscode-option-text">
                <span class="vscode-option-label">{{ option.label }}</span>
                @if (option.description) {
                  <span class="vscode-option-description" [attr.id]="'desc-' + option.value">
                    {{ option.description }}
                  </span>
                }
              </div>
            </div>

            @if (option.value === selectedValue) {
              <lucide-angular
                [img]="Check"
                class="vscode-check-icon"
                aria-hidden="true"
              ></lucide-angular>
            }
          </button>
        }
      }
    </div>
  `,
  styles: [
    `
      .vscode-options-container {
        overflow-y: auto;
        max-height: 160px;
        scrollbar-width: thin;
        scrollbar-color: var(--vscode-scrollbarSlider-background) transparent;
      }

      .vscode-options-container::-webkit-scrollbar {
        width: 6px;
      }

      .vscode-options-container::-webkit-scrollbar-track {
        background: transparent;
      }

      .vscode-options-container::-webkit-scrollbar-thumb {
        background: var(--vscode-scrollbarSlider-background);
        border-radius: 3px;
      }

      .vscode-options-container::-webkit-scrollbar-thumb:hover {
        background: var(--vscode-scrollbarSlider-hoverBackground);
      }

      .vscode-dropdown-option {
        display: flex;
        align-items: center;
        width: 100%;
        padding: 6px 8px;
        border: none;
        background: none;
        color: var(--vscode-foreground);
        cursor: pointer;
        text-align: left;
        transition: background-color 0.15s ease-in-out;
        font-family: var(--vscode-font-family);
        font-size: 13px;
        min-height: 28px;
      }

      .vscode-dropdown-option:hover:not(:disabled),
      .vscode-dropdown-option.vscode-option-focused:not(:disabled) {
        background-color: var(--vscode-list-hoverBackground);
      }

      .vscode-dropdown-option.vscode-option-selected {
        background-color: var(--vscode-list-activeSelectionBackground);
        color: var(--vscode-list-activeSelectionForeground);
      }

      .vscode-dropdown-option.vscode-option-disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }

      .vscode-option-content {
        display: flex;
        align-items: center;
        flex: 1;
        min-width: 0;
      }

      .vscode-option-icon {
        margin-right: 6px;
        font-size: 14px;
        flex-shrink: 0;
      }

      .vscode-option-text {
        display: flex;
        flex-direction: column;
        min-width: 0;
        flex: 1;
      }

      .vscode-option-label {
        font-weight: 400;
        font-size: 13px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .vscode-option-description {
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        margin-top: 2px;
      }

      .vscode-check-icon {
        width: 14px;
        height: 14px;
        margin-left: 6px;
        flex-shrink: 0;
        color: var(--vscode-list-activeSelectionForeground);
      }

      .vscode-option-group-label {
        padding: 4px 8px 2px;
        font-size: 11px;
        font-weight: 600;
        color: var(--vscode-descriptionForeground);
        text-transform: uppercase;
        letter-spacing: 0.5px;
        background-color: var(--vscode-sideBar-background);
        border-bottom: 1px solid var(--vscode-widget-border);
        position: sticky;
        top: 0;
      }

      .vscode-no-options {
        padding: 12px;
        text-align: center;
        color: var(--vscode-descriptionForeground);
        font-style: italic;
        font-size: 12px;
      }

      /* High Contrast Mode Support */
      @media (prefers-contrast: high) {
        .vscode-dropdown-option:focus {
          outline: 2px solid var(--vscode-focusBorder);
          outline-offset: -2px;
        }
      }
    `,
  ],
})
export class VSCodeDropdownOptionsListComponent {
  @Input() options: DropdownOption[] = [];
  @Input() selectedValue: string = '';
  @Input() focusedIndex: number = -1;
  @Input() hasSearchTerm: boolean = false;
  @Input() listboxId: string = '';

  @Output() optionClick = new EventEmitter<DropdownOption>();
  @Output() optionHover = new EventEmitter<number>();

  readonly Check = Check;
}
