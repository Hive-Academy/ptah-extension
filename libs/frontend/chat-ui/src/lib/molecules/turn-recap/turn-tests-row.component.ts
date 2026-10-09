import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  signal,
} from '@angular/core';
import {
  ChevronRight,
  CircleCheck,
  CircleHelp,
  CircleX,
  LoaderCircle,
  LucideAngularModule,
} from 'lucide-angular';
import {
  summarizeTurnTests,
  type TurnTestOutcome,
  type TurnTestRun,
  type TurnTestSummary,
} from '@ptah-extension/shared';

/**
 * One rendered run: the run's own fields plus its precomputed full class
 * list, so the template never calls a method to style a row.
 */
interface TurnTestRow {
  readonly command: string;
  readonly project?: string;
  readonly outcome: TurnTestOutcome;
  readonly label: string;
  readonly failures: readonly string[];
}

/**
 * The full class list for one outcome word — layout classes plus the colour
 * cue; the word itself carries the meaning, never the colour alone.
 */
const OUTCOME_CLASS: Readonly<Record<TurnTestOutcome, string>> = {
  passed: 'font-semibold w-14 shrink-0 diff-add-text',
  failed: 'font-semibold w-14 shrink-0 diff-del-text',
  running: 'font-semibold w-14 shrink-0 text-info',
  unknown: 'font-semibold w-14 shrink-0 text-base-content-muted',
};

let nextTurnTestsBodyId = 0;

/**
 * TurnTestsRowComponent - the tests-run section a turn that ran test commands
 * leaves in the transcript, next to the change-set card (TASK_2026_610 Req
 * 1.6/1.7, plan §3).
 *
 * Complexity Level: 2 (Simple molecule)
 * Patterns: Standalone component, OnPush change detection, signal inputs
 *
 * Presentational only: the caller collects the runs (`collectTurnTests`,
 * shared) and decides when a turn ended early (`incomplete`). Rows appear in
 * execution order, one outcome word plus command each.
 *
 * Outcome is text, never colour alone (Req 1.6): each row spells
 * "passed" / "failed" / "unknown" and the header summarizes as
 * "2 passed, 1 failed" — or just "unknown" when nothing resolved. Colour
 * rides along as a secondary cue using the AA-measured `.diff-add-text` /
 * `.diff-del-text` overrides and `text-base-content-muted` (>= 4.5:1 on every
 * base layer in both anubis themes), never stock `text-success`.
 *
 * Empty list: nothing renders (Req 1.4), and no file or +/- counts content
 * appears (Req 1.12) — the change-set card owns that.
 */
