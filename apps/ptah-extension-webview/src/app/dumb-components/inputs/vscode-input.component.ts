import { CommonModule } from '@angular/common';
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  EventEmitter,
  forwardRef,
  inject,
  Input,
  Output,
  ViewChild,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { Search, Send, X } from 'lucide-angular';

// Child components
import { VSCodeActionButtonComponent } from './action-button.component';
import { VSCodeInputIconComponent } from './input-icon.component';
import { VSCodeValidationMessageComponent } from './validation-message.component';

/**
 * VS Code Input Component - Refactored & Clean
 * - Uses child components for maintainability
 * - No Tailwind classes
 * - Pure VS Code styling
 * - Proper accessibility
 */
@Component({
  selector: 'vscode-input',
  standalone: true,
  imports: [
    CommonModule,
    VSCodeInputIconComponent,
    VSCodeActionButtonComponent,
    VSCodeValidationMessageComponent,
  ],

  template: `
    <div
      class="vscode-input-container"
      [class.vscode-input-focused]="isFocused"
      [class.vscode-input-disabled]="disabled"
      [class.vscode-input-error]="!!errorMessage"
    >
      <!-- Input Area -->
      <div class="vscode-input-wrapper">
        @if (showSearch) {
          <vscode-input-icon [icon]="Search" ariaLabel="Search"></vscode-input-icon>
        }

        @if (multiline) {
          <textarea
            #inputElement
            class="vscode-input-field"
            [class.vscode-input-with-icon]="showSearch"
            [placeholder]="placeholder"
            [disabled]="disabled"
            [rows]="rows"
            [style.resize]="resizable ? 'vertical' : 'none'"
            [value]="value"
            (input)="onInput($event)"
            (focus)="onFocus()"
            (blur)="onBlur()"
            (keydown)="onKeyDown($event)"
            [attr.aria-label]="ariaLabel || placeholder"
            [attr.aria-describedby]="getAriaDescribedBy()"
            [attr.aria-invalid]="!!errorMessage"
            [attr.aria-required]="required"
            cdkMonitorElementFocus
            cdkTrapFocus="false"
          ></textarea>
        } @else {
          <input
            #inputElement
            type="text"
            class="vscode-input-field"
            [class.vscode-input-with-icon]="showSearch"
            [placeholder]="placeholder"
            [disabled]="disabled"
            [value]="value"
            (input)="onInput($event)"
            (focus)="onFocus()"
            (blur)="onBlur()"
            (keydown)="onKeyDown($event)"
            [attr.aria-label]="ariaLabel || placeholder"
            [attr.aria-describedby]="getAriaDescribedBy()"
            [attr.aria-invalid]="!!errorMessage"
            [attr.aria-required]="required"
            cdkMonitorElementFocus
            cdkTrapFocus="false"
          />
        }

        @if (value && showClear) {
          <vscode-input-icon
            [icon]="X"
            [clickable]="true"
            ariaLabel="Clear input"
            (iconClick)="onClear()"
          ></vscode-input-icon>
        }
      </div>

      <!-- Action Buttons -->
      @if (showActions) {
        <div class="vscode-input-actions">
          @if (showSendButton) {
            <vscode-action-button
              [icon]="Send"
              variant="primary"
              [disabled]="disabled || !canSend"
              ariaLabel="Send message"
              (buttonClick)="onSend()"
            ></vscode-action-button>
          }
        </div>
      }
    </div>

    <!-- Validation Messages -->
    <vscode-validation-message
      [message]="helperText"
      [messageId]="inputId + '-helper'"
      type="helper"
      *ngIf="helperText && !errorMessage"
    ></vscode-validation-message>

    <vscode-validation-message
      [message]="errorMessage"
      [messageId]="inputId + '-error'"
      type="error"
      *ngIf="errorMessage"
    ></vscode-validation-message>
  `,
  styles: [
    `
      .vscode-input-container {
        display: flex;
        width: 100%;
        position: relative;
        min-height: 32px;
        background-color: var(--vscode-input-background);
        border: 1px solid var(--vscode-input-border);
        border-radius: 4px;
        transition: border-color 0.15s ease-in-out;
      }

      .vscode-input-focused {
        border-color: var(--vscode-focusBorder);
        box-shadow: 0 0 0 1px var(--vscode-focusBorder);
      }

      .vscode-input-disabled {
        opacity: 0.6;
        cursor: not-allowed;
        background-color: var(--vscode-sideBar-background);
      }

      .vscode-input-error {
        border-color: var(--vscode-inputValidation-errorBorder);
        box-shadow: 0 0 0 1px var(--vscode-inputValidation-errorBorder);
      }

      .vscode-input-wrapper {
        display: flex;
        align-items: center;
        flex: 1;
        min-height: 32px;
        position: relative;
      }

      .vscode-input-field {
        flex: 1;
        border: none;
        outline: none;
        background: transparent;
        font-family: var(--vscode-font-family);
        font-size: var(--vscode-font-size);
        color: var(--vscode-input-foreground);
        padding: 8px;
        min-height: 30px;
        resize: none;
      }

      .vscode-input-with-icon {
        padding-left: 4px;
      }

      .vscode-input-field::placeholder {
        color: var(--vscode-input-placeholderForeground);
      }

      .vscode-input-field:disabled {
        cursor: not-allowed;
        color: var(--vscode-disabledForeground);
      }

      .vscode-input-actions {
        display: flex;
        align-items: center;
        gap: 2px;
        padding: 4px;
        border-left: 1px solid var(--vscode-input-border);
      }

      /* Multiline specific styles */
      textarea.vscode-input-field {
        line-height: 1.4;
        min-height: 18px;
        max-height: 120px;
        overflow-y: auto;
      }

      textarea.vscode-input-field::-webkit-scrollbar {
        width: 4px;
      }

      textarea.vscode-input-field::-webkit-scrollbar-track {
        background: transparent;
      }

      textarea.vscode-input-field::-webkit-scrollbar-thumb {
        background: var(--vscode-scrollbarSlider-background);
        border-radius: 2px;
      }
    `,
  ],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => VSCodeInputComponent),
      multi: true,
    },
  ],
})
export class VSCodeInputComponent implements ControlValueAccessor, AfterViewInit {
  @ViewChild('inputElement') inputElement!: ElementRef<HTMLInputElement | HTMLTextAreaElement>;

