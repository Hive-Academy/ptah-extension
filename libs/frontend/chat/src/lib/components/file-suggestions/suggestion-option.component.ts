import {
  Component,
  input,
  output,
  ChangeDetectionStrategy,
  ElementRef,
  inject,
  computed,
} from '@angular/core';
import {
  LucideAngularModule,
  Sparkles,
  type LucideIconData,
} from 'lucide-angular';
import type { CommandSuggestion } from '@ptah-extension/core';
import type { PromptItem } from '@ptah-extension/chat-ui';
import type { FileSuggestion } from '../../services/file-picker.service';

/**
 * Type discriminated union for file, command and prompt suggestions
 * Agents are not part of this dropdown - the model picks its own sub-agents
 * Prompt rows come from the shared PROMPT_CATALOGUE (TASK_2026_721 D7).
 */
export type SuggestionItem =
  | ({ type: 'file'; icon: LucideIconData; description: string } & Omit<
      FileSuggestion,
      'type'
    >)
  | ({ type: 'command' } & CommandSuggestion)
  | ({ type: 'prompt'; category: string } & PromptItem);

/**
 * SuggestionOptionComponent - Single Option in Autocomplete Dropdown
 *
 * MIGRATION NOTE:
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
      [img]="optionIcon()"
      class="w-4 h-4 shrink-0 opacity-80"
    />

    <!-- Content area -->
    <!-- The value is bound once with an @if alias so the union narrows per
         branch; repeated suggestion() calls cannot be narrowed by the
         template type checker. -->
    <div class="flex-1 min-w-0 flex flex-col gap-0.5">
      @if (suggestion(); as s) {
        @if (s.type === 'file') {
          <!-- Files/Folders: Name prominent, directory secondary -->
          <span class="font-medium text-xs truncate">{{ s.name }}</span>
          <span class="text-[11px] opacity-70 truncate">{{
            s.description
          }}</span>
        } @else if (s.type === 'command') {
          <!-- Commands: Name with badge styling -->
          <div class="flex items-center gap-2">
            <span class="font-medium text-xs truncate">{{ s.name }}</span>
            @if (isBuiltinCommand()) {
              <span class="badge badge-accent badge-xs">Built-in</span>
            } @else if (isPluginCommand()) {
              <span class="badge badge-info badge-xs">Plugin</span>
            }
          </div>
          <span class="text-[11px] opacity-70 truncate">{{
            s.description
          }}</span>
        } @else if (s.type === 'prompt') {
          <!-- Prompts: Label with a category badge, description secondary -->
          <div class="flex items-center gap-2 min-w-0">
            <span class="font-medium text-xs truncate">{{ s.label }}</span>
            <span
              class="badge badge-ghost badge-xs text-base-content shrink-0 whitespace-nowrap"
            >
              Prompt · {{ s.category }}
            </span>
          </div>
          @if (s.description) {
            <span class="text-[11px] opacity-70 truncate">{{
              s.description
            }}</span>
          }
        }
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SuggestionOptionComponent {
  private readonly elementRef = inject(ElementRef);
  readonly suggestion = input.required<SuggestionItem>();
  readonly optionId = input.required<string>();

  /**
   * Whether this option is currently active/highlighted.
   * CONTROLLED BY PARENT - not self-managed like CDK Highlightable.
   * Parent passes this based on keyboard navigation state (i === activeIndex).
   */
  readonly isActive = input<boolean>(false);
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

  /**
   * Icon shown on the row. File and command suggestions carry their own
   * icon; prompt suggestions share one neutral glyph because the catalogue
   * only tags them with a category label.
   */
  readonly optionIcon = computed<LucideIconData>(() => {
    const suggestion = this.suggestion();
    return suggestion.type === 'prompt' ? Sparkles : suggestion.icon;
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
