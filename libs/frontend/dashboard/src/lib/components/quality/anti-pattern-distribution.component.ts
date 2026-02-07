import {
  Component,
  ChangeDetectionStrategy,
  input,
  computed,
} from '@angular/core';
import { AntiPattern, AntiPatternSeverity } from '@ptah-extension/shared';

/**
 * Category distribution entry for display
 */
interface CategoryDistribution {
  /** Display name for the category (e.g., "TypeScript", "Angular") */
  name: string;
  /** Number of anti-patterns in this category */
  count: number;
  /** Percentage of total anti-patterns */
  percentage: number;
  /** Most severe severity in this category */
  dominantSeverity: AntiPatternSeverity;
  /** DaisyUI progress bar color class */
  progressClass: string;
}

/**
 * Human-readable category names from type prefixes
 */
const CATEGORY_DISPLAY_NAMES: Record<string, string> = {
  typescript: 'TypeScript',
  error: 'Error Handling',
  arch: 'Architecture',
  test: 'Testing',
  angular: 'Angular',
  nestjs: 'NestJS',
  react: 'React',
};

/**
 * Severity ordering for determining dominant severity
 */
const SEVERITY_ORDER: Record<AntiPatternSeverity, number> = {
  error: 3,
  warning: 2,
  info: 1,
};

/**
 * AntiPatternDistributionComponent
 *
 * Displays anti-pattern counts grouped by category as horizontal
 * DaisyUI progress bars. Color coded by the most severe anti-pattern
 * in each category.
 *
 * Categories are derived from the anti-pattern type prefix
 * (e.g., "typescript-explicit-any" -> "TypeScript").
 */
@Component({
  selector: 'ptah-anti-pattern-distribution',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="card bg-base-100 shadow-sm">
      <div class="card-body p-4">
        <h3 class="card-title text-sm font-semibold">
          Anti-Pattern Distribution
        </h3>

        @if (antiPatterns().length === 0) {
        <div
          class="text-base-content/50 text-sm py-4 text-center"
          role="status"
        >
          No anti-patterns detected. Your code quality is excellent!
        </div>
        } @else {
        <div class="space-y-3 mt-2">
          @for (category of categories(); track category.name) {
          <div>
            <div class="flex justify-between items-center mb-1">
              <span class="text-sm font-medium">{{ category.name }}</span>
              <span class="text-xs opacity-60">
                {{ category.count }}
                pattern{{ category.count === 1 ? '' : 's' }}
              </span>
            </div>
            <progress
              [class]="'progress w-full ' + category.progressClass"
              [attr.value]="category.percentage"
              max="100"
              [attr.aria-label]="
                category.name +
                ': ' +
                category.count +
                ' anti-patterns (' +
                category.percentage +
                '%)'
              "
            ></progress>
          </div>
          }
        </div>

        <div class="flex gap-4 mt-3 text-xs opacity-50">
          <span class="flex items-center gap-1">
            <span class="w-2 h-2 rounded-full bg-error inline-block"></span>
            Error
          </span>
          <span class="flex items-center gap-1">
            <span class="w-2 h-2 rounded-full bg-warning inline-block"></span>
            Warning
          </span>
          <span class="flex items-center gap-1">
            <span class="w-2 h-2 rounded-full bg-info inline-block"></span>
            Info
          </span>
        </div>
        }
      </div>
    </div>
  `,
})
export class AntiPatternDistributionComponent {
  readonly antiPatterns = input.required<AntiPattern[]>();

  /**
   * Group anti-patterns by category prefix, compute percentage and severity.
   * Sorted by count descending (most prevalent categories first).
   */
  readonly categories = computed((): CategoryDistribution[] => {
    const patterns = this.antiPatterns();
    if (patterns.length === 0) return [];

    // Group by category prefix
    const grouped = new Map<
      string,
      { count: number; maxSeverity: AntiPatternSeverity }
    >();

    for (const pattern of patterns) {
      const prefix = this.extractCategoryPrefix(pattern.type);
      const existing = grouped.get(prefix) ?? {
        count: 0,
        maxSeverity: 'info' as AntiPatternSeverity,
      };

      existing.count += pattern.frequency;

      if (
        SEVERITY_ORDER[pattern.severity] > SEVERITY_ORDER[existing.maxSeverity]
      ) {
        existing.maxSeverity = pattern.severity;
      }

      grouped.set(prefix, existing);
    }

    // Find the maximum count for percentage calculation
    const maxCount = Math.max(
      ...Array.from(grouped.values()).map((v) => v.count)
    );

    // Convert to display entries and sort by count descending
    return Array.from(grouped.entries())
      .map(([prefix, data]) => ({
        name: CATEGORY_DISPLAY_NAMES[prefix] ?? prefix,
        count: data.count,
        percentage:
          maxCount > 0 ? Math.round((data.count / maxCount) * 100) : 0,
        dominantSeverity: data.maxSeverity,
        progressClass: this.getProgressClass(data.maxSeverity),
      }))
      .sort((a, b) => b.count - a.count);
  });

  /**
   * Extract the category prefix from an anti-pattern type string.
   * e.g., "typescript-explicit-any" -> "typescript"
   *       "angular-subscription-leak" -> "angular"
   */
  private extractCategoryPrefix(type: string): string {
    const dashIndex = type.indexOf('-');
    if (dashIndex === -1) return type;

    const prefix = type.substring(0, dashIndex);

    // Handle multi-word prefixes that are known categories
    if (CATEGORY_DISPLAY_NAMES[prefix]) {
      return prefix;
    }

    return prefix;
  }

  /**
   * Map severity to DaisyUI progress bar class
   */
  private getProgressClass(severity: AntiPatternSeverity): string {
    switch (severity) {
      case 'error':
        return 'progress-error';
      case 'warning':
        return 'progress-warning';
      case 'info':
        return 'progress-info';
    }
  }
}