  // Dependency injection
  private destroyRef = inject(DestroyRef);

  // Unique input ID for accessibility
  readonly inputId = `vscode-input-${Math.random().toString(36).substr(2, 9)}`;

  @Input() placeholder = '';
  @Input() disabled = false;
  @Input() multiline = false;
  @Input() rows = 1;
  @Input() resizable = true;
  @Input() showSearch = false;
  @Input() showClear = true;
  @Input() showActions = false;
  @Input() showSendButton = false;
  @Input() helperText = '';
  @Input() errorMessage = '';
  @Input() ariaLabel = '';
  @Input() required = false;
  @Input() canSend = false;

  @Output() focused = new EventEmitter<void>();
  @Output() blurred = new EventEmitter<void>();
  @Output() keyDown = new EventEmitter<KeyboardEvent>();
  @Output() sendClick = new EventEmitter<void>();

  // Icons
  readonly Search = Search;
  readonly X = X;
  readonly Send = Send;

  value = '';
  isFocused = false;

  private onChange = (value: string) => {};
  private onTouched = () => {};

  ngAfterViewInit(): void {
    if (this.multiline) {
      this.adjustTextareaHeight();
    }
  }

  // ControlValueAccessor implementation
  writeValue(value: string): void {
    this.value = value || '';
    if (this.multiline && this.inputElement) {
      setTimeout(() => this.adjustTextareaHeight(), 0);
    }
  }

  registerOnChange(fn: (value: string) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.disabled = isDisabled;
  }

  onInput(event: Event): void {
    const target = event.target as HTMLInputElement | HTMLTextAreaElement;
    this.value = target.value;
    this.onChange(this.value);

    if (this.multiline) {
      this.adjustTextareaHeight();
    }
  }

  onFocus(): void {
    this.isFocused = true;
    this.focused.emit();
  }

  onBlur(): void {
    this.isFocused = false;
    this.onTouched();
    this.blurred.emit();
  }

  onKeyDown(event: KeyboardEvent): void {
    this.keyDown.emit(event);
  }

  onClear(): void {
    this.value = '';
    this.onChange(this.value);
    this.inputElement.nativeElement.focus();

    if (this.multiline) {
      this.adjustTextareaHeight();
    }
  }

  onSend(): void {
    if (this.canSend && !this.disabled) {
      this.sendClick.emit();
    }
  }

  focus(): void {
    this.inputElement?.nativeElement.focus();
  }

  getAriaDescribedBy(): string {
    const descriptors: string[] = [];
    if (this.helperText && !this.errorMessage) {
      descriptors.push(`${this.inputId}-helper`);
    }
    if (this.errorMessage) {
      descriptors.push(`${this.inputId}-error`);
    }
    return descriptors.join(' ') || '';
  }

  private adjustTextareaHeight(): void {
    if (!this.inputElement || !this.multiline) return;

    const textarea = this.inputElement.nativeElement as HTMLTextAreaElement;
    textarea.style.height = 'auto';

    const scrollHeight = textarea.scrollHeight;
    const maxHeight = 120; // Max height in pixels

    textarea.style.height = Math.min(scrollHeight, maxHeight) + 'px';
  }
}
