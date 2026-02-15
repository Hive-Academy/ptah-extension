import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import {
  AlertTriangle,
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
    <div class="card bg-base-200/50 border border-base-300">
      <div class="card-body p-3">
        <!-- Header -->
        <div class="flex items-center gap-2 mb-2">
          <lucide-angular
            [img]="SparklesIcon"
            class="w-4 h-4 text-primary"
            aria-hidden="true"
          />
          <h3 class="text-sm font-semibold">Generated Guidance</h3>
          @if (summaryData().usedFallback) {
          <span class="badge badge-warning badge-xs gap-1">
            <lucide-angular
              [img]="AlertTriangleIcon"
              class="w-2.5 h-2.5"
              aria-hidden="true"
            />
            fallback
          </span>
          }
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
              class="w-3.5 h-3.5 text-base-content/30 shrink-0"
              aria-hidden="true"
            />
            }
            <div class="min-w-0 flex-1">
              <span class="text-xs font-medium truncate block">{{
                section.name
              }}</span>
              <span class="text-[10px] text-base-content/50">
                {{ section.wordCount }} words
              </span>
            </div>
          </div>
          }
        </div>

        <!-- Footer: Total tokens -->
        <div
          class="flex items-center justify-between mt-2 pt-2 border-t border-base-300/30"
        >
          <span class="text-[10px] text-base-content/40">
            {{ generatedCount() }} of {{ sections().length }} sections generated
          </span>
          <span class="badge badge-ghost badge-xs">
            {{ summaryData().totalTokens }} tokens
          </span>
        </div>
      </div>
    </div>
  `,
})
export class EnhancedPromptsSummaryCardComponent {
  /** Summary data from the backend */
  readonly summary = input.required<EnhancedPromptsSummary>();

  protected readonly SparklesIcon = Sparkles;
  protected readonly CircleCheckIcon = CircleCheck;
  protected readonly AlertTriangleIcon = AlertTriangle;
  protected readonly FileTextIcon = FileText;

  /** Alias for template readability */
  protected readonly summaryData = this.summary;

  /** Section list for the grid */
  protected readonly sections = computed(() => this.summary().sections);

  /** Count of successfully generated sections */
  protected readonly generatedCount = computed(
    () => this.summary().sections.filter((s) => s.generated).length
  );
}
