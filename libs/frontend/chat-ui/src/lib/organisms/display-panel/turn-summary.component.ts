import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  input,
  linkedSignal,
  output,
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
import {
  MINI_CAPTION_CLASS,
  MINI_CARD_CLASS,
  MINI_CARD_PILL_CLASS,
  MINI_PILL_CLASS,
  MINI_SECTION_CLASS,
  TURN_SUMMARY_MINI_STYLES,
  miniValueClass,
  type MiniTone,
} from './turn-summary-mini-card.styles';
import { TurnSummaryTestsComponent } from './turn-summary-tests.component';

type SummaryCardKind = TurnSummaryCard['kind'];

interface SummaryPill {
  readonly text: string;
  readonly tone: MiniTone;
}

/** What one mini card shows: the chip's label, value and caption, plus pills. */
interface SummaryMiniCard {
  readonly kind: SummaryCardKind;
  readonly label: string;
  readonly value: string;
  readonly valueClass: string;
  /** Screen-reader words that complete a terse value ("1/3" → "passed"). */
  readonly srValue: string | null;
  /** Muted text under the value ("changed", "180.0k in · 4.2k out"). */
  readonly caption: string | null;
  readonly pills: readonly SummaryPill[];
}

/** One key-value row in an expanded Lines, Tokens, Cost or Time detail. */
interface SummaryDetailRow {
  readonly key: string;
  readonly value: string;
}

/** The inline chip's card names; Duration reads "Time" as it does there. */
const CARD_LABEL: Readonly<Record<SummaryCardKind, string>> = {
  files: 'Files',
  lines: 'Lines',
  tokens: 'Tokens',
  cost: 'Cost',
  duration: 'Time',
  tests: 'Tests',
};

/**
 * Panel-only additions to the shared mini-card look: each card is a toggle,
 * so it shows hover, an open ring (primary) and the failed-tests ring
 * (error). Rings are inset box shadows, so a state never shifts the layout.
 * Motion only under `prefers-reduced-motion: no-preference`.
 */
const SUMMARY_STYLES = `
  .ts-wrap { overflow-wrap: anywhere; }
  .ts-mini-toggle { cursor: pointer; }
  .ts-mini-toggle:hover {
    background-color: color-mix(in oklab, oklch(var(--bc)) 7%, oklch(var(--b3)));
  }
  .ts-mini-toggle[aria-expanded='true'] {
    box-shadow: inset 0 0 0 1px color-mix(in oklab, oklch(var(--p)) 65%, transparent);
  }
  [data-polarity='bad'] > .ts-mini-toggle {
    box-shadow: inset 0 0 0 1px color-mix(in oklab, oklch(var(--er)) 45%, transparent);
  }
  [data-polarity='bad'] > .ts-mini-toggle[aria-expanded='true'] {
    box-shadow: inset 0 0 0 1px color-mix(in oklab, oklch(var(--er)) 75%, transparent);
  }
  @media (prefers-reduced-motion: no-preference) {
    .ts-mini-toggle { transition: background-color 150ms ease, box-shadow 150ms ease; }
  }
`;

let nextTurnSummaryInstance = 0;

/** A value the source could not produce reads as its status word, never 0. */
function shown(value: number | string, format: (n: number) => string): string {
  return typeof value === 'number' ? format(value) : value;
}

