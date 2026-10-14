import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
  signal,
  viewChild,
  type ElementRef,
} from '@angular/core';
import {
  ChevronDown,
  LayoutDashboard,
  LucideAngularModule,
  PanelRight,
} from 'lucide-angular';
import {
  MINI_CAPTION_CLASS,
  MINI_CARD_CLASS,
  MINI_LABEL_CLASS,
  MINI_PILL_CLASS,
  MINI_SECTION_CLASS,
  TURN_SUMMARY_MINI_STYLES,
  miniValueClass,
  type MiniTone,
} from '../../organisms/display-panel/turn-summary-mini-card.styles';
import { formatTokens } from '../session/session-stats-format';
import type { TurnSummaryModel } from './turn-summary.model';

/** One pill in the collapsed line. The text alone carries the meaning. */
interface ChipMetric {
  readonly text: string;
  readonly tone: MiniTone;
}

/** One mini card in the expanded body. */
interface ChipMiniCard {
  readonly label: string;
  readonly value: string;
  /** Screen-reader words completing a terse value ("38/40" → "passed"). */
  readonly srSuffix: string | null;
  /** A muted caption under the value ("counts unavailable"). */
  readonly caption: string | null;
  /** Status words are set smaller and never broken mid-word (D2, #150). */
  readonly valueClass: string;
}

let nextSummaryChipInstance = 0;

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** A value the source could not produce reads as its status word, never 0. */
function shown(value: number | string, format: (n: number) => string): string {
  return typeof value === 'number' ? format(value) : value;
}

/**
 * TurnSummaryChipComponent - the per-turn summary chip in chat (TASK_2026_623,
 * component 6; R6.5, R6.9, R6.10, R9; decisions #5, #10, #13).
 *
 * Presentational over `buildTurnSummaryModel`: the transcript builds the
 * model at turn end and mounts the chip only when it is not `null`.
 *
 * - Collapsed (default, R9.4): icon, "Turn summary" and metric pills such as
 *   "3 files", "+42", "−7", "2 tests passed", "incomplete". Pills wrap under
 *   the title at narrow widths instead of truncating (R9.6).
 * - Expanded: mini cards (Files, Lines, Tokens, Cost, Time, Tests; Files,
 *   Lines and Tests only when the model has them) and "Open in panel".
 * - Totals only, never a file list (R6.9): the panel's Files card is the one
 *   per-turn file listing.
 *
 * Not a live region: a historical chip must not be announced again on reload
 * or a lazy mount. Escape inside an expanded chip collapses it and returns
 * focus to the toggle. It does not import the surface renderer (D14).
 */
