import {
  Component,
  input,
  output,
  ChangeDetectionStrategy,
  ElementRef,
  inject,
  computed,
} from '@angular/core';
import { LucideAngularModule, type LucideIconData } from 'lucide-angular';
import type { CommandSuggestion } from '@ptah-extension/core';
import type { FileSuggestion } from '../../services/file-picker.service';

/**
 * Type discriminated union for file and command suggestions
 * Agents handled by AgentSelectorComponent - not part of this dropdown
 */
export type SuggestionItem =
  | ({ type: 'file'; icon: LucideIconData; description: string } & Omit<
      FileSuggestion,
      'type'
    >)
  | ({ type: 'command' } & CommandSuggestion);

/**
 * SuggestionOptionComponent - Single Option in Autocomplete Dropdown
 *
 * MIGRATION NOTE (TASK_2025_092 Batch 4):
 * - Removed Highlightable interface (was causing signal dependency loops)
 * - Removed setActiveStyles/setInactiveStyles methods
 * - Active state now controlled via isActive INPUT signal from parent
 * - This pattern avoids the CDK ActiveDescendantKeyManager signal issues
 *
 * ARIA Pattern:
 * - role="option" on the option element
 * - aria-selected indicates current selection
 * - Parent uses aria-activedescendant pointing to active option's ID
 */
@Component({
  selector: 'ptah-suggestion-option',
  imports: [LucideAngularModule],
  host: {
    '[id]': 'optionId()',
    class:
      'flex items-start gap-2 px-2 py-1.5 rounded-md cursor-pointer transition-colors',
    '[class.bg-primary]': 'isActive()',
    '[class.text-primary-content]': 'isActive()',
    '[class.hover:bg-base-300]': '!isActive()',
    '(click)': 'handleClick()',
    '(mouseenter)': 'handleMouseEnter()',
    role: 'option',
    '[attr.aria-selected]': 'isActive()',
    tabindex: '-1',
  },
  template: `
    <!-- Icon -->
    <lucide-angular
      [img]="suggestion().icon"
      class="w-4 h-4 shrink-0 opacity-80"
    />

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
          } @else if (isPluginCommand()) {
            <span class="badge badge-info badge-xs">Plugin</span>
          }
        </div>
        <span class="text-[11px] opacity-70 truncate">{{
          suggestion().description
        }}</span>
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SuggestionOptionComponent {
  private readonly elementRef = inject(ElementRef);

  // Inputs
  readonly suggestion = input.required<SuggestionItem>();
  readonly optionId = input.required<string>();

  /**
   * Whether this option is currently active/highlighted.
   * CONTROLLED BY PARENT - not self-managed like CDK Highlightable.
   * Parent passes this based on keyboard navigation state (i === activeIndex).
   */
  readonly isActive = input<boolean>(false);

  // Outputs
  readonly selected = output<SuggestionItem>();
  readonly hovered = output<void>();

  /**
   * Computed signal to check if this is a built-in command.
   * Uses type narrowing to safely access scope property.
   */
  readonly isBuiltinCommand = computed(() => {
    const suggestion = this.suggestion();
    return suggestion.type === 'command' && suggestion.scope === 'builtin';
  });

  /**
   * Computed signal to check if this is a plugin command/skill.
   */
  readonly isPluginCommand = computed(() => {
    const suggestion = this.suggestion();
    return suggestion.type === 'command' && suggestion.scope === 'plugin';
  });

  handleClick(): void {
    this.selected.emit(this.suggestion());
  }

  handleMouseEnter(): void {
    this.hovered.emit();
  }

  /**
   * Scroll this option into view.
   * Called by parent when this becomes active via keyboard navigation.
   */
  scrollIntoView(): void {
    this.elementRef.nativeElement.scrollIntoView({
      block: 'nearest',
      behavior: 'smooth',
    });
  }

  /**
   * Get the native element for scrolling purposes
   */
  getHostElement(): HTMLElement {
    return this.elementRef.nativeElement;
  }
}
