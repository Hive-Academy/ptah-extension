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
import { formatTokens } from '../session/session-stats-format';
import type { TurnSummaryModel } from './turn-summary.model';

type MetricTone = 'neutral' | 'success' | 'error' | 'info' | 'warning';

/** One pill in the collapsed line. The text alone carries the meaning. */
interface ChipMetric {
  readonly text: string;
  readonly tone: MetricTone;
}

/** One mini card in the expanded body. */
interface ChipMiniCard {
  readonly label: string;
  readonly value: string;
  /** Screen-reader words completing a terse value ("38/40" → "passed"). */
  readonly srSuffix: string | null;
  /** A muted caption under the value ("counts unavailable"). */
  readonly caption: string | null;
  /**
   * True when the value is a status word (`unavailable` / `pending`): it is
   * set smaller and never broken mid-word in a narrow card (D2, #150).
   */
  readonly word: boolean;
}

/** Number-like values: large, tabular, may break anywhere to fit the card. */
const MINI_VALUE_CLASS = 'block break-words text-lg font-semibold tabular-nums';
/** Status-word values: wrap only at word boundaries. */
const MINI_WORD_CLASS = 'block break-normal text-sm font-medium';

/**
 * Full class list per tone, literal for Tailwind. Success and error text use
 * the AA-measured `.diff-add-text` / `.diff-del-text` overrides the tests row
 * used; colour is a secondary cue, never the only one.
 */
const METRIC_CLASS: Readonly<Record<MetricTone, string>> = {
  neutral: 'badge badge-sm badge-ghost h-auto whitespace-nowrap tabular-nums',
  success:
    'badge badge-sm badge-ghost h-auto whitespace-nowrap tabular-nums diff-add-text',
  error:
    'badge badge-sm badge-ghost h-auto whitespace-nowrap tabular-nums diff-del-text',
  info: 'badge badge-sm badge-info h-auto whitespace-nowrap tabular-nums',
  warning: 'badge badge-sm badge-warning h-auto whitespace-nowrap',
};

/**
 * Same collapse pattern as the display chip and the panel accordion (design
 * section 7): the hidden body is `inert` and `visibility:hidden`; motion only
 * under `prefers-reduced-motion: no-preference`. The chip is flat `base-200`
 * (prototype `.chip`, decision #70).
 */
const CHIP_STYLES = `
  :host { display: block; min-width: 0; }
  .dp-collapse { display: grid; grid-template-rows: 1fr; min-width: 0; }
  .dp-collapse[data-open='false'] { grid-template-rows: 0fr; visibility: hidden; }
  .dp-collapse-inner { min-height: 0; min-width: 0; }
  .dp-collapse[data-open='false'] > .dp-collapse-inner { overflow: hidden; }
  .dp-toggle { min-height: 2rem; }
  .dp-toggle:focus-visible { outline: 2px solid oklch(var(--bc)); outline-offset: 2px; }
  .dp-chevron[data-open='true'] { transform: rotate(180deg); }
  .ts-mini-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 104px), 1fr));
    gap: 0.5rem;
  }
  @media (prefers-reduced-motion: no-preference) {
    .dp-collapse { transition: grid-template-rows 220ms ease, visibility 220ms; }
    .dp-chevron { transition: transform 200ms ease; }
  }
`;

let nextSummaryChipInstance = 0;

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** A value the source could not produce reads as its status word, never 0. */
function shown(value: number | string, format: (n: number) => string): string {
  return typeof value === 'number' ? format(value) : value;
}

/** Whether a shown value is the literal `TurnSummaryUnavailable` word. */
function isStatusWord(value: string): boolean {
  return value === 'unavailable' || value === 'pending';
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
  styles: [CHIP_STYLES],
  template: `
    <section
      class="my-2 min-w-0 rounded-box border border-base-300 bg-base-200 text-base-content"
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
                [class]="METRIC_CLASS[metric.tone]"
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
                  class="min-w-0 rounded-box bg-base-300 px-2.5 py-2"
                  role="listitem"
                  data-testid="turn-summary-chip-card"
                >
                  <span
                    class="block text-xs font-medium text-base-content-muted"
                    >{{ card.label }}</span
                  >
                  <span
                    [class]="card.word ? MINI_WORD_CLASS : MINI_VALUE_CLASS"
                    data-testid="turn-summary-chip-card-value"
                    >{{ card.value }}
                    @if (card.srSuffix; as suffix) {
                      <span class="sr-only"> {{ suffix }}</span>
                    }
                  </span>
                  @if (card.caption; as caption) {
                    <span class="block text-xs text-base-content-muted">{{
                      caption
                    }}</span>
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

  protected readonly METRIC_CLASS = METRIC_CLASS;
  protected readonly MINI_VALUE_CLASS = MINI_VALUE_CLASS;
  protected readonly MINI_WORD_CLASS = MINI_WORD_CLASS;
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
    const cards: Omit<ChipMiniCard, 'word'>[] = [];
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
    return cards.map((card) => ({ ...card, word: isStatusWord(card.value) }));
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
