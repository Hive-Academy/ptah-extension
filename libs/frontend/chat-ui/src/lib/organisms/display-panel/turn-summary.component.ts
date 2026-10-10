import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
  signal,
} from '@angular/core';
import {
  ChevronDown,
  CircleDollarSign,
  Clock,
  Diff,
  FileText,
  FlaskConical,
  Hash,
  LayoutDashboard,
  LucideAngularModule,
  Pin,
  TriangleAlert,
} from 'lucide-angular';
import { formatTokens } from '../../molecules/session/session-stats-format';
import type {
  TurnSummaryCard,
  TurnSummaryModel,
} from '../../molecules/turn-recap/turn-summary.model';
import { TurnSummaryFilesComponent } from './turn-summary-files.component';
import { TurnSummaryTestsComponent } from './turn-summary-tests.component';

type SummaryCardKind = TurnSummaryCard['kind'];
type PillTone = 'neutral' | 'success' | 'error' | 'info' | 'warning';

interface SummaryPill {
  readonly text: string;
  readonly tone: PillTone;
}

/** What a stat card shows in its head: label, number (+ unit) and pills. */
interface SummaryCardHead {
  readonly kind: SummaryCardKind;
  readonly label: string;
  readonly value: string;
  /** Muted text after the number ("changed", "−96", "pass"). */
  readonly unit: string | null;
  /** Screen-reader words that complete a terse value ("38/40" → "tests passed"). */
  readonly srValue: string | null;
  readonly pills: readonly SummaryPill[];
}

/** One key-value row in an expanded Lines, Tokens, Cost or Duration card. */
interface SummaryDetailRow {
  readonly key: string;
  readonly value: string;
}

/**
 * Full class lists per tone, literal for Tailwind. Success and error text use
 * the AA-measured `.diff-add-text` / `.diff-del-text` overrides, as the chip
 * and the tests row do; the pill text always carries the meaning.
 */
const PILL_CLASS: Readonly<Record<PillTone, string>> = {
  neutral: 'badge badge-sm badge-ghost h-auto whitespace-nowrap text-base-content',
  success: 'badge badge-sm badge-ghost h-auto whitespace-nowrap diff-add-text',
  error: 'badge badge-sm badge-ghost h-auto whitespace-nowrap diff-del-text',
  info: 'badge badge-sm badge-info h-auto whitespace-nowrap',
  warning: 'badge badge-sm badge-warning h-auto whitespace-nowrap',
};

const CARD_LABEL: Readonly<Record<SummaryCardKind, string>> = {
  files: 'Files',
  lines: 'Lines',
  tokens: 'Tokens',
  cost: 'Cost',
  duration: 'Duration',
  tests: 'Tests',
};

/**
 * Host summary styles (design-spec sections 1, 5 and 7). The host is its own
 * inline-size container, so the stat grid follows the panel width, not the
 * viewport: 1 column below 400 px, 2 up to 699 px, 3 at 700 px and up
 * (R9.6). An expanded card spans the row and, at 700 px and up, splits into a
 * summary column and a detail column. Collapsed regions are `inert` and
 * `visibility:hidden`; motion only under `prefers-reduced-motion:
 * no-preference`. The warm hero gradient marks the host-built section
 * (decision #13): `secondary` at 12% into the card colour at 135 degrees.
 */
