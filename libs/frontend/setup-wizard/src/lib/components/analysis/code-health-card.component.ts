import { Component, Input, ChangeDetectionStrategy } from '@angular/core';
import {
  DiagnosticSummary,
  TestCoverageEstimate,
} from '@ptah-extension/shared';

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
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="card bg-base-200 shadow-xl">
      <div class="card-body">
        <h3 class="card-title text-lg mb-4">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            class="h-5 w-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          Code Health
        </h3>
        @if (issues) {
        <div class="mb-4">
          <span class="text-sm font-semibold text-base-content/80"
            >Existing Issues:</span
          >
          <div class="flex gap-3 mt-2">
            <div class="badge badge-error gap-1">
              {{ issues.errorCount }} errors
            </div>
            <div class="badge badge-warning gap-1">
              {{ issues.warningCount }} warnings
            </div>
            @if (issues.infoCount) {
            <div class="badge badge-info gap-1">
              {{ issues.infoCount }} info
            </div>
            }
          </div>
        </div>
        } @if (testCoverage) {
        <div>
          <span class="text-sm font-semibold text-base-content/80"
            >Test Coverage Estimate:</span
          >
          <div class="mt-2">
            @if (testCoverage.hasTests) {
            <div class="flex items-center gap-2 mb-2">
              <div
                class="radial-progress text-primary"
                [style]="
                  '--value:' + testCoverage.percentage + '; --size:4rem;'
                "
                role="progressbar"
                [attr.aria-valuenow]="testCoverage.percentage"
              >
                {{ testCoverage.percentage }}%
              </div>
              <div class="text-sm">
                @if (testCoverage.testFramework) {
                <div class="badge badge-outline badge-sm">
                  {{ testCoverage.testFramework }}
                </div>
                }
                <div class="flex flex-wrap gap-1 mt-1">
                  @if (testCoverage.hasUnitTests) {
                  <span class="badge badge-success badge-xs">Unit</span> } @if
                  (testCoverage.hasIntegrationTests) {
                  <span class="badge badge-success badge-xs">Integration</span>
                  } @if (testCoverage.hasE2eTests) {
                  <span class="badge badge-success badge-xs">E2E</span> }
                </div>
              </div>
            </div>
            } @else {
            <div class="text-sm text-base-content/60">
              <span class="badge badge-ghost">No tests detected</span>
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
  @Input({ required: true }) issues!: DiagnosticSummary;
  @Input({ required: true }) testCoverage!: TestCoverageEstimate;
}