/**
 * TurnSummaryComponent - the host-built Turn summary section at the top of the
 * display panel (TASK_2026_623, component 5; R6.1-R6.4, R6.8, R9; decisions
 * #51, #66, #69). Since TASK_2026_629 R9o (decision 76) it wears the inline
 * chip's mini-card look (`turn-summary-mini-card.styles.ts`) and keeps
 * expand-to-detail.
 *
 * Presentational over `buildTurnSummaryModel`: it renders `model.cards` in
 * order and adds no omission rule of its own (the model already leaves out
 * Files, Lines and Tests with nothing to show, decision #66).
 *
 * - Every mini card is a toggle (R9), collapsed by default; a conflict forces
 *   Files open until the user toggles it (parity section 2). The card grid
 *   never reflows on a toggle: open details stack under it in card order.
 * - Open/closed choices (cards and section) last one turn: the dock reuses
 *   this component across turns, so a different turn (`turnKey`) restores
 *   the defaults, while a re-render of the same turn keeps them.
 * - Files detail (`ptah-turn-summary-files`): the change-set card's
 *   capabilities, parity section 2.
 * - Tests detail (`ptah-turn-summary-tests`): the tests row's capabilities,
 *   parity section 1.
 * - Lines, Tokens, Cost and Time expand to a short key-value list.
 * - An action failure (`actionError`) shows as an inline `role="alert"` line
 *   under the cards, outside every collapsible region so it is never hidden.
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
  styles: [TURN_SUMMARY_MINI_STYLES, SUMMARY_STYLES],
  template: `
    <section
      [class]="MINI_SECTION_CLASS"
      [attr.aria-labelledby]="sectionToggleId"
      data-testid="turn-summary"
      (keydown.escape)="collapseSection($event, sectionToggle)"
    >
      <div class="flex min-w-0 items-start gap-2 px-2.5 py-1.5">
        <button
          #sectionToggle
          type="button"
          class="dp-toggle flex min-w-0 flex-1 items-center gap-2 rounded text-left"
          [id]="sectionToggleId"
          [attr.aria-expanded]="sectionOpen()"
          [attr.aria-controls]="sectionRegionId"
          (click)="sectionOpen.set(!sectionOpen())"
          data-testid="turn-summary-toggle"
        >
          <lucide-angular
            [img]="LayoutDashboardIcon"
            class="h-4 w-4 shrink-0 text-base-content-muted"
            aria-hidden="true"
          />
          <span class="min-w-0 flex-1 text-sm font-semibold"
            >Turn summary</span
          >
          <lucide-angular
            [img]="ChevronDownIcon"
            class="dp-chevron h-4 w-4 shrink-0 text-base-content-muted"
            [attr.data-open]="sectionOpen()"
            aria-hidden="true"
          />
        </button>
        <span
          class="flex min-h-8 shrink-0 flex-wrap items-center justify-end gap-1"
        >
          @if (summary().incomplete) {
            <span
              [class]="MINI_PILL_CLASS.warning"
              data-testid="turn-summary-incomplete"
              >incomplete</span
            >
          }
          <span
            [class]="MINI_PILL_CLASS.neutral + ' gap-1'"
            data-testid="turn-summary-host"
          >
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
          <div class="flex min-w-0 flex-col px-2.5 pb-2.5">
            @if (summary().incomplete) {
              <p
                class="ts-wrap mb-2 text-xs text-base-content-muted"
                role="note"
                data-testid="turn-summary-incomplete-note"
              >
                This turn stopped before it finished, so these results may be
                incomplete.
              </p>
            }
            <div class="ts-mini-grid" role="list" data-testid="turn-summary-grid">
              @for (card of cards(); track card.kind) {
                <div
                  class="flex min-w-0"
                  role="listitem"
                  [attr.data-open]="isOpen(card.kind)"
                  [attr.data-polarity]="
                    card.kind === 'tests' ? summary().tests?.polarity : null
                  "
                  [attr.data-testid]="'turn-summary-card-' + card.kind"
                  (keydown.escape)="collapseCard($event, card.kind)"
                >
                  <button
                    type="button"
                    [class]="MINI_CARD_TOGGLE_CLASS"
                    [id]="toggleId(card.kind)"
                    [attr.aria-expanded]="isOpen(card.kind)"
                    [attr.aria-controls]="regionId(card.kind)"
                    (click)="toggleCard(card.kind)"
                    [attr.data-testid]="'turn-summary-card-toggle-' + card.kind"
                  >
                    <span
                      class="flex min-w-0 items-center gap-1.5 text-xs font-medium text-base-content-muted"
                    >
                      <lucide-angular
                        [img]="CARD_ICON[card.kind]"
                        class="h-3.5 w-3.5 shrink-0"
                        aria-hidden="true"
                      />
                      <span class="min-w-0 flex-1 truncate">{{
                        card.label
                      }}</span>
                      <lucide-angular
                        [img]="ChevronDownIcon"
                        class="dp-chevron h-3.5 w-3.5 shrink-0"
                        [attr.data-open]="isOpen(card.kind)"
                        aria-hidden="true"
                      />
                    </span>
                    <span
                      [class]="card.valueClass"
                      [attr.data-testid]="'turn-summary-value-' + card.kind"
                      >{{ card.value }}
                      @if (card.srValue; as words) {
                        <span class="sr-only"> {{ words }}</span>
                      }
                    </span>
                    @if (card.caption; as caption) {
                      <span
                        [class]="MINI_CAPTION_CLASS"
                        [attr.data-testid]="'turn-summary-caption-' + card.kind"
                        >{{ caption }}</span
                      >
                    }
                    @if (card.pills.length > 0) {
                      <span class="mt-1 flex min-w-0 flex-wrap gap-1">
                        @for (pill of card.pills; track pill.text) {
                          <span
                            [class]="MINI_CARD_PILL_CLASS[pill.tone]"
                            data-testid="turn-summary-pill"
                            >{{ pill.text }}</span
                          >
                        }
                      </span>
                    }
                  </button>
                </div>
              }
            </div>
            @if (actionError(); as error) {
              <p
                class="ts-wrap mt-2 flex items-start gap-1.5 text-xs diff-del-text"
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
            @for (card of cards(); track card.kind) {
              <div
                [id]="regionId(card.kind)"
                role="region"
                [attr.aria-labelledby]="toggleId(card.kind)"
                class="dp-collapse"
                [attr.data-open]="isOpen(card.kind)"
                [attr.inert]="isOpen(card.kind) ? null : ''"
                [attr.data-testid]="'turn-summary-region-' + card.kind"
                (keydown.escape)="collapseCard($event, card.kind)"
              >
                <div class="dp-collapse-inner">
                  <div
                    class="mt-2 min-w-0 rounded-box bg-base-300 p-2.5 text-xs"
                  >
                    <p
                      class="mb-1.5 flex items-center gap-1.5 font-medium text-base-content-muted"
                      aria-hidden="true"
                    >
                      <lucide-angular
                        [img]="CARD_ICON[card.kind]"
                        class="h-3.5 w-3.5 shrink-0"
                      />
                      {{ card.label }}
                    </p>
                    @switch (card.kind) {
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
                        @if (detailNote(card.kind); as note) {
                          <p class="ts-wrap mb-1.5 text-base-content-muted">
                            {{ note }}
                          </p>
                        }
                        <dl
                          class="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1"
                        >
                          @for (row of detailRows(card.kind); track row.key) {
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
            }
          </div>
        </div>
      </div>
    </section>
  `,
})
export class TurnSummaryComponent {
  /** The turn's summary model; the dock mounts the section only when it exists. */
  readonly summary = input.required<TurnSummaryModel>();
  /**
   * The summary source's id of the turn `summary` describes (the user message
   * that opened it). A re-render of the same turn (new marks, a resolved test
   * outcome, an added run) keeps every open/closed choice; a different turn
   * resets them, even when its cards look alike.
   */
  readonly turnKey = input.required<string>();
  /** The last Open file / Review failure text, shown under the cards (R6.8). */
  readonly actionError = input<string | null>(null);
  /** Open (or resolve) one file of the change set; emits its path. */
  readonly openFile = output<string>();
  /** Review the whole change set. */
  readonly review = output<void>();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly instanceId = `ptah-turn-summary-${nextTurnSummaryInstance++}`;
  protected readonly sectionToggleId = `${this.instanceId}-toggle`;
  protected readonly sectionRegionId = `${this.instanceId}-region`;

  protected readonly MINI_SECTION_CLASS = MINI_SECTION_CLASS;
  protected readonly MINI_CAPTION_CLASS = MINI_CAPTION_CLASS;
  protected readonly MINI_PILL_CLASS = MINI_PILL_CLASS;
  protected readonly MINI_CARD_PILL_CLASS = MINI_CARD_PILL_CLASS;
  /** The chip's card, made a full-height toggle that lays out top-down. */
  protected readonly MINI_CARD_TOGGLE_CLASS = `${MINI_CARD_CLASS} ts-mini-toggle dp-toggle flex w-full flex-col items-stretch gap-0.5 text-left`;
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

  /**
   * The section is open by default (design section 3, `section`). The user's
   * choice lasts for one turn: a different turn reopens it.
   */
  protected readonly sectionOpen = linkedSignal({
    source: this.turnKey,
    computation: () => true,
  });
  /**
   * Per card, the user's last choice in this turn; absent means the default.
   * A different turn starts empty, so it shows the defaults again.
   */
  private readonly userOpen = linkedSignal<
    string,
    ReadonlyMap<SummaryCardKind, boolean>
  >({
    source: this.turnKey,
    computation: () => new Map(),
  });

  protected readonly cards = computed((): readonly SummaryMiniCard[] =>
    this.summary().cards.map((card) => this.cardOf(card)),
  );

  protected toggleId(kind: SummaryCardKind): string {
    return `${this.instanceId}-${kind}-toggle`;
  }

  protected regionId(kind: SummaryCardKind): string {
    return `${this.instanceId}-${kind}-region`;
  }

  /**
   * Collapsed by default (R9.4). A conflict forces Files open for every turn
   * that has one, unless the user toggled Files during that same turn; then
   * the user's choice wins (parity section 2, parity 111).
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

  /**
   * Escape on an open card's toggle or inside its detail: collapse it and
   * refocus the toggle. A closed card lets Escape reach the section.
   */
  protected collapseCard(event: Event, kind: SummaryCardKind): void {
    if (!this.isOpen(kind)) return;
    event.stopPropagation();
    this.userOpen.update((current) => new Map(current).set(kind, false));
    this.host.nativeElement
      .querySelector<HTMLButtonElement>(`[id="${this.toggleId(kind)}"]`)
      ?.focus();
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

  /**
   * One mini card. Value and caption read as the inline chip's card for the
   * same turn; the pills add the panel's status flags.
   */
  private cardOf(card: TurnSummaryCard): SummaryMiniCard {
    const head = this.headOf(card);
    return { ...head, valueClass: miniValueClass(head.value) };
  }

  private headOf(card: TurnSummaryCard): Omit<SummaryMiniCard, 'valueClass'> {
    const label = CARD_LABEL[card.kind];
    switch (card.kind) {
      case 'files': {
        const pills: SummaryPill[] = [];
        if (card.conflictedCount > 0) {
          pills.push({ text: `${card.conflictedCount} conflicted`, tone: 'error' });
        }
        if (card.baselineMissing) {
          pills.push({ text: 'baseline missing', tone: 'warning' });
        }
        return {
          kind: card.kind,
          label,
          // Counts unavailable reads `?` plus the words (decision #69).
          value: card.countsUnavailable ? '?' : shown(card.value, String),
          srValue: null,
          caption: card.countsUnavailable ? 'counts unavailable' : 'changed',
          pills,
        };
      }
      case 'lines':
        return card.countsUnavailable
          ? {
              kind: card.kind,
              label,
              value: '?',
              srValue: 'lines changed',
              caption: 'counts unavailable',
              pills: [],
            }
          : {
              kind: card.kind,
              label,
              value: `+${shown(card.additions, String)} −${shown(card.deletions, String)}`,
              srValue: 'lines added and removed',
              caption: null,
              pills: [],
            };
      case 'tokens': {
        const { input, output } = card;
        const counted = typeof input === 'number' && typeof output === 'number';
        return {
          kind: card.kind,
          label,
          value: counted
            ? formatTokens(input + output)
            : shown(input, formatTokens),
          srValue: null,
          caption: counted
            ? `${formatTokens(input)} in · ${formatTokens(output)} out`
            : null,
          pills: [],
        };
      }
      case 'cost':
        return {
          kind: card.kind,
          label,
          // Never a made-up $0: unavailable stays the word (decision #69).
          value: card.value,
          srValue: null,
          caption: card.value === 'unavailable' ? 'not reported' : null,
          pills: [],
        };
      case 'duration':
        return {
          kind: card.kind,
          label,
          value: card.value,
          srValue: null,
          caption: null,
          pills: [],
        };
      case 'tests': {
        const { passed, running, total } = card.summary;
        const pills: SummaryPill[] = [];
        if (running > 0) pills.push({ text: 'in background', tone: 'info' });
        if (this.summary().incomplete) {
          pills.push({ text: 'incomplete', tone: 'warning' });
        }
        return {
          kind: card.kind,
          label,
          value: `${passed}/${total}`,
          srValue: 'passed',
          // "1 passed, 1 failed, 1 unknown": the chip's caption, in words.
          caption: card.label,
          pills,
        };
      }
    }
  }
}