@Component({
  selector: 'ptah-turn-tests-row',
  standalone: true,
  imports: [LucideAngularModule],
  template: `
    @if (summary().total > 0) {
      <section
        class="cs-card surface-2 rounded max-w-md text-[11px] text-base-content overflow-hidden"
        [attr.aria-label]="ariaLabel()"
        data-testid="turn-tests-row"
      >
        <button
          type="button"
          class="w-full flex flex-wrap items-center gap-x-1.5 gap-y-1 py-1.5 px-2 text-left focus-visible:-outline-offset-2"
          [attr.aria-expanded]="expanded()"
          [attr.aria-controls]="bodyId"
          (click)="expanded.update((value) => !value)"
          data-testid="turn-tests-header"
        >
          <lucide-angular
            [img]="ChevronRightIcon"
            class="w-3 h-3 shrink-0 text-base-content-muted transition-transform duration-150"
            [class.rotate-90]="expanded()"
            aria-hidden="true"
          />
          <span
            class="font-semibold text-base-content-muted"
            data-testid="turn-tests-heading"
            >Tests</span
          >
          <span class="text-base-content" data-testid="turn-tests-summary">{{
            outcomeLabel()
          }}</span>
          @if (incomplete()) {
            <span
              class="text-base-content-muted"
              data-testid="turn-tests-incomplete"
              >(incomplete)</span
            >
          }
        </button>
        @if (expanded()) {
          <ul [id]="bodyId" class="border-t border-base-content/10" role="list">
            @for (row of rows(); track $index) {
              <li
                class="px-2 py-1 border-b border-base-300/30 last:border-b-0"
                data-testid="turn-tests-run"
              >
                <div class="flex items-center gap-1.5 min-w-0">
                  @switch (row.outcome) {
                    @case ('passed') {
                      <lucide-angular
                        [img]="PassedIcon"
                        class="w-3 h-3 shrink-0 diff-add-text"
                        aria-label="passed"
                      />
                    }
                    @case ('failed') {
                      <lucide-angular
                        [img]="FailedIcon"
                        class="w-3 h-3 shrink-0 diff-del-text"
                        aria-label="failed"
                      />
                    }
                    @case ('running') {
                      <lucide-angular
                        [img]="RunningIcon"
                        class="w-3 h-3 shrink-0 text-info animate-spin"
                        aria-label="running in background"
                      />
                    }
                    @default {
                      <lucide-angular
                        [img]="UnknownIcon"
                        class="w-3 h-3 shrink-0 text-base-content-muted"
                        aria-label="unknown"
                      />
                    }
                  }
                  <span
                    [class]="OUTCOME_CLASS[row.outcome]"
                    data-testid="turn-tests-run-outcome"
                    >{{ row.label }}</span
                  >
                  <span
                    class="font-mono text-[10px] text-base-content-muted min-w-0 flex-1 break-all"
                    [title]="row.command"
                    data-testid="turn-tests-run-command"
                    >{{ row.project ?? row.command }}</span
                  >
                </div>
                <details class="mt-1 ml-4">
                  <summary
                    class="cursor-pointer font-mono text-[10px] text-base-content-muted"
                  >
                    command
                  </summary>
                  <code
                    class="block mt-0.5 break-all text-[10px] text-base-content-muted"
                    >{{ row.command }}</code
                  >
                </details>
                @if (row.failures.length > 0) {
                  <ul class="mt-1 ml-4 text-[10px] diff-del-text" role="list">
                    @for (failure of row.failures; track failure) {
                      <li>{{ failure }}</li>
                    }
                  </ul>
                }
              </li>
            }
          </ul>
        }
      </section>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TurnTestsRowComponent {
  protected readonly OUTCOME_CLASS = OUTCOME_CLASS;
  protected readonly ChevronRightIcon = ChevronRight;
  protected readonly PassedIcon = CircleCheck;
  protected readonly FailedIcon = CircleX;
  protected readonly RunningIcon = LoaderCircle;
  protected readonly UnknownIcon = CircleHelp;
  protected readonly expanded = signal(true);
  protected readonly bodyId = `turn-tests-body-${nextTurnTestsBodyId++}`;
  /** The test commands the turn ran, in execution order. */
  readonly runs = input.required<readonly TurnTestRun[]>();
  /** The turn aborted or errored before these runs finished (Req 1.7). */
  readonly incomplete = input<boolean>(false);

  protected readonly summary = computed<TurnTestSummary>(() =>
    summarizeTurnTests(this.runs()),
  );

  /**
   * The outcome as text: "2 passed, 1 failed" and "1 passed, 1 unknown" count
   * every category present, and a list where nothing resolved is just
   * "unknown" (Req 1.6) — the rows, not the header, carry the detail there.
   */
  protected readonly outcomeLabel = computed<string>(() => {
    const { passed, failed, running, unknown } = this.summary();
    const parts: string[] = [];
    if (passed > 0) parts.push(`${passed} passed`);
    if (failed > 0) parts.push(`${failed} failed`);
    if (running > 0) parts.push(`${running} running in background`);
    if (unknown > 0) {
      parts.push(
        passed === 0 && failed === 0 ? 'unknown' : `${unknown} unknown`,
      );
    }
    return parts.join(', ');
  });

  protected readonly ariaLabel = computed<string>(() => {
    const label = `Tests: ${this.outcomeLabel()}`;
    return this.incomplete() ? `${label} (incomplete)` : label;
  });

  /**
   * View rows precomputed from the runs: the template binds `row.cls`
   * directly instead of calling a method per check. Tracked by `$index` —
   * the list is append-only and a new runs array replaces it wholesale, so
   * index identity is stable for Angular's DOM reuse.
   */
  protected readonly rows = computed<readonly TurnTestRow[]>(() =>
    this.runs().map((run) => ({
      command: run.command,
      project: run.project,
      outcome: run.outcome,
      label: run.project ?? run.outcome,
      failures: run.failures ?? [],
    })),
  );
}
