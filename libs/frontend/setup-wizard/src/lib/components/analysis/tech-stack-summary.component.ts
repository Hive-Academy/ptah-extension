import { Component, ChangeDetectionStrategy, input } from '@angular/core';
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
    <div class="border border-base-300 rounded-md bg-base-200/50 mb-4">
      <div class="p-4">
        <h3 class="text-sm font-medium uppercase tracking-wide mb-3">
          Project Overview
        </h3>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          <!-- Project Type -->
          <div>
            <span class="font-semibold text-base-content/80 text-xs"
              >Project Type:</span
            >
            @if (projectTypeDescription()) {
            <span class="ml-2 badge badge-primary badge-sm">{{
              projectTypeDescription()
            }}</span>
            } @else {
            <span class="ml-2 badge badge-primary badge-sm">{{
              projectType()
            }}</span>
            }
          </div>

          <!-- File Count -->
          <div>
            <span class="font-semibold text-base-content/80 text-xs"
              >Total Files:</span
            >
            <span class="ml-2 text-base-content text-xs">{{
              fileCount() | number
            }}</span>
          </div>

          <!-- Frameworks -->
          <div class="md:col-span-2">
            <span class="font-semibold text-base-content/80 text-xs"
              >Frameworks:</span
            >
            <div class="flex flex-wrap gap-2 mt-2">
              @for (framework of frameworks(); track framework) {
              <span class="badge badge-secondary badge-sm">{{
                framework
              }}</span>
              } @empty {
              <span class="text-base-content/60 text-xs"
                >No frameworks detected</span
              >
              }
            </div>
          </div>

          <!-- Monorepo Information -->
          @if (monorepoType()) {
          <div class="md:col-span-2">
            <span class="font-semibold text-base-content/80 text-xs"
              >Monorepo:</span
            >
            <span class="ml-2 text-success text-xs">
              Yes
              <span class="text-base-content/60 text-xs"
                >({{ monorepoType() }})</span
              >
            </span>
          </div>
          }
        </div>
      </div>
    </div>

    <!-- Language Distribution Card -->
    @if (languageDistribution(); as langs) { @if (langs.length > 0) {
    <div class="border border-base-300 rounded-md bg-base-200/50 mb-4">
      <div class="p-4">
        <h3 class="text-sm font-medium uppercase tracking-wide mb-3">
          <lucide-angular
            [img]="Code2Icon"
            class="h-4 w-4"
            aria-hidden="true"
          />
          Language Distribution
        </h3>

        <div class="space-y-3">
          @for (lang of langs; track lang.language) {
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
    } }
  `,
})
export class TechStackSummaryComponent {
  protected readonly Code2Icon = Code2;

  /**
   * Project type enum value (e.g., 'angular', 'node', 'react').
   * Fallback display when projectTypeDescription is not available.
   */
  readonly projectType = input.required<string>();

  /**
   * Agent's rich project type description (e.g., "React SPA with Supabase Backend").
   * Displayed to users when available, preserving the agent's intelligent analysis.
   */
  readonly projectTypeDescription = input<string>();

  /**
   * Total file count in the project.
   */
  readonly fileCount = input.required<number>();

  /**
   * List of detected frameworks.
   */
  readonly frameworks = input.required<string[]>();

  /**
   * Monorepo type if applicable (e.g., 'Nx', 'Lerna').
   */
  readonly monorepoType = input<string>();

  /**
   * Language distribution statistics.
   */
  readonly languageDistribution = input<LanguageStats[]>();
}
