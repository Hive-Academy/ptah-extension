import {
  Component,
  input,
  output,
  ChangeDetectionStrategy,
  ElementRef,
  viewChild,
  afterNextRender,
} from '@angular/core';

/**
 * Inline text input for creating or renaming files/folders within the file tree.
 * Auto-focuses on render. Enter submits, Escape cancels.
 * For rename: selects filename portion (excluding extension).
 */
@Component({
  selector: 'ptah-file-tree-inline-input',
  standalone: true,
  template: `
    <div
      class="flex items-center px-2 py-0.5"
      [style.padding-left.px]="depth() * 16 + 8"
    >
      <input
        #inputEl
        type="text"
        class="input input-xs input-bordered w-full text-sm bg-base-100 h-6 px-1.5 focus:outline-primary"
        [value]="initialValue()"
        (keydown.enter)="onSubmit()"
        (keydown.escape)="onCancel()"
        (blur)="onBlur()"
        autocomplete="off"
        spellcheck="false"
      />
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FileTreeInlineInputComponent {
  readonly initialValue = input<string>('');
  readonly depth = input<number>(0);

  readonly submitted = output<string>();
  readonly cancelled = output<void>();

  private readonly inputRef =
    viewChild<ElementRef<HTMLInputElement>>('inputEl');
  private hasSubmitted = false;

  constructor() {
    afterNextRender(() => {
      const input = this.inputRef()?.nativeElement;
      if (!input) return;
      input.focus();

      const value = this.initialValue();
      if (value) {
        // Select filename portion (before last dot) for rename
        const dotIndex = value.lastIndexOf('.');
        if (dotIndex > 0) {
          input.setSelectionRange(0, dotIndex);
        } else {
          input.select();
        }
      }
    });
  }

  protected onSubmit(): void {
    if (this.hasSubmitted) return;
    const input = this.inputRef()?.nativeElement;
    if (!input) return;

    const value = input.value.trim();
    if (!value || value.includes('/') || value.includes('\\')) {
      this.onCancel();
      return;
    }
    this.hasSubmitted = true;
    this.submitted.emit(value);
  }

  protected onCancel(): void {
    if (this.hasSubmitted) return;
    this.hasSubmitted = true;
    this.cancelled.emit();
  }

  protected onBlur(): void {
    // Short delay to allow click events on buttons to fire first
    setTimeout(() => {
      if (this.hasSubmitted) return;
      const input = this.inputRef()?.nativeElement;
      const value = input?.value.trim();
      if (value && !value.includes('/') && !value.includes('\\')) {
        this.hasSubmitted = true;
        this.submitted.emit(value);
      } else {
        this.onCancel();
      }
    }, 100);
  }
}
