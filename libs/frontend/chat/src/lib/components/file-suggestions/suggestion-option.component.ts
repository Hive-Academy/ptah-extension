import {
  Component,
  input,
  output,
  ChangeDetectionStrategy,
  ElementRef,
  inject,
  signal,
} from '@angular/core';
import { Highlightable } from '@angular/cdk/a11y';
import type { CommandSuggestion } from '@ptah-extension/core';
import type { FileSuggestion } from '../../services/file-picker.service';

/**
 * Type discriminated union for file and command suggestions
 * Agents handled by AgentSelectorComponent - not part of this dropdown
 */
export type SuggestionItem =
  | ({ type: 'file'; icon: string; description: string } & Omit<
      FileSuggestion,
      'type'
    >)
  | ({ type: 'command' } & CommandSuggestion);

/**
 * SuggestionOptionComponent - Single Option in Autocomplete Dropdown
 *
 * Implements Highlightable interface for ActiveDescendantKeyManager.
 * This allows keyboard navigation while focus stays on the textarea.
 *
 * ARIA Pattern:
 * - role="option" on the option element
 * - aria-selected indicates current selection
 * - Parent uses aria-activedescendant pointing to active option's ID
 */
@Component({
  selector: 'ptah-suggestion-option',
  standalone: true,
  template: `
    <div
      [id]="optionId()"
      class="flex items-start gap-2 px-2 py-1.5 rounded-md cursor-pointer transition-colors"
      [class.bg-primary]="isActive"
      [class.text-primary-content]="isActive"
      [class.hover:bg-base-300]="!isActive"
      (click)="handleClick()"
      (mouseenter)="handleMouseEnter()"
      role="option"
      [attr.aria-selected]="isActive"
    >
      <!-- Icon -->
      <span class="shrink-0 w-4 h-4 flex items-center justify-center text-sm">
        {{ suggestion().icon }}
      </span>

      <!-- Content area -->
      <div class="flex-1 min-w-0 flex flex-col gap-0.5">
        @if (suggestion().type === 'file') {
        <!-- Files/Folders: Name prominent, directory secondary -->
        <span class="font-medium text-xs truncate">{{
          suggestion().name
        }}</span>
        <span class="text-[11px] opacity-70 truncate">{{
          suggestion().description
        }}</span>
        } @else if (suggestion().type === 'command') {
        <!-- Commands: Name with badge styling -->
        <div class="flex items-center gap-2">
          <span class="font-medium text-xs truncate">{{
            suggestion().name
          }}</span>
          @if (isBuiltinCommand()) {
          <span class="badge badge-accent badge-xs">Built-in</span>
          }
        </div>
        <span class="text-[11px] opacity-70 truncate">{{
          suggestion().description
        }}</span>
        }
      </div>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SuggestionOptionComponent implements Highlightable {
  private readonly elementRef = inject(ElementRef);

  // Inputs
  readonly suggestion = input.required<SuggestionItem>();
  readonly optionId = input.required<string>();

  // Outputs
  readonly selected = output<SuggestionItem>();
  readonly hovered = output<void>();

  // Highlightable interface state
  private readonly _isActive = signal(false);
  get isActive() {
    return this._isActive();
  }

  /**
   * Highlightable interface - called by ActiveDescendantKeyManager
   * Sets visual active state without moving focus
   */
  setActiveStyles(): void {
    this._isActive.set(true);
    // Scroll into view when activated via keyboard
    this.elementRef.nativeElement.scrollIntoView({
      block: 'nearest',
      behavior: 'smooth',
    });
  }

  /**
   * Highlightable interface - called by ActiveDescendantKeyManager
   * Removes visual active state
   */
  setInactiveStyles(): void {
    this._isActive.set(false);
  }

  handleClick(): void {
    this.selected.emit(this.suggestion());
  }

  handleMouseEnter(): void {
    this.hovered.emit();
  }

  /**
   * Check if this is a built-in command
   * Uses type narrowing to safely access scope property
   */
  isBuiltinCommand(): boolean {
    const suggestion = this.suggestion();
    return suggestion.type === 'command' && suggestion.scope === 'builtin';
  }

  /**
   * Get the native element for scrolling purposes
   */
  getHostElement(): HTMLElement {
    return this.elementRef.nativeElement;
  }
}