const SUMMARY_STYLES = `
  :host {
    display: block;
    min-width: 0;
    container-type: inline-size;
    container-name: ts;
    --ts-card: oklch(var(--b2));
    --ts-well: oklch(var(--b3));
  }
  :host-context([data-theme='anubis-light']) {
    --ts-card: oklch(var(--b1));
    --ts-well: oklch(var(--b2));
  }
  .ts-hero {
    background: linear-gradient(
      135deg,
      color-mix(in oklab, oklch(var(--s)) 12%, var(--ts-card)),
      var(--ts-card) 62%
    );
    border: 1px solid color-mix(in oklab, oklch(var(--bc)) 14%, transparent);
  }
  .ts-card {
    min-width: 0;
    background: var(--ts-card);
    border: 1px solid color-mix(in oklab, oklch(var(--bc)) 14%, transparent);
    box-shadow: inset 0 1px 0 color-mix(in oklab, oklch(var(--bc)) 9%, transparent);
  }
  .ts-card[data-polarity='bad'] {
    border-color: color-mix(in oklab, oklch(var(--er)) 45%, transparent);
  }
  .ts-well { background: var(--ts-well); }
  .ts-grid { display: grid; grid-template-columns: minmax(0, 1fr); gap: 0.5rem; }
  .ts-card[data-open='true'] { grid-column: 1 / -1; }
  @container ts (min-width: 400px) {
    .ts-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  }
  @container ts (min-width: 700px) {
    .ts-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .ts-card[data-open='true'] {
      display: grid;
      grid-template-columns: minmax(200px, 38%) minmax(0, 1fr);
      align-items: start;
    }
  }
  .ts-number {
    font-size: clamp(1.5rem, 11cqi, 2.125rem);
    font-weight: 600;
    letter-spacing: -0.025em;
    font-variant-numeric: tabular-nums;
    line-height: 1.1;
  }
  .ts-wrap { overflow-wrap: anywhere; }
  .dp-collapse { display: grid; grid-template-rows: 1fr; min-width: 0; }
  .dp-collapse[data-open='false'] { grid-template-rows: 0fr; visibility: hidden; }
  .dp-collapse-inner { min-height: 0; min-width: 0; }
  .dp-collapse[data-open='false'] > .dp-collapse-inner { overflow: hidden; }
  .dp-toggle { min-height: 2rem; }
  .dp-toggle:focus-visible { outline: 2px solid oklch(var(--bc)); outline-offset: 2px; }
  .dp-chevron[data-open='true'] { transform: rotate(180deg); }
  @media (prefers-reduced-motion: no-preference) {
    .dp-collapse { transition: grid-template-rows 220ms ease, visibility 220ms; }
    .dp-chevron { transition: transform 200ms ease; }
  }
`;

let nextTurnSummaryInstance = 0;

/** A value the source could not produce reads as its status word, never 0. */
function shown(value: number | string, format: (n: number) => string): string {
  return typeof value === 'number' ? format(value) : value;
}

/**
 * TurnSummaryComponent - the host-built Turn summary section at the top of the
 * display panel (TASK_2026_623, component 5; R6.1-R6.4, R6.8, R9; design-spec
 * section 5; decisions #13, #51, #66, #69).
 *
 * Presentational over `buildTurnSummaryModel`: it renders `model.cards` in
 * order and adds no omission rule of its own (the model already leaves out
 * Files, Lines and Tests with nothing to show, decision #66).
 *
 * - Every stat card is a collapsible toggle (R9), collapsed by default; a
 *   conflict forces Files open until the user toggles it (parity section 2).
 * - Files detail (`ptah-turn-summary-files`): the change-set card's
 *   capabilities, parity section 2.
 * - Tests detail (`ptah-turn-summary-tests`): the tests row's capabilities,
 *   parity section 1.
 * - Lines, Tokens, Cost and Duration expand to a short key-value list.
 * - An action failure (`actionError`) shows as an inline `role="alert"` line
 *   in the Files card, outside the collapsible region so it is never hidden.
 *
 * Not a live region: the dock re-mounts it on tab switches and reloads.
 */