@Component({
  selector: 'ptah-turn-summary-chip',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [TURN_SUMMARY_MINI_STYLES],
  template: `
    <section
      [class]="SECTION_CLASS"
      [attr.aria-label]="ariaLabel()"
      data-testid="turn-summary-chip"
      (keydown.escape)="collapse($event)"
    >
      <button
        #chipToggle
        type="button"
        class="dp-toggle flex w-full min-w-0 items-start gap-2 rounded-[inherit] px-2.5 py-2 text-left"
        [id]="toggleId"
        [attr.aria-expanded]="expanded()"
        [attr.aria-controls]="regionId"
        (click)="toggle()"
        data-testid="turn-summary-chip-toggle"
      >
        <lucide-angular
          [img]="LayoutDashboardIcon"
          class="mt-0.5 h-4 w-4 shrink-0 text-base-content-muted"
          aria-hidden="true"
        />
        <span
          class="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1"
        >
          <span class="text-sm font-semibold">Turn summary</span>
          <span
            class="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1"
            data-testid="turn-summary-chip-metrics"
          >
            @for (metric of metrics(); track $index) {
              <span
                [class]="MINI_PILL_CLASS[metric.tone]"
                data-testid="turn-summary-chip-metric"
                >{{ metric.text }}</span
              >
            }
          </span>
        </span>
        <lucide-angular
          [img]="ChevronDownIcon"
          class="dp-chevron mt-0.5 h-4 w-4 shrink-0 text-base-content-muted"
          [attr.data-open]="expanded()"
          aria-hidden="true"
        />
      </button>
      <div
        [id]="regionId"
        role="region"
        [attr.aria-label]="detailsLabel()"
        class="dp-collapse"
        [attr.data-open]="expanded()"
        [attr.inert]="expanded() ? null : ''"
      >
        <div class="dp-collapse-inner">
          <div class="flex min-w-0 flex-col gap-2 px-2.5 pb-2.5">
            <div class="ts-mini-grid" role="list">
              @for (card of miniCards(); track card.label) {
                <div
                  [class]="MINI_CARD_CLASS"
                  role="listitem"
                  data-testid="turn-summary-chip-card"
                >
                  <span [class]="MINI_LABEL_CLASS">{{ card.label }}</span>
                  <span
                    [class]="card.valueClass"
                    data-testid="turn-summary-chip-card-value"
                    >{{ card.value }}
                    @if (card.srSuffix; as suffix) {
                      <span class="sr-only"> {{ suffix }}</span>
                    }
                  </span>
                  @if (card.caption; as caption) {
                    <span [class]="MINI_CAPTION_CLASS">{{ caption }}</span>
                  }
                </div>
              }
            </div>
            <div class="flex min-w-0 flex-wrap items-center gap-2">
              <button
                type="button"
                class="btn btn-xs btn-outline rounded-full"
                data-testid="turn-summary-chip-open"
                [disabled]="!openable()"
                [attr.aria-describedby]="openable() ? null : unavailableId"
                (click)="openInPanel()"
              >
                <lucide-angular
                  [img]="PanelRightIcon"
                  class="h-3.5 w-3.5"
                  aria-hidden="true"
                />
                Open in panel
              </button>
              @if (openable()) {
                <span class="text-xs text-base-content-muted"
                  >Details and per-file changes live in the panel</span
                >
              } @else {
                <span
                  class="text-xs text-base-content-muted"
                  [id]="unavailableId"
                  >Display panel unavailable</span
                >
              }
            </div>
          </div>
        </div>
      </div>
    </section>
  `,
})
export class TurnSummaryChipComponent {
  /** The turn's summary; the transcript mounts the chip only when it exists. */
  readonly summary = input.required<TurnSummaryModel>();
  /** False on a host without the display dock: "Open in panel" is disabled. */
  readonly openable = input(true);
  /** "Open in panel": the caller opens the dock at this turn's summary. */
  readonly open = output<void>();

  private readonly instanceId = `ptah-turn-summary-chip-${nextSummaryChipInstance++}`;
  protected readonly toggleId = `${this.instanceId}-toggle`;
  protected readonly regionId = `${this.instanceId}-region`;
  protected readonly unavailableId = `${this.instanceId}-unavailable`;

  /** The inline chip keeps its `my-2` margin on top of the shared section look. */
  protected readonly SECTION_CLASS = `my-2 ${MINI_SECTION_CLASS}`;
  protected readonly MINI_CARD_CLASS = MINI_CARD_CLASS;
  protected readonly MINI_LABEL_CLASS = MINI_LABEL_CLASS;
  protected readonly MINI_CAPTION_CLASS = MINI_CAPTION_CLASS;
  protected readonly MINI_PILL_CLASS = MINI_PILL_CLASS;
  protected readonly LayoutDashboardIcon = LayoutDashboard;
  protected readonly ChevronDownIcon = ChevronDown;
  protected readonly PanelRightIcon = PanelRight;

  /** Chips start collapsed (R9.4). */
  protected readonly expanded = signal(false);
  private readonly toggleButton =
    viewChild<ElementRef<HTMLButtonElement>>('chipToggle');

