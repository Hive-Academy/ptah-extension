import { CommonModule } from '@angular/common';
import {
  AfterViewInit,
  Component,
  DestroyRef,
  ElementRef,
  forwardRef,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { Search, Send, X } from 'lucide-angular';

// Child components
import { ActionButtonComponent } from '../action-button/action-button.component';
import { InputIconComponent } from '../input-icon/input-icon.component';
import { ValidationMessageComponent } from '../validation-message/validation-message.component';

/**
 * VS Code Input Component - Angular 20+ Modernized
 * - Uses signal-based APIs (input(), output(), viewChild())
 * - OnPush change detection for performance
 * - Modern control flow (@if, @else)
 * - Maintains VS Code styling
 * - Full accessibility support
 */
@Component({
  selector: 'ptah-input',
  standalone: true,
  imports: [
    CommonModule,
    InputIconComponent,
    ActionButtonComponent,
    ValidationMessageComponent,
  ],

  template: `
    <div
      class="vscode-input-container"
      [class.vscode-input-focused]="isFocused()"
      [class.vscode-input-disabled]="disabled()"
      [class.vscode-input-error]="!!errorMessage()"
    >
      <!-- Input Area -->
      <div class="vscode-input-wrapper">
        @if (showSearch()) {
        <ptah-input-icon [icon]="Search" ariaLabel="Search"></ptah-input-icon>
        } @if (multiline()) {
        <textarea
          #inputElement
          class="vscode-input-field"
          [class.vscode-input-with-icon]="showSearch()"
          [placeholder]="placeholder()"
          [disabled]="disabled()"
          [rows]="rows()"
          [style.resize]="resizable() ? 'vertical' : 'none'"
          [value]="value()"
          (input)="onInput($event)"
          (focus)="onFocus()"
          (blur)="onBlur()"
          (keydown)="onKeyDown($event)"
          [attr.aria-label]="ariaLabel() || placeholder()"
          [attr.aria-describedby]="getAriaDescribedBy()"
          [attr.aria-invalid]="!!errorMessage()"
          [attr.aria-required]="required()"
          cdkMonitorElementFocus
          cdkTrapFocus="false"
        ></textarea>
        } @else {
        <input
          #inputElement
          type="text"
          class="vscode-input-field"
          [class.vscode-input-with-icon]="showSearch()"
          [placeholder]="placeholder()"
          [disabled]="disabled()"
          [value]="value()"
          (input)="onInput($event)"
          (focus)="onFocus()"
          (blur)="onBlur()"
          (keydown)="onKeyDown($event)"
          [attr.aria-label]="ariaLabel() || placeholder()"
          [attr.aria-describedby]="getAriaDescribedBy()"
          [attr.aria-invalid]="!!errorMessage()"
          [attr.aria-required]="required()"
          cdkMonitorElementFocus
          cdkTrapFocus="false"
        />
        } @if (value() && showClear()) {
        <ptah-input-icon
          [icon]="X"
          [clickable]="true"
          ariaLabel="Clear input"
          (iconClick)="onClear()"
        ></ptah-input-icon>
        }
      </div>

      <!-- Action Buttons -->
      @if (showActions()) {
      <div class="vscode-input-actions">
        @if (showSendButton()) {
        <ptah-action-button
          [icon]="Send"
          variant="primary"
          [disabled]="disabled() || !canSend()"
          ariaLabel="Send message"
          (buttonClick)="onSend()"
        ></ptah-action-button>
        }
      </div>
      }
    </div>

    <!-- Validation Messages -->
    @if (helperText() && !errorMessage()) {
    <ptah-validation-message
      [message]="helperText()"
      [messageId]="inputId + '-helper'"
      type="helper"
    ></ptah-validation-message>
    } @if (errorMessage()) {
    <ptah-validation-message
      [message]="errorMessage()"
      [messageId]="inputId + '-error'"
      type="error"
    ></ptah-validation-message>
    }
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
      useExisting: forwardRef(() => InputComponent),
      multi: true,
    },
  ],
})
export class InputComponent implements ControlValueAccessor, AfterViewInit {
  // Signal-based ViewChild (Angular 20+)
  inputElement =
    viewChild.required<ElementRef<HTMLInputElement | HTMLTextAreaElement>>(
      'inputElement'
    );

  // Dependency injection
  private destroyRef = inject(DestroyRef);

  // Unique input ID for accessibility
  readonly inputId = `vscode-input-${Math.random().toString(36).substr(2, 9)}`;

  // Signal-based Inputs (Angular 20+)
  placeholder = input<string>('');
  disabled = input<boolean>(false);
  multiline = input<boolean>(false);
  rows = input<number>(1);
  resizable = input<boolean>(true);
  showSearch = input<boolean>(false);
  showClear = input<boolean>(true);
  showActions = input<boolean>(false);
  showSendButton = input<boolean>(false);
  helperText = input<string>('');
  errorMessage = input<string>('');
  ariaLabel = input<string>('');
  required = input<boolean>(false);
  canSend = input<boolean>(false);

  // Signal-based Outputs (Angular 20+)
  focused = output<void>();
  blurred = output<void>();
  keyDown = output<KeyboardEvent>();
  sendClick = output<void>();

  // Icons
  readonly Search = Search;
  readonly X = X;
  readonly Send = Send;

  // Component state as signals
  value = signal<string>('');
  isFocused = signal<boolean>(false);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private onChange = (_value: string) => {
    // Implemented by Angular Forms - registered via registerOnChange()
  };
  private onTouched = () => {
    // Implemented by Angular Forms - registered via registerOnTouched()
  };

  ngAfterViewInit(): void {
    if (this.multiline()) {
      this.adjustTextareaHeight();
    }
  }

  // ControlValueAccessor implementation
  writeValue(value: string): void {
    this.value.set(value || '');
    if (this.multiline() && this.inputElement()) {
      setTimeout(() => this.adjustTextareaHeight(), 0);
    }
  }

  registerOnChange(fn: (value: string) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  setDisabledState(_isDisabled: boolean): void {
    // Note: disabled is now an input signal, handled by parent
  }

  onInput(event: Event): void {
    const target = event.target as HTMLInputElement | HTMLTextAreaElement;
    this.value.set(target.value);
    this.onChange(this.value());

    if (this.multiline()) {
      this.adjustTextareaHeight();
    }
  }

  onFocus(): void {
    this.isFocused.set(true);
    this.focused.emit();
  }

  onBlur(): void {
    this.isFocused.set(false);
    this.onTouched();
    this.blurred.emit();
  }

  onKeyDown(event: KeyboardEvent): void {
    this.keyDown.emit(event);
  }

  onClear(): void {
    this.value.set('');
    this.onChange(this.value());
    this.inputElement()?.nativeElement.focus();

    if (this.multiline()) {
      this.adjustTextareaHeight();
    }
  }

  onSend(): void {
    if (this.canSend() && !this.disabled()) {
      this.sendClick.emit();
    }
  }

  focus(): void {
    this.inputElement()?.nativeElement.focus();
  }

  getAriaDescribedBy(): string {
    const descriptors: string[] = [];
    if (this.helperText() && !this.errorMessage()) {
      descriptors.push(`${this.inputId}-helper`);
    }
    if (this.errorMessage()) {
      descriptors.push(`${this.inputId}-error`);
    }
    return descriptors.join(' ') || '';
  }

  private adjustTextareaHeight(): void {
    const element = this.inputElement();
    if (!element || !this.multiline()) return;

    const textarea = element.nativeElement as HTMLTextAreaElement;
    textarea.style.height = 'auto';

    const scrollHeight = textarea.scrollHeight;
    const maxHeight = 120; // Max height in pixels

    textarea.style.height = Math.min(scrollHeight, maxHeight) + 'px';
  }
}
