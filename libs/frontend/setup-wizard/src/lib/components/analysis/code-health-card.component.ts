import { Component, ChangeDetectionStrategy, input } from '@angular/core';
import {
  DiagnosticSummary,
  TestCoverageEstimate,
} from '@ptah-extension/shared';
import { LucideAngularModule, CheckCircle } from 'lucide-angular';

/**
 * CodeHealthCardComponent - Displays diagnostics summary and test coverage estimate
 *
 * Purpose:
 * - Show existing code issues (errors, warnings, info counts)
 * - Display test coverage percentage with radial progress
 * - Show test framework badges (Unit, Integration, E2E)
 *
 * Usage:
 * ```html
 * <ptah-code-health-card [issues]="analysis.existingIssues" [testCoverage]="analysis.testCoverage" />
 * ```
 */
@Component({
  selector: 'ptah-code-health-card',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="border border-base-300 rounded-md bg-base-200/50">
      <div class="p-4">
        <h3 class="text-sm font-medium uppercase tracking-wide mb-3">
          <lucide-angular [img]="CheckCircleIcon" class="h-4 w-4" />
          Code Health
        </h3>
        @if (issues()) {
        <div class="mb-4">
          <span class="text-xs font-semibold text-base-content/80"
            >Existing Issues:</span
          >
          <div class="flex gap-2 mt-2">
            <div class="badge badge-error badge-sm gap-1">
              {{ issues().errorCount }} errors
            </div>
            <div class="badge badge-warning badge-sm gap-1">
              {{ issues().warningCount }} warnings
            </div>
            @if (issues().infoCount) {
            <div class="badge badge-info badge-sm gap-1">
              {{ issues().infoCount }} info
            </div>
            }
          </div>
        </div>
        } @if (testCoverage()) {
        <div>
          <span class="text-xs font-semibold text-base-content/80"
            >Test Coverage Estimate:</span
          >
          <div class="mt-2">
            @if (testCoverage().hasTests) {
            <div class="flex items-center gap-2 mb-3">
              <div
                class="radial-progress text-primary text-xs"
                [style]="
                  '--value:' + testCoverage().percentage + '; --size:4rem;'
                "
                role="progressbar"
                [attr.aria-valuenow]="testCoverage().percentage"
              >
                {{ testCoverage().percentage }}%
              </div>
              <div class="text-xs">
                @if (testCoverage().testFramework) {
                <div class="badge badge-outline badge-sm">
                  {{ testCoverage().testFramework }}
                </div>
                }
                <div class="flex flex-wrap gap-1 mt-2">
                  @if (testCoverage().hasUnitTests) {
                  <span class="badge badge-success badge-xs">Unit</span> } @if
                  (testCoverage().hasIntegrationTests) {
                  <span class="badge badge-success badge-xs">Integration</span>
                  } @if (testCoverage().hasE2eTests) {
                  <span class="badge badge-success badge-xs">E2E</span> }
                </div>
              </div>
            </div>
            } @else {
            <div class="text-xs text-base-content/60">
              <span class="badge badge-ghost badge-sm">No tests detected</span>
            </div>
            }
          </div>
        </div>
        }
      </div>
    </div>
  `,
})
export class CodeHealthCardComponent {
  // Lucide icon reference
  protected readonly CheckCircleIcon = CheckCircle;

  readonly issues = input.required<DiagnosticSummary>();
  readonly testCoverage = input.required<TestCoverageEstimate>();
}
