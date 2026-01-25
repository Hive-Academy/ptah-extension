import { Component, Input, ChangeDetectionStrategy } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { LucideAngularModule, Code2 } from 'lucide-angular';
import { LanguageStats } from '@ptah-extension/shared';

/**
 * TechStackSummaryComponent - Displays project overview and language distribution
 *
 * Purpose:
 * - Show project type, file count, and detected frameworks
 * - Display monorepo information if applicable
 * - Show language distribution with progress bars
 *
 * Features:
 * - Project type badge
 * - Framework badges
 * - Monorepo indicator with type
 * - Language distribution progress bars with percentages
 *
 * Usage:
 * ```html
 * <ptah-tech-stack-summary
 *   [projectType]="analysis.projectType"
 *   [fileCount]="analysis.fileCount"
 *   [frameworks]="analysis.frameworks"
 *   [monorepoType]="analysis.monorepoType"
 *   [languageDistribution]="analysis.languageDistribution"
 * />
 * ```
 */
@Component({
  selector: 'ptah-tech-stack-summary',
  standalone: true,
  imports: [DecimalPipe, LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- Project Overview Card -->
    <div class="card bg-base-200 shadow-xl mb-6">
      <div class="card-body">
        <h3 class="card-title text-2xl mb-4">Project Overview</h3>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <!-- Project Type -->
          <div>
            <span class="font-semibold text-base-content/80"
              >Project Type:</span
            >
            <span class="ml-2 badge badge-primary badge-lg">{{
              projectType
            }}</span>
          </div>

          <!-- File Count -->
          <div>
            <span class="font-semibold text-base-content/80">Total Files:</span>
            <span class="ml-2 text-base-content">{{ fileCount | number }}</span>
          </div>

          <!-- Frameworks -->
          <div class="md:col-span-2">
            <span class="font-semibold text-base-content/80">Frameworks:</span>
            <div class="flex flex-wrap gap-2 mt-2">
              @for (framework of frameworks; track framework) {
              <span class="badge badge-secondary">{{ framework }}</span>
              } @empty {
              <span class="text-base-content/60 text-sm"
                >No frameworks detected</span
              >
              }
            </div>
          </div>

          <!-- Monorepo Information -->
          @if (monorepoType) {
          <div class="md:col-span-2">
            <span class="font-semibold text-base-content/80">Monorepo:</span>
            <span class="ml-2 text-success">
              Yes
              <span class="text-base-content/60 text-sm"
                >({{ monorepoType }})</span
              >
            </span>
          </div>
          }
        </div>
      </div>
    </div>

    <!-- Language Distribution Card -->
    @if (languageDistribution && languageDistribution.length > 0) {
    <div class="card bg-base-200 shadow-xl mb-6">
      <div class="card-body">
        <h3 class="card-title text-lg mb-4">
          <lucide-angular
            [img]="Code2Icon"
            class="h-5 w-5"
            aria-hidden="true"
          />
          Language Distribution
        </h3>

        <div class="space-y-3">
          @for (lang of languageDistribution; track lang.language) {
          <div>
            <div class="flex justify-between text-sm mb-1">
              <span class="font-medium">{{ lang.language }}</span>
              <span class="text-base-content/70"
                >{{ lang.percentage }}% ({{ lang.fileCount }} files)</span
              >
            </div>
            <progress
              class="progress progress-info w-full"
              [value]="lang.percentage"
              max="100"
              [attr.aria-label]="
                lang.language + ': ' + lang.percentage + ' percent'
              "
            ></progress>
          </div>
          }
        </div>
      </div>
    </div>
    }
  `,
})
export class TechStackSummaryComponent {
  protected readonly Code2Icon = Code2;

  /**
   * Project type (e.g., 'Angular', 'Node.js', 'React').
   */
  @Input({ required: true }) projectType!: string;

  /**
   * Total file count in the project.
   */
  @Input({ required: true }) fileCount!: number;

  /**
   * List of detected frameworks.
   */
  @Input({ required: true }) frameworks!: string[];

  /**
   * Monorepo type if applicable (e.g., 'Nx', 'Lerna').
   */
  @Input() monorepoType?: string;

  /**
   * Language distribution statistics.
   */
  @Input() languageDistribution?: LanguageStats[];
}
