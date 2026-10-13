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
import type { TodoWriteToolInput } from '@ptah-extension/shared';

/**
 * TodoListDisplayComponent - Specialized display for TodoWrite tool
 *
 * Complexity Level: 2 (Molecule with computed signals)
 * Patterns: Specialized tool rendering with progress tracking
 *
 * Features:
 * - Display all todo items with status icons (pending=circle, in_progress=spinner, completed=checkmark)
 * - No progress bar: the tool-call header already reads "3 of 5 done"
 * - Active task (in_progress) shows its activeForm text in bold
 * - Completed tasks show muted text
 * - Each icon's state is named in text (`sr-only`); the spinner stops under
 *   reduced motion
 * - Pending tasks show circle icon with low opacity
 */
@Component({
  selector: 'ptah-todo-list-display',
  standalone: true,
  imports: [LucideAngularModule],
  template: `
    <div>
      <!-- Todo items -->
      <div class="space-y-1">
        @for (item of todos(); track item.content) {
          <div class="flex items-start gap-2 text-[11px]">
            <!-- Status icon -->
            @if (item.status === 'completed') {
              <lucide-angular
                [img]="CheckIcon"
                class="w-4 h-4 text-success flex-shrink-0 mt-0.5"
                aria-hidden="true"
              />
              <span class="sr-only">Done:</span>
            } @else if (item.status === 'in_progress') {
              <lucide-angular
                [img]="SpinnerIcon"
                class="w-4 h-4 text-info animate-spin motion-reduce:animate-none flex-shrink-0 mt-0.5"
                aria-hidden="true"
              />
              <span class="sr-only">In progress:</span>
            } @else {
              <lucide-angular
                [img]="CircleIcon"
                class="w-4 h-4 text-base-content-muted flex-shrink-0 mt-0.5"
                aria-hidden="true"
              />
              <span class="sr-only">Pending:</span>
            }

            <!-- Task text -->
            <div class="flex-1 min-w-0 break-words">
              @if (item.status === 'in_progress') {
                <span class="font-semibold text-base-content">
                  {{ item.activeForm }}
                </span>
              } @else if (item.status === 'completed') {
                <span class="font-medium text-base-content-muted">
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
  readonly todos = computed(() => this.toolInput().todos);
  readonly CircleIcon = Circle;
  readonly CheckIcon = CheckCircle2;
  readonly SpinnerIcon = Loader2;
}
