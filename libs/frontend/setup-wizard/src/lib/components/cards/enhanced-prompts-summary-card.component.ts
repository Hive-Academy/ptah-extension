import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import {
  CircleCheck,
  FileText,
  LucideAngularModule,
  Sparkles,
} from 'lucide-angular';
import type { EnhancedPromptsSummary } from '@ptah-extension/shared';

/**
 * EnhancedPromptsSummaryCardComponent - Shows what guidance sections were generated
 *
 * Displays a grid of mini-cards, one per guidance section, with word counts.
 * Never shows actual prompt content (IP protection).
 *
 * Usage:
 * ```html
 * <ptah-enhanced-prompts-summary-card [summary]="summaryData" />
 * ```
 */
@Component({
  selector: 'ptah-enhanced-prompts-summary-card',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="card surface-2">
      <div class="card-body p-3">
        <!-- Header -->
        <div class="flex items-center gap-2 mb-2">
          <lucide-angular
            [img]="SparklesIcon"
            class="w-4 h-4 text-primary"
            aria-hidden="true"
          />
          <h3 class="text-sm font-semibold">Generated Guidance</h3>
        </div>

        <!-- Section Grid -->
        <div class="grid grid-cols-2 gap-2">
          @for (section of sections(); track section.name) {
            <div
              class="flex items-center gap-2 px-2 py-1.5 rounded-md bg-base-100/50 border border-base-300/50"
            >
              @if (section.generated) {
                <lucide-angular
                  [img]="CircleCheckIcon"
                  class="w-3.5 h-3.5 text-success shrink-0"
                  aria-hidden="true"
                />
              } @else {
                <lucide-angular
                  [img]="FileTextIcon"
                  class="w-3.5 h-3.5 text-base-content-muted shrink-0"
                  aria-hidden="true"
                />
              }
              <div class="min-w-0 flex-1">
                <span class="text-xs font-medium truncate block">{{
                  section.name
                }}</span>
                <span class="text-[10px] text-base-content-muted">
                  {{ section.wordCount }} words
                </span>
              </div>
            </div>
          }
        </div>

        <!-- Section count -->
        <div
          class="flex items-center justify-between mt-2 pt-2 border-t border-base-300/30"
        >
          <span class="text-[10px] text-base-content-muted">
            {{ generatedCount() }} of {{ sections().length }} sections generated
          </span>
        </div>
      </div>
    </div>
  `,
})
export class EnhancedPromptsSummaryCardComponent {
  /** Summary data from the backend */
  public readonly summary = input.required<Pick<EnhancedPromptsSummary, 'sections'>>();

  protected readonly SparklesIcon = Sparkles;
  protected readonly CircleCheckIcon = CircleCheck;
  protected readonly FileTextIcon = FileText;

  /** Section list for the grid */
  protected readonly sections = computed(() =>
    this.summary().sections.filter((section) => section.name !== 'Quality Guidance'),
  );

  /** Count of successfully generated sections */
  protected readonly generatedCount = computed(
    () => this.sections().filter((s) => s.generated).length,
  );
}