  /** The collapsed line: totals and the test outcome (R6.10), no file list. */
  protected readonly metrics = computed((): readonly ChipMetric[] => {
    const { files, lines, tests, incomplete } = this.summary();
    const metrics: ChipMetric[] = [];
    if (files !== null) {
      if (typeof files.value === 'number') {
        metrics.push({
          text: plural(files.value, 'file', 'files'),
          tone: 'neutral',
        });
      } else {
        metrics.push(
          { text: 'files changed', tone: 'neutral' },
          { text: 'counts unavailable', tone: 'neutral' },
        );
      }
    }
    if (lines !== null) {
      if (typeof lines.additions === 'number' && lines.additions > 0) {
        metrics.push({ text: `+${lines.additions}`, tone: 'success' });
      }
      if (typeof lines.deletions === 'number' && lines.deletions > 0) {
        metrics.push({ text: `−${lines.deletions}`, tone: 'error' });
      }
    }
    if (tests !== null) {
      const { passed, failed, running, unknown } = tests.summary;
      if (passed > 0) {
        metrics.push({
          text: `${plural(passed, 'test', 'tests')} passed`,
          tone: 'success',
        });
      }
      if (failed > 0) {
        metrics.push({
          text: `${plural(failed, 'test', 'tests')} failed`,
          tone: 'error',
        });
      }
      if (running > 0) {
        metrics.push({
          text: `${plural(running, 'test', 'tests')} running in background`,
          tone: 'info',
        });
      }
      if (unknown > 0) {
        metrics.push({
          text:
            passed === 0 && failed === 0 && running === 0
              ? 'tests unknown'
              : `${plural(unknown, 'test', 'tests')} unknown`,
          tone: 'neutral',
        });
      }
    }
    if (incomplete) metrics.push({ text: 'incomplete', tone: 'warning' });
    return metrics;
  });

  /** The section's name: the same totals as one sentence, never a live region. */
  protected readonly ariaLabel = computed(() => {
    const parts = this.metrics()
      .filter((metric) => metric.text !== 'incomplete')
      .map((metric) => metric.text);
    const label =
      parts.length === 0 ? 'Turn summary' : `Turn summary: ${parts.join(', ')}`;
    return this.summary().incomplete ? `${label} (incomplete)` : label;
  });

  /** Distinguishes the expandable details landmark from the summary section. */
  protected readonly detailsLabel = computed(
    () => `${this.ariaLabel()} details`,
  );

  protected readonly miniCards = computed((): readonly ChipMiniCard[] => {
    const { files, lines, tokens, cost, duration, tests } = this.summary();
    const cards: Omit<ChipMiniCard, 'valueClass'>[] = [];
    if (files !== null) {
      cards.push({
        label: 'Files',
        // Counts unavailable reads `?` plus the words (design-spec R6.3 table).
        value: files.countsUnavailable ? '?' : shown(files.value, String),
        srSuffix: null,
        caption: files.countsUnavailable ? 'counts unavailable' : null,
      });
    }
    if (lines !== null) {
      cards.push({
        label: 'Lines',
        value: lines.countsUnavailable
          ? '?'
          : `+${shown(lines.additions, String)} −${shown(lines.deletions, String)}`,
        srSuffix: null,
        caption: lines.countsUnavailable ? 'counts unavailable' : null,
      });
    }
    cards.push({
      label: 'Tokens',
      value:
        typeof tokens.input === 'number' && typeof tokens.output === 'number'
          ? formatTokens(tokens.input + tokens.output)
          : shown(tokens.input, formatTokens),
      srSuffix: null,
      caption:
        typeof tokens.input === 'number' && typeof tokens.output === 'number'
          ? `${formatTokens(tokens.input)} in · ${formatTokens(tokens.output)} out`
          : null,
    });
    cards.push(
      { label: 'Cost', value: cost.value, srSuffix: null, caption: null },
      { label: 'Time', value: duration.value, srSuffix: null, caption: null },
    );
    if (tests !== null) {
      cards.push({
        label: 'Tests',
        value: `${tests.summary.passed}/${tests.summary.total}`,
        srSuffix: 'passed',
        caption: tests.label,
      });
    }
    return cards.map((card) => ({
      ...card,
      valueClass: miniValueClass(card.value),
    }));
  });

  protected toggle(): void {
    this.expanded.update((value) => !value);
  }

  /** Escape inside an expanded chip: collapse and return focus to the toggle. */
  protected collapse(event: Event): void {
    const toggle = this.toggleButton();
    if (!this.expanded() || toggle === undefined) return;
    event.stopPropagation();
    this.expanded.set(false);
    toggle.nativeElement.focus();
  }

  protected openInPanel(): void {
    if (this.openable()) this.open.emit();
  }
}