@Component({
  selector: 'ptah-turn-summary',
  standalone: true,
  imports: [
    LucideAngularModule,
    TurnSummaryFilesComponent,
    TurnSummaryTestsComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [SUMMARY_STYLES],
  template: `
    <section
      class="ts-hero min-w-0 rounded-box text-base-content"
      [attr.aria-labelledby]="sectionToggleId"
      data-testid="turn-summary"
      (keydown.escape)="collapseSection($event, sectionToggle)"
    >
      <div class="flex min-w-0 items-start gap-2 px-3 pt-2.5">
        <button
          #sectionToggle
          type="button"
          class="dp-toggle flex min-w-0 flex-1 items-start gap-2 rounded text-left"
          [id]="sectionToggleId"
          [attr.aria-expanded]="sectionOpen()"
          [attr.aria-controls]="sectionRegionId"
          (click)="sectionOpen.set(!sectionOpen())"
          data-testid="turn-summary-toggle"
        >
          <lucide-angular
            [img]="LayoutDashboardIcon"
            class="mt-0.5 h-4 w-4 shrink-0 text-base-content-muted"
            aria-hidden="true"
          />
          <span class="flex min-w-0 flex-1 flex-col">
            <span class="text-sm font-semibold">Turn summary</span>
            <span class="ts-wrap text-xs text-base-content-muted"
              >host-built</span
            >
          </span>
          <lucide-angular
            [img]="ChevronDownIcon"
            class="dp-chevron mt-0.5 h-4 w-4 shrink-0 text-base-content-muted"
            [attr.data-open]="sectionOpen()"
            aria-hidden="true"
          />
        </button>
        <span class="flex shrink-0 flex-wrap items-center justify-end gap-1">
          @if (summary().incomplete) {
            <span
              [class]="PILL_CLASS.warning"
              data-testid="turn-summary-incomplete"
              >incomplete</span
            >
          }
          <span [class]="PILL_CLASS.neutral" data-testid="turn-summary-host">
            <lucide-angular
              [img]="PinIcon"
              class="h-3 w-3"
              aria-hidden="true"
            />
            Host
          </span>
        </span>
      </div>
      <div
        [id]="sectionRegionId"
        class="dp-collapse"
        [attr.data-open]="sectionOpen()"
        [attr.inert]="sectionOpen() ? null : ''"
      >
        <div class="dp-collapse-inner">
          <div class="flex min-w-0 flex-col gap-2 p-3">
            @if (summary().incomplete) {
              <p
                class="ts-wrap text-xs text-base-content-muted"
                role="note"
                data-testid="turn-summary-incomplete-note"
              >
                This turn stopped before it finished, so these results may be
                incomplete.
              </p>
            }
            <div class="ts-grid" data-testid="turn-summary-grid">
              @for (head of heads(); track head.kind) {
                <div
                  class="ts-card rounded-box"
                  [attr.data-open]="isOpen(head.kind)"
                  [attr.data-polarity]="
                    head.kind === 'tests' ? summary().tests?.polarity : null
                  "
                  [attr.data-testid]="'turn-summary-card-' + head.kind"
                  (keydown.escape)="collapseCard($event, head.kind, cardToggle)"
                >
                  <div class="min-w-0">
                    <button
                      #cardToggle
                      type="button"
                      class="dp-toggle flex w-full min-w-0 items-start gap-2 rounded-[inherit] px-3 py-2.5 text-left"
                      [id]="toggleId(head.kind)"
                      [attr.aria-expanded]="isOpen(head.kind)"
                      [attr.aria-controls]="regionId(head.kind)"
                      (click)="toggleCard(head.kind)"
                      [attr.data-testid]="'turn-summary-card-toggle-' + head.kind"
                    >
                      <span class="flex min-w-0 flex-1 flex-col gap-1">
                        <span
                          class="flex items-center gap-1.5 text-xs font-medium text-base-content-muted"
                        >
                          <lucide-angular
                            [img]="CARD_ICON[head.kind]"
                            class="h-3.5 w-3.5 shrink-0"
                            aria-hidden="true"
                          />
                          {{ head.label }}
                        </span>
                        <span
                          class="ts-wrap flex min-w-0 flex-wrap items-baseline gap-x-1.5"
                        >
                          <span
                            class="ts-number"
                            [attr.data-testid]="'turn-summary-value-' + head.kind"
                            >{{ head.value }}</span
                          >
                          @if (head.unit; as unit) {
                            <span
                              class="text-sm text-base-content-muted"
                              [attr.data-testid]="'turn-summary-unit-' + head.kind"
                              >{{ unit }}</span
                            >
                          }
                          @if (head.srValue; as words) {
                            <span class="sr-only">{{ words }}</span>
                          }
                        </span>
                        @if (head.pills.length > 0) {
                          <span class="flex min-w-0 flex-wrap gap-1">
                            @for (pill of head.pills; track pill.text) {
                              <span
                                [class]="PILL_CLASS[pill.tone]"
                                data-testid="turn-summary-pill"
                                >{{ pill.text }}</span
                              >
                            }
                          </span>
                        }
                      </span>
                      <lucide-angular
                        [img]="ChevronDownIcon"
                        class="dp-chevron mt-0.5 h-4 w-4 shrink-0 text-base-content-muted"
                        [attr.data-open]="isOpen(head.kind)"
                        aria-hidden="true"
                      />
                    </button>
                    @if (head.kind === 'files' && actionError(); as error) {
                      <p
                        class="ts-wrap mx-3 mb-2 flex items-start gap-1.5 text-xs diff-del-text"
                        role="alert"
                        data-testid="turn-summary-action-error"
                      >
                        <lucide-angular
                          [img]="TriangleAlertIcon"
                          class="mt-0.5 h-3.5 w-3.5 shrink-0"
                          aria-hidden="true"
                        />
                        {{ error }}
                      </p>
                    }
                  </div>
                  <div
                    [id]="regionId(head.kind)"
                    role="region"
                    [attr.aria-labelledby]="toggleId(head.kind)"
                    class="dp-collapse"
                    [attr.data-open]="isOpen(head.kind)"
                    [attr.inert]="isOpen(head.kind) ? null : ''"
                    [attr.data-testid]="'turn-summary-region-' + head.kind"
                  >
                    <div class="dp-collapse-inner">
                      <div
                        class="ts-well mx-2 mb-2 min-w-0 rounded-box p-2.5 text-xs"
                      >
                        @switch (head.kind) {
                          @case ('files') {
                            @if (summary().files; as files) {
                              <ptah-turn-summary-files
                                [card]="files"
                                (openFile)="openFile.emit($event)"
                                (review)="review.emit()"
                              />
                            }
                          }
                          @case ('tests') {
                            @if (summary().tests; as tests) {
                              <ptah-turn-summary-tests [card]="tests" />
                            }
                          }
                          @default {
                            @if (detailNote(head.kind); as note) {
                              <p class="ts-wrap mb-1.5 text-base-content-muted">
                                {{ note }}
                              </p>
                            }
                            <dl
                              class="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1"
                            >
                              @for (row of detailRows(head.kind); track row.key) {
                                <dt class="ts-wrap text-base-content-muted">
                                  {{ row.key }}
                                </dt>
                                <dd class="text-right font-semibold tabular-nums">
                                  {{ row.value }}
                                </dd>
                              }
                            </dl>
                          }
                        }
                      </div>
                    </div>
                  </div>
                </div>
              }
            </div>
          </div>
        </div>
      </div>
    </section>
  `,
})
export class TurnSummaryComponent {
  /** The turn's summary model; the dock mounts the section only when it exists. */
  readonly summary = input.required<TurnSummaryModel>();
  /** The last Open file / Review failure text, shown inside the Files card (R6.8). */
  readonly actionError = input<string | null>(null);
  /** Open (or resolve) one file of the change set; emits its path. */
  readonly openFile = output<string>();
  /** Review the whole change set. */
  readonly review = output<void>();

  private readonly instanceId = `ptah-turn-summary-${nextTurnSummaryInstance++}`;
  protected readonly sectionToggleId = `${this.instanceId}-toggle`;
  protected readonly sectionRegionId = `${this.instanceId}-region`;

  protected readonly PILL_CLASS = PILL_CLASS;
  protected readonly CARD_ICON = {
    files: FileText,
    lines: Diff,
    tokens: Hash,
    cost: CircleDollarSign,
    duration: Clock,
    tests: FlaskConical,
  } as const;
  protected readonly ChevronDownIcon = ChevronDown;
  protected readonly LayoutDashboardIcon = LayoutDashboard;
  protected readonly PinIcon = Pin;
  protected readonly TriangleAlertIcon = TriangleAlert;

  /** The section is open by default (design section 3, `section`). */
  protected readonly sectionOpen = signal(true);
  /** Per card, the user's last choice; absent means the default. */
  private readonly userOpen = signal<ReadonlyMap<SummaryCardKind, boolean>>(
    new Map(),
  );

  protected readonly heads = computed((): readonly SummaryCardHead[] =>
    this.summary().cards.map((card) => this.headOf(card)),
  );

  protected toggleId(kind: SummaryCardKind): string {
    return `${this.instanceId}-${kind}-toggle`;
  }

  protected regionId(kind: SummaryCardKind): string {
    return `${this.instanceId}-${kind}-region`;
  }

  /**
   * Collapsed by default (R9.4). A conflict forces Files open until the user
   * toggles it; then the user's choice wins (parity section 2).
   */
  protected isOpen(kind: SummaryCardKind): boolean {
    const choice = this.userOpen().get(kind);
    if (choice !== undefined) return choice;
    return kind === 'files' && (this.summary().files?.conflictedCount ?? 0) > 0;
  }

  protected toggleCard(kind: SummaryCardKind): void {
    const next = !this.isOpen(kind);
    this.userOpen.update((current) => new Map(current).set(kind, next));
  }

  /** Escape inside an expanded card: collapse it and refocus its toggle. */
  protected collapseCard(
    event: Event,
    kind: SummaryCardKind,
    toggle: HTMLButtonElement,
  ): void {
    if (!this.isOpen(kind)) return;
    event.stopPropagation();
    this.userOpen.update((current) => new Map(current).set(kind, false));
    toggle.focus();
  }

  /** Escape inside the open section (no open card caught it): collapse it. */
  protected collapseSection(event: Event, toggle: HTMLButtonElement): void {
    if (!this.sectionOpen()) return;
    event.stopPropagation();
    this.sectionOpen.set(false);
    toggle.focus();
  }

  /** The explanatory line above a simple card's key-value list, if any. */
  protected detailNote(kind: SummaryCardKind): string | null {
    const { lines, cost } = this.summary();
    if (kind === 'lines' && lines?.countsUnavailable === true) {
      return 'Line counts are unavailable for this turn.';
    }
    if (kind === 'cost' && cost.value === 'unavailable') {
      return 'No cost was reported for this turn.';
    }
    return null;
  }

  protected detailRows(kind: SummaryCardKind): readonly SummaryDetailRow[] {
    const { lines, tokens, cost, duration } = this.summary();
    switch (kind) {
      case 'lines':
        return lines === null || lines.countsUnavailable
          ? []
          : [
              { key: 'Added', value: shown(lines.additions, String) },
              { key: 'Removed', value: shown(lines.deletions, String) },
            ];
      case 'tokens':
        return [
          { key: 'Input', value: shown(tokens.input, formatTokens) },
          { key: 'Output', value: shown(tokens.output, formatTokens) },
        ];
      case 'cost':
        return [{ key: 'Turn cost', value: cost.value }];
      case 'duration':
        return [{ key: 'Elapsed', value: duration.value }];
      default:
        return [];
    }
  }

  private headOf(card: TurnSummaryCard): SummaryCardHead {
    const label = CARD_LABEL[card.kind];
    switch (card.kind) {
      case 'files': {
        const pills: SummaryPill[] = [];
        if (card.countsUnavailable) {
          pills.push({ text: 'counts unavailable', tone: 'neutral' });
        }
        if (card.conflictedCount > 0) {
          pills.push({ text: `${card.conflictedCount} conflicted`, tone: 'error' });
        }
        if (card.baselineMissing) {
          pills.push({ text: 'baseline missing', tone: 'warning' });
        }
        return {
          kind: card.kind,
          label,
          // Counts unavailable reads `?` plus the pill (decision #69).
          value: card.countsUnavailable ? '?' : shown(card.value, String),
          unit: 'changed',
          srValue: null,
          pills,
        };
      }
      case 'lines':
        return card.countsUnavailable
          ? {
              kind: card.kind,
              label,
              value: '?',
              unit: null,
              srValue: 'lines changed',
              pills: [{ text: 'counts unavailable', tone: 'neutral' }],
            }
          : {
              kind: card.kind,
              label,
              value: `+${shown(card.additions, String)}`,
              unit: `−${shown(card.deletions, String)}`,
              srValue: 'lines added and removed',
              pills: [],
            };
      case 'tokens': {
        const total =
          typeof card.input === 'number' && typeof card.output === 'number'
            ? formatTokens(card.input + card.output)
            : shown(card.input, formatTokens);
        return {
          kind: card.kind,
          label,
          value: total,
          unit: typeof card.input === 'number' ? 'tokens' : null,
          srValue: null,
          pills: [],
        };
      }
      case 'cost':
        return {
          kind: card.kind,
          label,
          // Never a made-up $0: unavailable stays the word (decision #69).
          value: card.value,
          unit: null,
          srValue: null,
          pills:
            card.value === 'unavailable'
              ? [{ text: 'not reported', tone: 'neutral' }]
              : [],
        };
      case 'duration':
        return {
          kind: card.kind,
          label,
          value: card.value,
          unit: null,
          srValue: null,
          pills: [],
        };
      case 'tests': {
        const { passed, failed, running, unknown, total } = card.summary;
        const pills: SummaryPill[] = [];
        if (failed > 0) pills.push({ text: `${failed} failed`, tone: 'error' });
        if (running > 0) {
          pills.push({ text: 'in background', tone: 'info' });
        }
        if (unknown > 0) {
          pills.push({
            text: passed === 0 && failed === 0 && running === 0
              ? 'unknown'
              : `${unknown} unknown`,
            tone: 'neutral',
          });
        }
        if (this.summary().incomplete) {
          pills.push({ text: 'incomplete', tone: 'warning' });
        }
        return {
          kind: card.kind,
          label,
          value: `${passed}/${total}`,
          unit: 'pass',
          srValue: card.ariaLabel,
          pills,
        };
      }
    }
  }
}
