import {
  Component,
  input,
  computed,
  ChangeDetectionStrategy,
} from '@angular/core';
import {
  LucideAngularModule,
  Circle,
  CheckCircle2,
  Loader2,
} from 'lucide-angular';
import type { TodoItem, TodoWriteToolInput } from '@ptah-extension/shared';

/**
 * TodoListDisplayComponent - Specialized display for TodoWrite tool
 *
 * Complexity Level: 2 (Molecule with computed signals)
 * Patterns: Specialized tool rendering with progress tracking
 *
 * Features:
 * - Display all todo items with status icons (pending=circle, in_progress=spinner, completed=checkmark)
 * - Show progress bar with completion percentage
 * - Active task (in_progress) shows activeForm text with pulse animation
 * - Completed tasks show faded text
 * - Pending tasks show circle icon with low opacity
 */

// Re-export for backwards compatibility - use `TodoWriteToolInput` instead
/** @deprecated Use TodoWriteToolInput from @ptah-extension/shared */
export type TodoWriteInput = TodoWriteToolInput;
export type { TodoItem };

@Component({
  selector: 'ptah-todo-list-display',
  standalone: true,
  imports: [LucideAngularModule],
  template: `
    <div class="space-y-2">
      <!-- Progress bar -->
      <div class="flex items-center gap-2 text-[10px]">
        <div class="flex-1 h-1.5 bg-base-300 rounded-full overflow-hidden">
          <div
            class="h-full bg-success transition-all duration-300 [width:var(--progress-width)]"
            [style]="'--progress-width:' + progressPercentage() + '%'"
          ></div>
        </div>
        <span class="text-base-content/60 font-mono">
          {{ completedCount() }}/{{ totalCount() }}
        </span>
      </div>

      <!-- Todo items -->
      <div class="space-y-1">
        @for (item of todos(); track item.content) {
        <div class="flex items-start gap-2 text-[11px]">
          <!-- Status icon -->
          @if (item.status === 'completed') {
          <lucide-angular
            [img]="CheckIcon"
            class="w-4 h-4 text-success flex-shrink-0 mt-0.5"
          />
          } @else if (item.status === 'in_progress') {
          <lucide-angular
            [img]="SpinnerIcon"
            class="w-4 h-4 text-info animate-spin flex-shrink-0 mt-0.5"
          />
          } @else {
          <lucide-angular
            [img]="CircleIcon"
            class="w-4 h-4 text-base-content/30 flex-shrink-0 mt-0.5"
          />
          }

          <!-- Task text -->
          <div class="flex-1">
            @if (item.status === 'in_progress') {
            <span class="font-medium text-info animate-pulse">
              {{ item.activeForm }}
            </span>
            } @else if (item.status === 'completed') {
            <span class="font-medium text-base-content/50">
              {{ item.content }}
            </span>
            } @else {
            <span class="font-medium">
              {{ item.content }}
            </span>
            }
          </div>
        </div>
        }
      </div>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TodoListDisplayComponent {
  readonly toolInput = input.required<TodoWriteToolInput>();

  // Computed signals for reactive data
  readonly todos = computed(() => this.toolInput().todos);
  readonly totalCount = computed(() => this.todos().length);
  readonly completedCount = computed(
    () => this.todos().filter((t: TodoItem) => t.status === 'completed').length
  );
  readonly progressPercentage = computed(() =>
    this.totalCount() > 0
      ? (this.completedCount() / this.totalCount()) * 100
      : 0
  );

  // Icons
  readonly CircleIcon = Circle;
  readonly CheckIcon = CheckCircle2;
  readonly SpinnerIcon = Loader2;
}
