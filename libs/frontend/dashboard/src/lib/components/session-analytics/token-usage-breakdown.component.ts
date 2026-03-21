import { Component, ChangeDetectionStrategy, input } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { TokenBreakdownData } from '../../services/session-analytics-state.service';
import { formatTokenCount } from '../../utils/format.utils';

/**
 * TokenUsageBreakdownComponent
 *
 * Presentational component that displays token distribution across categories
 * (input, output, cache read, cache creation) using DaisyUI progress bars.
 *
 * Cache bars are conditionally hidden when their counts are zero.
 * Shows an empty state when no token data is available.
 */
@Component({
  selector: 'ptah-token-usage-breakdown',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe],
  template: `
    <div
      class="bg-base-200/50 rounded-lg p-4 border border-base-300"
      role="region"
      aria-label="Token usage breakdown"
    >
      <h3 class="text-sm font-semibold mb-3">Token Usage Breakdown</h3>

      @if (breakdown().total === 0) {
      <p class="text-xs opacity-60">No token data available.</p>
      } @else {
      <div class="space-y-3">
        <!-- Input Tokens -->
        <div>
          <div class="flex justify-between text-xs mb-1">
            <span>Input</span>
            <span class="font-mono"
              >{{ formatTokenCount(breakdown().input) }} ({{
                breakdown().inputPercent | number : '1.1-1'
              }}%)</span
            >
          </div>
          <progress
            class="progress progress-primary w-full"
            [value]="breakdown().inputPercent"
            max="100"
          ></progress>
        </div>

        <!-- Output Tokens -->
        <div>
          <div class="flex justify-between text-xs mb-1">
            <span>Output</span>
            <span class="font-mono"
              >{{ formatTokenCount(breakdown().output) }} ({{
                breakdown().outputPercent | number : '1.1-1'
              }}%)</span
            >
          </div>
          <progress
            class="progress progress-secondary w-full"
            [value]="breakdown().outputPercent"
            max="100"
          ></progress>
        </div>

        <!-- Cache Read Tokens (hidden when zero) -->
        @if (breakdown().cacheRead > 0) {
        <div>
          <div class="flex justify-between text-xs mb-1">
            <span>Cache Read</span>
            <span class="font-mono"
              >{{ formatTokenCount(breakdown().cacheRead) }} ({{
                breakdown().cacheReadPercent | number : '1.1-1'
              }}%)</span
            >
          </div>
          <progress
            class="progress progress-accent w-full"
            [value]="breakdown().cacheReadPercent"
            max="100"
          ></progress>
        </div>
        }

        <!-- Cache Creation Tokens (hidden when zero) -->
        @if (breakdown().cacheCreation > 0) {
        <div>
          <div class="flex justify-between text-xs mb-1">
            <span>Cache Creation</span>
            <span class="font-mono"
              >{{ formatTokenCount(breakdown().cacheCreation) }} ({{
                breakdown().cacheCreationPercent | number : '1.1-1'
              }}%)</span
            >
          </div>
          <progress
            class="progress progress-info w-full"
            [value]="breakdown().cacheCreationPercent"
            max="100"
          ></progress>
        </div>
        }

        <!-- Total row -->
        <div class="border-t border-base-300 pt-2 mt-2">
          <div class="flex justify-between text-xs font-semibold">
            <span>Total</span>
            <span class="font-mono">{{
              formatTokenCount(breakdown().total)
            }}</span>
          </div>
        </div>
      </div>
      }
    </div>
  `,
})
export class TokenUsageBreakdownComponent {
  readonly breakdown = input.required<TokenBreakdownData>();

  readonly formatTokenCount = formatTokenCount;
}
